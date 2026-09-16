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
import kotlinx.serialization.json.int
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.concurrent.TimeUnit

/**
 * In-process gateway to the Anthropic Messages API. This is the "backend" compiled
 * into the app: with an API key present the app talks to Claude directly, so there is
 * no external server to run. Emits the same [StreamEvent]s as [OmertaApiClient] so the
 * repository can treat both engines identically.
 *
 * NOTE: an embedded key ships inside the APK / lives on the device and is extractable.
 * Use REMOTE mode with the Node backend when the key must stay off-device.
 */
class AnthropicClient {

    private companion object {
        const val MESSAGES_URL = "https://api.anthropic.com/v1/messages"
        const val MODELS_URL = "https://api.anthropic.com/v1/models"
        const val API_VERSION = "2023-06-01"
    }

    private val json = Json { ignoreUnknownKeys = true }
    private val jsonMedia = "application/json; charset=utf-8".toMediaType()

    private val client = OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(300, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .retryOnConnectionFailure(true)
        .build()

    private fun Request.Builder.anthropic(key: String) = apply {
        header("x-api-key", key)
        header("anthropic-version", API_VERSION)
    }

    private fun thinking(model: String, stream: Boolean): JsonObject = buildJsonObject {
        if (model.startsWith("claude-haiku")) {
            put("type", "enabled")
            put("budget_tokens", 2048)
        } else {
            put("type", "adaptive")
            if (stream) put("display", "summarized")
        }
    }

    private fun body(req: ChatRequest, stream: Boolean): String {
        val model = req.model ?: "claude-opus-5"
        val obj = buildJsonObject {
            put("model", model)
            put("max_tokens", if (stream) 32000 else 16000)
            put("thinking", thinking(model, stream))
            putJsonObject("output_config") { put("effort", req.effort ?: "high") }
            req.system?.takeIf { it.isNotBlank() }?.let { put("system", it) }
            if (stream) put("stream", true)
            putJsonArray("messages") {
                req.messages.forEach { m ->
                    add(buildJsonObject {
                        put("role", m.role)
                        put("content", m.content)
                    })
                }
            }
        }
        return json.encodeToString(JsonObject.serializer(), obj)
    }

    /** Validate the key cheaply (no tokens spent) by listing models. */
    suspend fun health(key: String): Result<String> = runCatching {
        if (key.isBlank()) error("No Anthropic API key set")
        val req = Request.Builder().url(MODELS_URL).anthropic(key).get().build()
        client.newCall(req).execute().use { resp ->
            val bodyStr = resp.body?.string().orEmpty()
            if (!resp.isSuccessful) error("HTTP ${resp.code}: ${bodyStr.take(200)}")
            "ok"
        }
    }

    suspend fun chat(key: String, request: ChatRequest): Result<ChatResponse> = runCatching {
        if (key.isBlank()) error("No Anthropic API key set")
        val payload = body(request, stream = false)
        val req = Request.Builder().url(MESSAGES_URL).anthropic(key)
            .post(payload.toRequestBody(jsonMedia)).build()
        client.newCall(req).execute().use { resp ->
            val bodyStr = resp.body?.string().orEmpty()
            if (!resp.isSuccessful) error("HTTP ${resp.code}: ${bodyStr.take(300)}")
            val root = json.parseToJsonElement(bodyStr).jsonObject
            val text = root["content"]?.jsonArray.orEmptyText()
            val usage = root["usage"]?.jsonObject
            ChatResponse(
                content = text,
                model = root["model"]?.jsonPrimitive?.content ?: (request.model ?: "claude-opus-5"),
                stopReason = root["stop_reason"]?.jsonPrimitive?.contentOrNullSafe(),
                usage = usage?.let {
                    Usage(
                        inputTokens = it["input_tokens"]?.jsonPrimitive?.intOrNull ?: 0,
                        outputTokens = it["output_tokens"]?.jsonPrimitive?.intOrNull ?: 0,
                        cacheReadInputTokens = it["cache_read_input_tokens"]?.jsonPrimitive?.intOrNull ?: 0,
                    )
                },
            )
        }
    }

    fun chatStream(key: String, request: ChatRequest): Flow<StreamEvent> = flow {
        if (key.isBlank()) {
            emit(StreamEvent.Failure("No Anthropic API key set — add it in Settings"))
            return@flow
        }
        val payload = body(request, stream = true)
        val req = Request.Builder().url(MESSAGES_URL).anthropic(key)
            .header("Accept", "text/event-stream")
            .post(payload.toRequestBody(jsonMedia)).build()

        client.newCall(req).execute().use { resp ->
            if (!resp.isSuccessful) {
                val b = resp.body?.string().orEmpty()
                emit(StreamEvent.Failure("HTTP ${resp.code}: ${b.take(300)}"))
                return@flow
            }
            val source = resp.body?.source() ?: run {
                emit(StreamEvent.Failure("Empty response body")); return@flow
            }

            var model = request.model ?: "claude-opus-5"
            var stopReason: String? = null
            val dataBuf = StringBuilder()

            while (!source.exhausted()) {
                val line = source.readUtf8Line() ?: break
                when {
                    line.startsWith("data:") -> {
                        if (dataBuf.isNotEmpty()) dataBuf.append('\n')
                        dataBuf.append(line.substringAfter("data:").trim())
                    }
                    line.isEmpty() -> {
                        val data = dataBuf.toString(); dataBuf.setLength(0)
                        if (data.isEmpty()) continue
                        val obj = runCatching { json.parseToJsonElement(data).jsonObject }.getOrNull()
                            ?: continue
                        when (obj["type"]?.jsonPrimitive?.contentOrNullSafe()) {
                            "message_start" -> obj["message"]?.jsonObject?.get("model")
                                ?.jsonPrimitive?.contentOrNullSafe()?.let { model = it }
                            "content_block_delta" -> {
                                val delta = obj["delta"]?.jsonObject
                                when (delta?.get("type")?.jsonPrimitive?.contentOrNullSafe()) {
                                    "text_delta" -> delta["text"]?.jsonPrimitive?.content?.let {
                                        emit(StreamEvent.Delta(it))
                                    }
                                    "thinking_delta" -> delta["thinking"]?.jsonPrimitive?.content?.let {
                                        emit(StreamEvent.Thinking(it))
                                    }
                                }
                            }
                            "message_delta" -> obj["delta"]?.jsonObject?.get("stop_reason")
                                ?.jsonPrimitive?.contentOrNullSafe()?.let { stopReason = it }
                            "message_stop" -> { emit(StreamEvent.Done(model, stopReason)); return@flow }
                            "error" -> {
                                val msg = obj["error"]?.jsonObject?.get("message")
                                    ?.jsonPrimitive?.contentOrNullSafe() ?: "stream error"
                                emit(StreamEvent.Failure(msg)); return@flow
                            }
                        }
                    }
                }
            }
            // Stream ended without an explicit message_stop.
            emit(StreamEvent.Done(model, stopReason))
        }
    }.flowOn(Dispatchers.IO)
}

// --- small JSON helpers ---
private fun kotlinx.serialization.json.JsonArray?.orEmptyText(): String =
    this?.mapNotNull {
        val o = it.jsonObject
        if (o["type"]?.jsonPrimitive?.contentOrNullSafe() == "text")
            o["text"]?.jsonPrimitive?.content else null
    }?.joinToString("") ?: ""

private fun kotlinx.serialization.json.JsonPrimitive.contentOrNullSafe(): String? =
    if (this.toString() == "null") null else this.content
