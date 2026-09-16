package ai.omerta.assistant.data.remote

import ai.omerta.assistant.data.model.ChatRequest
import ai.omerta.assistant.data.model.ChatResponse
import ai.omerta.assistant.data.model.HealthStatus
import ai.omerta.assistant.data.model.ServerConfig
import ai.omerta.assistant.data.model.StreamDelta
import ai.omerta.assistant.data.model.StreamDone
import ai.omerta.assistant.data.model.StreamError
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOn
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.concurrent.TimeUnit

/** Events surfaced to the ViewModel while streaming. */
sealed interface StreamEvent {
    data class Delta(val text: String) : StreamEvent
    data class Thinking(val text: String) : StreamEvent
    data class Done(val model: String, val stopReason: String?) : StreamEvent
    data class Failure(val message: String) : StreamEvent
}

class OmertaApiClient {

    private val json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
    }

    private val jsonMedia = "application/json; charset=utf-8".toMediaType()

    private val client = OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(300, TimeUnit.SECONDS) // long, for streamed generations
        .writeTimeout(30, TimeUnit.SECONDS)
        .retryOnConnectionFailure(true)
        .build()

    private fun base(url: String) = url.trimEnd('/')

    private fun Request.Builder.auth(token: String) = apply {
        if (token.isNotBlank()) header("x-omerta-key", token)
    }

    suspend fun health(baseUrl: String, token: String): Result<HealthStatus> = runCatching {
        val req = Request.Builder().url("${base(baseUrl)}/health").auth(token).get().build()
        client.newCall(req).execute().use { resp ->
            val body = resp.body?.string().orEmpty()
            if (!resp.isSuccessful) error("HTTP ${resp.code}: ${body.take(200)}")
            json.decodeFromString(HealthStatus.serializer(), body)
        }
    }

    suspend fun config(baseUrl: String, token: String): Result<ServerConfig> = runCatching {
        val req = Request.Builder().url("${base(baseUrl)}/api/config").auth(token).get().build()
        client.newCall(req).execute().use { resp ->
            val body = resp.body?.string().orEmpty()
            if (!resp.isSuccessful) error("HTTP ${resp.code}: ${body.take(200)}")
            json.decodeFromString(ServerConfig.serializer(), body)
        }
    }

    /** Non-streaming completion. */
    suspend fun chat(baseUrl: String, token: String, request: ChatRequest): Result<ChatResponse> =
        runCatching {
            val payload = json.encodeToString(ChatRequest.serializer(), request.copy(stream = false))
            val req = Request.Builder()
                .url("${base(baseUrl)}/api/chat")
                .auth(token)
                .post(payload.toRequestBody(jsonMedia))
                .build()
            client.newCall(req).execute().use { resp ->
                val body = resp.body?.string().orEmpty()
                if (!resp.isSuccessful) error("HTTP ${resp.code}: ${body.take(300)}")
                json.decodeFromString(ChatResponse.serializer(), body)
            }
        }

    /**
     * Streaming completion over SSE. Emits [StreamEvent]s. The flow terminates on
     * Done or Failure. Cancellation of the collecting coroutine cancels the call.
     */
    fun chatStream(baseUrl: String, token: String, request: ChatRequest): Flow<StreamEvent> = flow {
        val payload = json.encodeToString(ChatRequest.serializer(), request.copy(stream = true))
        val req = Request.Builder()
            .url("${base(baseUrl)}/api/chat/stream")
            .auth(token)
            .header("Accept", "text/event-stream")
            .post(payload.toRequestBody(jsonMedia))
            .build()

        val call = client.newCall(req)
        call.execute().use { resp ->
            if (!resp.isSuccessful) {
                val body = resp.body?.string().orEmpty()
                emit(StreamEvent.Failure("HTTP ${resp.code}: ${body.take(300)}"))
                return@flow
            }
            val source = resp.body?.source() ?: run {
                emit(StreamEvent.Failure("Empty response body"))
                return@flow
            }

            var event = "message"
            val dataBuf = StringBuilder()

            while (!source.exhausted()) {
                val line = source.readUtf8Line() ?: break
                when {
                    line.startsWith("event:") -> event = line.substringAfter("event:").trim()
                    line.startsWith("data:") -> {
                        if (dataBuf.isNotEmpty()) dataBuf.append('\n')
                        dataBuf.append(line.substringAfter("data:").trim())
                    }
                    line.isEmpty() -> {
                        // Dispatch on blank line (end of one SSE event).
                        val data = dataBuf.toString()
                        dataBuf.setLength(0)
                        if (data.isNotEmpty()) {
                            when (event) {
                                "delta" -> emit(StreamEvent.Delta(
                                    json.decodeFromString(StreamDelta.serializer(), data).text))
                                "thinking" -> emit(StreamEvent.Thinking(
                                    json.decodeFromString(StreamDelta.serializer(), data).text))
                                "done" -> {
                                    val d = json.decodeFromString(StreamDone.serializer(), data)
                                    emit(StreamEvent.Done(d.model, d.stopReason))
                                    return@flow
                                }
                                "error" -> {
                                    val e = json.decodeFromString(StreamError.serializer(), data)
                                    emit(StreamEvent.Failure(e.message))
                                    return@flow
                                }
                            }
                        }
                        event = "message"
                    }
                }
            }
        }
    }.flowOn(Dispatchers.IO)
}
