package com.omerta.agent

import com.chaquo.python.PyObject
import com.chaquo.python.Python
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

/**
 * The Kotlin side of the agent, calling Python in this same process.
 *
 * No HTTP, no socket, no WebView. Every call goes through core/dispatch, the
 * same router the desktop app and a LAN browser use, so the approval gate and
 * the wire format are identical.
 *
 * Everything here suspends on the IO dispatcher: a chat turn can take a
 * minute, and the UI thread must stay free to draw.
 */
object OmertaClient {

    private fun boot(): PyObject = Python.getInstance().getModule("omerta_boot")

    /** One request. Returns the parsed body; never throws into the UI. */
    private suspend fun call(method: String, path: String, body: JSONObject?): JSONObject =
        withContext(Dispatchers.IO) {
            try {
                val raw = boot().callAttr(
                    "request", OmertaPython.homeDir(), method, path,
                    body?.toString() ?: ""
                ).toString()
                val env = JSONObject(raw)
                val out = env.optJSONObject("body") ?: JSONObject()
                val status = env.optInt("status", 200)
                if (status >= 400 && !out.has("error")) out.put("error", "HTTP $status")
                out
            } catch (t: Throwable) {
                JSONObject().put("error", "${t.javaClass.simpleName}: ${t.message}")
            }
        }

    suspend fun get(path: String): JSONObject = call("GET", path, null)

    suspend fun post(path: String, body: JSONObject = JSONObject()): JSONObject =
        call("POST", path, body)

    // ── chat ────────────────────────────────────────────────────────────
    /**
     * Run one turn, reporting the model's text as it arrives.
     *
     * The backend runs the turn on its own thread and this polls it by offset,
     * which is how streaming works on every transport this agent has. The
     * streamed text is the model's RAW output, so a turn ending in a tool call
     * streams the call syntax too -- the caller replaces what it streamed with
     * the final result rather than appending to it.
     */
    suspend fun turn(
        text: String,
        project: String,
        onDelta: suspend (String) -> Unit,
    ): JSONObject {
        val started = post(
            "/api/chat/start",
            JSONObject().put("kind", "message").put("text", text).put("project", project)
        )
        val id = started.optString("stream_id", "")
        if (id.isEmpty()) {
            // No streaming routes, or the start failed: fall back to the plain
            // turn rather than losing the message.
            return post(
                "/api/chat",
                JSONObject().put("kind", "message").put("text", text)
                    .put("project", project)
            )
        }
        var offset = 0
        while (true) {
            val p = get("/api/chat/poll?id=$id&offset=$offset")
            val chunk = p.optString("text", "")
            if (chunk.isNotEmpty()) onDelta(chunk)
            offset = p.optInt("offset", offset)
            if (p.optBoolean("done", false)) {
                val err = p.optString("error", "")
                return p.optJSONObject("result")
                    ?: JSONObject().put("text", if (err.isEmpty()) "" else err)
            }
            kotlinx.coroutines.delay(90)
        }
    }

    suspend fun approve(project: String) =
        post("/api/chat", JSONObject().put("kind", "approve").put("project", project))

    suspend fun deny(project: String, note: String) =
        post("/api/chat", JSONObject().put("kind", "deny").put("note", note)
            .put("project", project))

    suspend fun edit(project: String, cmd: String) =
        post("/api/chat", JSONObject().put("kind", "edit").put("cmd", cmd)
            .put("project", project))

    // ── status / settings ───────────────────────────────────────────────
    suspend fun status(): JSONObject = get("/api/status")

    suspend fun setProvider(id: String) =
        post("/api/model", JSONObject().put("provider", id))

    suspend fun setMode(mode: String) = post("/api/mode", JSONObject().put("mode", mode))

    suspend fun setPolicy(policy: String) =
        post("/api/policy", JSONObject().put("policy", policy))

    suspend fun putSecret(key: String, value: String) =
        post("/api/secret", JSONObject().put("key", key).put("value", value))

    suspend fun models(): JSONObject = get("/api/models")

    suspend fun modelAction(action: String, id: String) =
        post("/api/models", JSONObject().put("action", action).put("id", id))

    // ── terminal ────────────────────────────────────────────────────────
    suspend fun termOpen(): JSONObject = post("/api/term/open", JSONObject())

    suspend fun termWrite(id: String, data: String) =
        post("/api/term/write", JSONObject().put("id", id).put("data", data))

    suspend fun termRead(id: String, offset: Int) =
        get("/api/term/read?id=$id&offset=$offset")

    suspend fun termSignal(id: String, name: String) =
        post("/api/term/signal", JSONObject().put("id", id).put("signal", name))

    suspend fun termClose(id: String) = post("/api/term/close", JSONObject().put("id", id))

    // ── chats ───────────────────────────────────────────────────────────
    suspend fun chatList(project: String) = get("/api/chats?project=$project")

    suspend fun chatOpen(id: String) = get("/api/chats/open?id=$id")

    suspend fun chatNew(project: String) =
        post("/api/chats/new", JSONObject().put("project", project))

    fun JSONArray.toList(): List<JSONObject> =
        (0 until length()).mapNotNull { optJSONObject(it) }
}
