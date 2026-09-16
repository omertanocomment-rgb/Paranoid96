package ai.omerta.assistant.data.repository

import ai.omerta.assistant.data.local.OmertaSettings
import ai.omerta.assistant.data.model.ChatRequest
import ai.omerta.assistant.data.model.ChatResponse
import ai.omerta.assistant.data.model.HealthStatus
import ai.omerta.assistant.data.model.ServerConfig
import ai.omerta.assistant.data.model.WireMessage
import ai.omerta.assistant.data.remote.OmertaApiClient
import ai.omerta.assistant.data.remote.StreamEvent
import kotlinx.coroutines.flow.Flow

/** Thin coordination layer between ViewModel and the network client. */
class ChatRepository(private val api: OmertaApiClient = OmertaApiClient()) {

    suspend fun health(s: OmertaSettings): Result<HealthStatus> =
        api.health(s.backendUrl, s.appToken)

    suspend fun config(s: OmertaSettings): Result<ServerConfig> =
        api.config(s.backendUrl, s.appToken)

    private fun buildRequest(s: OmertaSettings, history: List<WireMessage>, stream: Boolean) =
        ChatRequest(
            messages = history,
            model = s.model,
            system = s.systemPrompt.ifBlank { null },
            effort = s.effort,
            stream = stream,
        )

    suspend fun send(s: OmertaSettings, history: List<WireMessage>): Result<ChatResponse> =
        api.chat(s.backendUrl, s.appToken, buildRequest(s, history, stream = false))

    fun stream(s: OmertaSettings, history: List<WireMessage>): Flow<StreamEvent> =
        api.chatStream(s.backendUrl, s.appToken, buildRequest(s, history, stream = true))
}
