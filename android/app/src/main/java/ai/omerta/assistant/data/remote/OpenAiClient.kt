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
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.concurrent.TimeUnit

/** OpenAI Chat Completions engine (one of the selectable "different AIs"). */
class OpenAiClient {
    private companion object {
        const val URL = "https://api.openai.com/v1/chat/completions"
    }
    private val json = Json { ignoreUnknownKeys = true }
    private val media = "application/json; charset=utf-8".toMediaType()
    private val client = OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS).readTimeout(300, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS).build()

    private fun body(req: ChatRequest, stream: Boolean): String {
        val obj = buildJsonObject {
            put("model", req.model ?: "gpt-4o")
            if (stream) put("stream", true)
            putMessages(req)
        }
        return json.encodeToString(JsonObject.serializer(), obj)
    }

    private fun kotlinx.serialization.json.JsonObjectBuilder.putMessages(req: ChatRequest) {
        put("messages", buildJsonArray {
            req.system?.takeIf { it.isNotBlank() }?.let {
                add(buildJsonObject { put("role", "system"); put("content", it) })
            }
            req.messages.forEach { m ->
                add(buildJsonObject { put("role", m.role); put("content", m.content) })
            }
        })
    }

    fun chatStream(key: String, req: ChatRequest): Flow<StreamEvent> = flow {
        if (key.isBlank()) { emit(StreamEvent.Failure("No OpenAI API key set")); return@flow }
        val request = Request.Builder().url(URL)
            .header("Authorization", "Bearer $key")
            .header("Accept", "text/event-stream")
            .post(body(req, true).toRequestBody(media)).build()
        client.newCall(request).execute().use { resp ->
            if (!resp.isSuccessful) {
                emit(StreamEvent.Failure("HTTP ${resp.code}: ${resp.body?.string()?.take(300).orEmpty()}"))
                return@flow
            }
            val src = resp.body?.source() ?: run { emit(StreamEvent.Failure("empty body")); return@flow }
            while (!src.exhausted()) {
                val line = src.readUtf8Line() ?: break
                if (!line.startsWith("data:")) continue
                val data = line.substringAfter("data:").trim()
                if (data == "[DONE]") { emit(StreamEvent.Done(req.model ?: "gpt-4o", "stop")); return@flow }
                if (data.isEmpty()) continue
                val delta = runCatching {
                    json.parseToJsonElement(data).jsonObject["choices"]?.jsonArray?.get(0)
                        ?.jsonObject?.get("delta")?.jsonObject?.get("content")?.jsonPrimitive?.content
                }.getOrNull()
                if (!delta.isNullOrEmpty()) emit(StreamEvent.Delta(delta))
            }
            emit(StreamEvent.Done(req.model ?: "gpt-4o", "stop"))
        }
    }.flowOn(Dispatchers.IO)

    suspend fun chat(key: String, req: ChatRequest): Result<ChatResponse> = runCatching {
        if (key.isBlank()) error("No OpenAI API key set")
        val request = Request.Builder().url(URL).header("Authorization", "Bearer $key")
            .post(body(req, false).toRequestBody(media)).build()
        client.newCall(request).execute().use { resp ->
            val b = resp.body?.string().orEmpty()
            if (!resp.isSuccessful) error("HTTP ${resp.code}: ${b.take(300)}")
            val root = json.parseToJsonElement(b).jsonObject
            val text = root["choices"]?.jsonArray?.get(0)?.jsonObject
                ?.get("message")?.jsonObject?.get("content")?.jsonPrimitive?.content ?: ""
            ChatResponse(content = text, model = root["model"]?.jsonPrimitive?.content ?: (req.model ?: "gpt-4o"),
                stopReason = "stop", usage = Usage())
        }
    }
}
