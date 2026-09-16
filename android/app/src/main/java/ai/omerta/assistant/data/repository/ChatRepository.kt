package ai.omerta.assistant.data.repository

import ai.omerta.assistant.data.local.OmertaSettings
import ai.omerta.assistant.data.model.ChatRequest
import ai.omerta.assistant.data.model.ChatResponse
import ai.omerta.assistant.data.model.HealthStatus
import ai.omerta.assistant.data.model.WireMessage
import ai.omerta.assistant.data.remote.AnthropicClient
import ai.omerta.assistant.data.remote.OmertaApiClient
import ai.omerta.assistant.data.remote.StreamEvent
import kotlinx.coroutines.flow.Flow

/**
 * Coordinates between the ViewModel and whichever engine is active:
 *  - EMBEDDED: [AnthropicClient] talks to the Anthropic API in-process (no server).
 *  - REMOTE:   [OmertaApiClient] talks to the external Node backend.
 */
class ChatRepository(
    private val remote: OmertaApiClient = OmertaApiClient(),
    private val embedded: AnthropicClient = AnthropicClient(),
) {

    suspend fun health(s: OmertaSettings): Result<HealthStatus> =
        if (s.embedded) {
            embedded.health(s.anthropicApiKey).map { HealthStatus(status = "ok", model = s.model) }
        } else {
            remote.health(s.backendUrl, s.appToken)
        }

    private fun buildRequest(s: OmertaSettings, history: List<WireMessage>, stream: Boolean) =
        ChatRequest(
            messages = history,
            model = s.model,
            system = s.systemPrompt.ifBlank { null },
            effort = s.effort,
            stream = stream,
        )

    suspend fun send(s: OmertaSettings, history: List<WireMessage>): Result<ChatResponse> {
        val req = buildRequest(s, history, stream = false)
        return if (s.embedded) embedded.chat(s.anthropicApiKey, req)
        else remote.chat(s.backendUrl, s.appToken, req)
    }

    fun stream(s: OmertaSettings, history: List<WireMessage>): Flow<StreamEvent> {
        val req = buildRequest(s, history, stream = true)
        return if (s.embedded) embedded.chatStream(s.anthropicApiKey, req)
        else remote.chatStream(s.backendUrl, s.appToken, req)
    }
}
