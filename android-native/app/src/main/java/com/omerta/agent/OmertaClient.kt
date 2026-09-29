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

    private fun q(s: String) = java.net.URLEncoder.encode(s, "UTF-8")

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
        onStarted: (String) -> Unit = {},
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
        onStarted(id)
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

    suspend fun cancelTurn(id: String) =
        post("/api/chat/cancel", JSONObject().put("id", id))

    // ── status / settings ───────────────────────────────────────────────
    suspend fun status(): JSONObject = get("/api/status")

    suspend fun setProvider(id: String) =
        post("/api/model", JSONObject().put("provider", id))

    suspend fun setMode(mode: String) = post("/api/mode", JSONObject().put("mode", mode))

    suspend fun setPolicy(policy: String) =
        post("/api/policy", JSONObject().put("policy", policy))

    suspend fun putSecret(key: String, value: String) =
        post("/api/secret", JSONObject().put("key", key).put("value", value))

    suspend fun secretStatus(): JSONObject = get("/api/secret")

    suspend fun models(): JSONObject = get("/api/models")

    suspend fun modelAction(action: String, id: String) =
        post("/api/models", JSONObject().put("action", action).put("id", id))

    suspend fun settings(): JSONObject = get("/api/settings")

    /** The backend takes the whole map under "settings" and validates each key. */
    suspend fun setSettings(values: JSONObject) =
        post("/api/settings", JSONObject().put("settings", values))

    suspend fun version(): JSONObject = get("/api/version")

    // ── terminal ────────────────────────────────────────────────────────
    suspend fun termList(): JSONObject = get("/api/term")

    suspend fun termOpen(): JSONObject = post("/api/term/open", JSONObject())

    suspend fun termWrite(id: String, data: String) =
        post("/api/term/write", JSONObject().put("id", id).put("data", data))

    suspend fun termRead(id: String, offset: Int) =
        get("/api/term/read?id=$id&offset=$offset")

    suspend fun termSignal(id: String, name: String) =
        post("/api/term/signal", JSONObject().put("id", id).put("signal", name))

    suspend fun termResize(id: String, cols: Int, rows: Int) =
        post("/api/term/resize", JSONObject().put("id", id)
            .put("cols", cols).put("rows", rows))

    suspend fun termClose(id: String) = post("/api/term/close", JSONObject().put("id", id))

    // ── chats ───────────────────────────────────────────────────────────
    suspend fun chatList(project: String, archived: Boolean = false) =
        get("/api/chats?project=${q(project)}&archived=${if (archived) 1 else 0}")

    suspend fun chatOpen(id: String) = get("/api/chats/open?id=${q(id)}")

    suspend fun chatNew(project: String) =
        post("/api/chats/new", JSONObject().put("project", project))

    suspend fun chatAction(id: String, action: String, extra: JSONObject = JSONObject()) =
        post("/api/chats/action", extra.put("id", id).put("action", action))

    suspend fun chatProjects(): JSONObject = get("/api/chats/projects")

    suspend fun newProject(name: String) =
        post("/api/chats/action", JSONObject().put("action", "new_project")
            .put("project", name))

    suspend fun chatExport(id: String) =
        post("/api/chats/export", JSONObject().put("id", id))

    suspend fun chatImport(payload: JSONObject) = post("/api/chats/import", payload)

    // The queue: messages typed while a turn is running, sent in order after.
    suspend fun queueList(id: String) = chatAction(id, "queue")

    suspend fun enqueue(id: String, text: String) =
        chatAction(id, "enqueue", JSONObject().put("text", text))

    suspend fun queueClear(id: String) = chatAction(id, "queue_clear")

    // ── work modes (build / plan / research / brainstorm / debate) ──────
    suspend fun workMode(): JSONObject = get("/api/workmode")

    suspend fun setWorkMode(mode: String) =
        post("/api/workmode", JSONObject().put("mode", mode))

    // ── the editor ──────────────────────────────────────────────────────
    suspend fun wsTree(path: String = "") =
        post("/api/ws/tree", JSONObject().apply { if (path.isNotEmpty()) put("path", path) })

    suspend fun wsRead(path: String) =
        post("/api/ws/read", JSONObject().put("path", path))

    /**
     * Describe a save without performing it.
     *
     * Returns a diff and `awaiting_approval`; nothing is written until commit.
     * That is the same gate the agent's own writes pass through, so a change
     * made by hand and a change made by the model are equally recoverable.
     */
    suspend fun wsPropose(path: String, content: String) =
        post("/api/ws/propose", JSONObject().put("path", path).put("content", content))

    suspend fun wsCommit(path: String, content: String) =
        post("/api/ws/commit", JSONObject().put("path", path).put("content", content))

    suspend fun wsSearch(query: String, symbol: Boolean = false) =
        post("/api/ws/search", JSONObject().put("q", query).put("symbol", symbol))

    suspend fun wsReindex() = post("/api/ws/reindex", JSONObject())

    suspend fun wsBackups(): JSONObject = get("/api/ws/backups")

    suspend fun wsBackupRead(id: String) =
        post("/api/ws/backup", JSONObject().put("id", id))

    // ── the learning shelf ──────────────────────────────────────────────
    suspend fun learnList(project: String) = get("/api/learn?project=${q(project)}")

    suspend fun learnDoc(id: String) = get("/api/learn/doc?id=${q(id)}")

    /** Documents go in base64 so one plain JSON POST covers every client. */
    suspend fun learnUpload(name: String, base64: String, project: String, note: String = "") =
        post("/api/learn/upload", JSONObject().put("name", name)
            .put("content_b64", base64).put("project", project).put("note", note))

    suspend fun learnAddPath(path: String, project: String) =
        post("/api/learn/path", JSONObject().put("path", path).put("project", project))

    /** `doc`, not `id`: forgetting a behaviour and forgetting a file differ. */
    suspend fun learnForgetDoc(id: String) =
        post("/api/learn/forget", JSONObject().put("doc", id))

    suspend fun learnForgetFact(id: String) =
        post("/api/learn/forget", JSONObject().put("id", id))

    suspend fun learnBehaviour(project: String) =
        get("/api/learn/behaviour?project=${q(project)}")

    // ── attachments ─────────────────────────────────────────────────────
    suspend fun attachments(project: String) = get("/api/attach?project=${q(project)}")

    suspend fun attachDelete(id: String) =
        post("/api/attach/delete", JSONObject().put("id", id))

    // ── the on-device engine ────────────────────────────────────────────
    suspend fun localai(): JSONObject = get("/api/localai")

    suspend fun localaiControl(action: String, extra: JSONObject = JSONObject()) =
        post("/api/localai", extra.put("action", action))

    // ── theme ───────────────────────────────────────────────────────────
    suspend fun themes(): JSONObject = get("/api/theme")

    suspend fun themeUse(name: String) =
        post("/api/theme/use", JSONObject().put("name", name))

    suspend fun themeSave(payload: JSONObject) = post("/api/theme/save", payload)

    suspend fun themeDelete(name: String) =
        post("/api/theme/delete", JSONObject().put("name", name))

    // ── backup, usage ───────────────────────────────────────────────────
    suspend fun backup(action: String, extra: JSONObject = JSONObject()) =
        post("/api/backup", extra.put("action", action))

    suspend fun usage(days: Int = 30) = get("/api/usage?days=$days")

    suspend fun usageReset() = post("/api/usage", JSONObject().put("action", "reset"))

    // ── the scratch sandbox ─────────────────────────────────────────────
    suspend fun scratchList(): JSONObject = get("/api/scratch")

    suspend fun scratchNew(name: String, source: String = "") =
        post("/api/scratch/new", JSONObject().put("name", name)
            .apply { if (source.isNotEmpty()) put("source", source) })

    suspend fun scratchRun(id: String, cmd: String) =
        post("/api/scratch/run", JSONObject().put("id", id).put("cmd", cmd))

    suspend fun scratchChanges(id: String) =
        post("/api/scratch/changes", JSONObject().put("id", id))

    suspend fun scratchDiff(id: String) =
        post("/api/scratch/diff", JSONObject().put("id", id))

    suspend fun scratchAccept(id: String) =
        post("/api/scratch/accept", JSONObject().put("id", id))

    suspend fun scratchDiscard(id: String) =
        post("/api/scratch/discard", JSONObject().put("id", id))

    // ── adb over the network ────────────────────────────────────────────
    suspend fun adb(action: String, extra: JSONObject = JSONObject()) =
        post("/api/adb", extra.put("action", action))

    // ── memory, history, sync, connectors, plugins ──────────────────────
    suspend fun memory(query: String, project: String) =
        get("/api/memory?q=${q(query)}&project=${q(project)}")

    suspend fun history(n: Int = 50) = get("/api/history?n=$n")

    suspend fun syncStatus(): JSONObject = get("/api/sync/status")

    suspend fun syncRun(peer: String = "", token: String = "", full: Boolean = false) =
        post("/api/sync/run", JSONObject().put("peer", peer)
            .put("token", token).put("full", full))

    suspend fun reconnectConnectors() = post("/api/connectors/reconnect", JSONObject())

    suspend fun reloadPlugins() = post("/api/plugins/reload", JSONObject())
}

/**
 * What went wrong, in the words the backend used.
 *
 * Three shapes mean failure here and they are not interchangeable: an HTTP
 * status the transport set (`error`), a handler that refused (`status: error`
 * with `reason`), and a handler that did nothing (`status: unchanged`). A
 * screen that only checks `error` reports a refusal as a success, which is
 * how a save that never happened once looked like a save that did.
 */
fun JSONObject.err(): String {
    optString("error", "").let { if (it.isNotEmpty()) return it }
    if (optString("status", "") == "error") {
        return optString("reason", "").ifEmpty { "failed" }
    }
    return ""
}

fun JSONObject.ok(): Boolean = err().isEmpty()

fun JSONArray.objects(): List<JSONObject> =
    (0 until length()).mapNotNull { optJSONObject(it) }

fun JSONArray.strings(): List<String> =
    (0 until length()).map { optString(it) }.filter { it.isNotEmpty() }

fun JSONObject.list(key: String): List<JSONObject> =
    optJSONArray(key)?.objects() ?: emptyList()

fun JSONObject.names(key: String): List<String> =
    optJSONArray(key)?.strings() ?: emptyList()
