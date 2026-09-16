package ai.omerta.assistant.data.repository

import ai.omerta.assistant.data.local.OmertaSettings
import ai.omerta.assistant.data.local.Provider
import ai.omerta.assistant.data.model.ChatRequest
import ai.omerta.assistant.data.model.ChatResponse
import ai.omerta.assistant.data.model.HealthStatus
import ai.omerta.assistant.data.model.WireMessage
import ai.omerta.assistant.data.remote.AnthropicClient
import ai.omerta.assistant.data.remote.OllamaClient
import ai.omerta.assistant.data.remote.OmertaApiClient
import ai.omerta.assistant.data.remote.OpenAiClient
import ai.omerta.assistant.data.remote.StreamEvent
import kotlinx.coroutines.flow.Flow

/**
 * Coordinates between the ViewModel and whichever engine is active:
 *  - EMBEDDED: talks to the selected provider in-process (Anthropic / OpenAI / local
 *    Ollama) — no server to run.
 *  - REMOTE:   talks to the external OMERTA engine / Node backend.
 */
class ChatRepository(
    private val remote: OmertaApiClient = OmertaApiClient(),
    private val anthropic: AnthropicClient = AnthropicClient(),
    private val openai: OpenAiClient = OpenAiClient(),
    private val ollama: OllamaClient = OllamaClient(),
) {

    suspend fun health(s: OmertaSettings): Result<HealthStatus> {
        if (!s.embedded) return remote.health(s.backendUrl, s.appToken)
        return when (s.provider) {
            Provider.ANTHROPIC -> anthropic.health(s.anthropicApiKey)
                .map { HealthStatus(status = "ok", model = s.model) }
            Provider.OPENAI ->
                if (s.openAiKey.isNotBlank()) Result.success(HealthStatus("ok", s.model))
                else Result.failure(IllegalStateException("No OpenAI API key set"))
            Provider.OLLAMA -> Result.success(HealthStatus("ok", s.model)) // verified on first call
            else -> Result.failure(IllegalStateException("Unknown provider"))
        }
    }

    private fun buildRequest(s: OmertaSettings, history: List<WireMessage>, stream: Boolean) =
        ChatRequest(
            messages = history,
            model = s.model,
            system = s.systemPrompt.ifBlank { null },
            effort = s.effort,
            stream = stream,
            maxTokens = s.maxTokens.takeIf { it > 0 },
            webSearch = s.webSearch,
            codeExecution = s.codeExecution,
            mcpName = s.mcpName.ifBlank { null },
            mcpUrl = s.mcpUrl.ifBlank { null },
        )

    suspend fun send(s: OmertaSettings, history: List<WireMessage>): Result<ChatResponse> {
        val req = buildRequest(s, history, stream = false)
        if (!s.embedded) return remote.chat(s.backendUrl, s.appToken, req)
        return when (s.provider) {
            Provider.OPENAI -> openai.chat(s.openAiKey, req)
            Provider.OLLAMA -> ollama.chat(s.ollamaUrl, req)
            else -> anthropic.chat(s.anthropicApiKey, req)
        }
    }

    fun stream(s: OmertaSettings, history: List<WireMessage>): Flow<StreamEvent> {
        val req = buildRequest(s, history, stream = true)
        if (!s.embedded) return remote.chatStream(s.backendUrl, s.appToken, req)
        return when (s.provider) {
            Provider.OPENAI -> openai.chatStream(s.openAiKey, req)
            Provider.OLLAMA -> ollama.chatStream(s.ollamaUrl, req)
            else -> anthropic.chatStream(s.anthropicApiKey, req)
        }
    }

    /**
     * Agent mode (embedded, Anthropic engine): autonomous tool-use loop with
     * caller-supplied device tools. Tool-use loops require the Anthropic tool API.
     */
    suspend fun agent(
        s: OmertaSettings,
        history: List<WireMessage>,
        deviceTools: kotlinx.serialization.json.JsonArray,
        handleTool: suspend (String, Map<String, String>) -> AnthropicClient.ToolOutcome,
        emit: suspend (AnthropicClient.AgentEvent) -> Unit,
    ) {
        anthropic.agent(s.anthropicApiKey, buildRequest(s, history, stream = false),
            deviceTools, handleTool, emit)
    }
}
