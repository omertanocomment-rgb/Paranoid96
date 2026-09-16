package ai.omerta.assistant.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/** Roles understood by the Omerta AI backend / Anthropic Messages API. */
object Role {
    const val USER = "user"
    const val ASSISTANT = "assistant"
    const val SYSTEM = "system"
}

/** A single wire message exchanged with the backend. */
@Serializable
data class WireMessage(
    val role: String,
    val content: String,
)

/** Request body for POST /api/chat and /api/chat/stream. */
@Serializable
data class ChatRequest(
    val messages: List<WireMessage>,
    val model: String? = null,
    val system: String? = null,
    val effort: String? = null,
    val stream: Boolean = false,
    // Tech / capability controls (embedded engine honors these).
    val maxTokens: Int? = null,
    val webSearch: Boolean = false,
    val codeExecution: Boolean = false,
    val mcpName: String? = null,
    val mcpUrl: String? = null,
)

@Serializable
data class Usage(
    @SerialName("input_tokens") val inputTokens: Int = 0,
    @SerialName("output_tokens") val outputTokens: Int = 0,
    @SerialName("cache_read_input_tokens") val cacheReadInputTokens: Int = 0,
)

/** Response body for the non-streaming POST /api/chat. */
@Serializable
data class ChatResponse(
    val content: String,
    val model: String,
    @SerialName("stop_reason") val stopReason: String? = null,
    val usage: Usage? = null,
)

/** SSE payloads emitted by /api/chat/stream. */
@Serializable
data class StreamDelta(val text: String)

@Serializable
data class StreamDone(
    val model: String,
    @SerialName("stop_reason") val stopReason: String? = null,
    val usage: Usage? = null,
)

@Serializable
data class StreamError(val message: String)

/** GET /api/config */
@Serializable
data class ServerConfig(
    val version: String,
    @SerialName("default_model") val defaultModel: String,
    val models: List<String> = emptyList(),
    @SerialName("thinking_enabled") val thinkingEnabled: Boolean = true,
)

/** GET /health */
@Serializable
data class HealthStatus(
    val status: String,
    val model: String? = null,
    val uptime: Double? = null,
)
