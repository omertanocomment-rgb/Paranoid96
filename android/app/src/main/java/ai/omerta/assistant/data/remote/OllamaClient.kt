package ai.omerta.assistant.data.remote

import ai.omerta.assistant.data.model.ChatRequest
import ai.omerta.assistant.data.model.ChatResponse
import ai.omerta.assistant.data.model.Usage
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOn
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.concurrent.TimeUnit

/** Local Ollama engine — run your own models on your machine/LAN, no external limits. */
class OllamaClient {
    private val json = Json { ignoreUnknownKeys = true }
    private val media = "application/json; charset=utf-8".toMediaType()
    private val client = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS).readTimeout(300, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS).build()

    private fun base(url: String) = url.trimEnd('/')

    private fun body(req: ChatRequest, stream: Boolean): String {
        val obj = buildJsonObject {
            put("model", req.model ?: "llama3.1")
            put("stream", stream)
            put("messages", buildJsonArray {
                req.system?.takeIf { it.isNotBlank() }?.let {
                    add(buildJsonObject { put("role", "system"); put("content", it) })
                }
                req.messages.forEach { m ->
                    add(buildJsonObject { put("role", m.role); put("content", m.content) })
                }
            })
        }
        return json.encodeToString(JsonObject.serializer(), obj)
    }

    fun chatStream(url: String, req: ChatRequest): Flow<StreamEvent> = flow {
        val request = Request.Builder().url("${base(url)}/api/chat")
            .post(body(req, true).toRequestBody(media)).build()
        client.newCall(request).execute().use { resp ->
            if (!resp.isSuccessful) {
                emit(StreamEvent.Failure("HTTP ${resp.code}: ${resp.body?.string()?.take(300).orEmpty()}"))
                return@flow
            }
            val src = resp.body?.source() ?: run { emit(StreamEvent.Failure("empty body")); return@flow }
            val model = req.model ?: "llama3.1"
            while (!src.exhausted()) {
                val line = src.readUtf8Line() ?: break
                if (line.isBlank()) continue
                val obj = runCatching { json.parseToJsonElement(line).jsonObject }.getOrNull() ?: continue
                obj["message"]?.jsonObject?.get("content")?.jsonPrimitive?.content
                    ?.takeIf { it.isNotEmpty() }?.let { emit(StreamEvent.Delta(it)) }
                if (obj["done"]?.jsonPrimitive?.booleanOrNull == true) {
                    emit(StreamEvent.Done(model, "stop")); return@flow
                }
            }
            emit(StreamEvent.Done(model, "stop"))
        }
    }.flowOn(Dispatchers.IO)

    suspend fun chat(url: String, req: ChatRequest): Result<ChatResponse> = runCatching {
        val request = Request.Builder().url("${base(url)}/api/chat")
            .post(body(req, false).toRequestBody(media)).build()
        client.newCall(request).execute().use { resp ->
            val b = resp.body?.string().orEmpty()
            if (!resp.isSuccessful) error("HTTP ${resp.code}: ${b.take(300)}")
            val root = json.parseToJsonElement(b).jsonObject
            val text = root["message"]?.jsonObject?.get("content")?.jsonPrimitive?.content ?: ""
            ChatResponse(content = text, model = root["model"]?.jsonPrimitive?.content ?: (req.model ?: "llama3.1"),
                stopReason = "stop", usage = Usage())
        }
    }
}
