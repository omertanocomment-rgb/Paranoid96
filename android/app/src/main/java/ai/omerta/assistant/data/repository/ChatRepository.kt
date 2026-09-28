package ai.omerta.assistant.data.repository

import ai.omerta.assistant.data.brain.BrainRuntime
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
import kotlinx.coroutines.flow.flow

/**
 * Coordinates between the ViewModel and whichever engine is active:
 *  - EMBEDDED: talks to the selected provider in-process (Anthropic / OpenAI / local
 *    Ollama) — no server to run.
 *  - REMOTE:   talks to the external OMERTA engine / Node backend.
 *  - BRAIN:    fully offline — the on-device brain (+ optional on-device LLM).
 *
 * The active brain can also lend its personality/knowledge to online providers
 * ("persona everywhere") and answers when an online provider is unreachable
 * ("offline fallback").
 */
class ChatRepository(
    private val brain: BrainRuntime? = null,
    private val remote: OmertaApiClient = OmertaApiClient(),
    private val anthropic: AnthropicClient = AnthropicClient(),
    private val openai: OpenAiClient = OpenAiClient(),
    private val ollama: OllamaClient = OllamaClient(),
) {

    private fun isBrain(s: OmertaSettings) = s.embedded && s.provider == Provider.BRAIN && brain != null

    suspend fun health(s: OmertaSettings): Result<HealthStatus> {
        if (isBrain(s)) return Result.success(HealthStatus("ok", "brain · ${brain!!.brain.value.persona.name}"))
        if (!s.embedded) return remote.health(s.backendUrl, s.appToken)
        return when (s.provider) {
            Provider.ANTHROPIC -> anthropic.health(s.anthropicApiKey)
                .map { HealthStatus(status = "ok", model = s.model) }
            Provider.OPENAI -> openai.health(s.openAiKey).map { HealthStatus("ok", s.model) }
            Provider.OLLAMA -> ollama.health(s.ollamaUrl).map { HealthStatus("ok", s.model) }
            else -> Result.failure(IllegalStateException("Unknown provider"))
        }
    }

    private fun systemFor(s: OmertaSettings, history: List<WireMessage>): String? {
        val base = s.systemPrompt.trim()
        if (!s.personaEverywhere || brain == null) return base.ifBlank { null }
        val input = history.lastOrNull { it.role == "user" }?.content.orEmpty()
        return (brain.systemPromptFor(input) + if (base.isNotBlank()) "\n\n$base" else "").trim()
    }

    private fun buildRequest(s: OmertaSettings, history: List<WireMessage>, stream: Boolean) =
        ChatRequest(
            messages = history,
            model = s.model,
            system = systemFor(s, history),
            effort = s.effort,
            stream = stream,
            maxTokens = s.maxTokens.takeIf { it > 0 },
            webSearch = s.webSearch,
            codeExecution = s.codeExecution,
            mcpName = s.mcpName.ifBlank { null },
            mcpUrl = s.mcpUrl.ifBlank { null },
        )

    suspend fun send(s: OmertaSettings, history: List<WireMessage>): Result<ChatResponse> {
        if (isBrain(s)) return runCatching { collectBrain(s, history) }
        val req = buildRequest(s, history, stream = false)
        val result = if (!s.embedded) remote.chat(s.backendUrl, s.appToken, req) else when (s.provider) {
            Provider.OPENAI -> openai.chat(s.openAiKey, req)
            Provider.OLLAMA -> ollama.chat(s.ollamaUrl, req)
            else -> anthropic.chat(s.anthropicApiKey, req)
        }
        if (result.isFailure && s.offlineFallback && brain != null) {
            return runCatching { collectBrain(s, history, OFFLINE_PREFIX) }
        }
        return result
    }

    private suspend fun collectBrain(s: OmertaSettings, history: List<WireMessage>, prefix: String = ""): ChatResponse {
        val sb = StringBuilder(); var model = "brain"
        brain!!.stream(s, history, prefix).collect { ev ->
            when (ev) {
                is StreamEvent.Delta -> sb.append(ev.text)
                is StreamEvent.Done -> model = ev.model
                is StreamEvent.Failure -> error(ev.message)
                else -> {}
            }
        }
        return ChatResponse(content = sb.toString(), model = model, stopReason = "stop")
    }

    fun stream(s: OmertaSettings, history: List<WireMessage>): Flow<StreamEvent> {
        if (isBrain(s)) return brain!!.stream(s, history)
        val req = buildRequest(s, history, stream = true)
        val online = if (!s.embedded) remote.chatStream(s.backendUrl, s.appToken, req) else when (s.provider) {
            Provider.OPENAI -> openai.chatStream(s.openAiKey, req)
            Provider.OLLAMA -> ollama.chatStream(s.ollamaUrl, req)
            else -> anthropic.chatStream(s.anthropicApiKey, req)
        }
        if (!s.offlineFallback || brain == null) return online
        // No signal / provider down before any text arrived → the offline brain answers.
        return flow {
            var gotText = false
            var failure: String? = null
            try {
                online.collect { ev ->
                    when (ev) {
                        is StreamEvent.Failure -> if (!gotText) failure = ev.message else emit(ev)
                        is StreamEvent.Delta -> { gotText = true; emit(ev) }
                        else -> emit(ev)
                    }
                }
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e
            } catch (e: Exception) {
                if (gotText) throw e
                failure = e.message ?: "network error"
            }
            failure?.let { why ->
                val prefix = "⚡ ${if (s.embedded) s.provider else "engine"} unreachable (${why.take(80)}) — brain answering\n\n"
                brain.stream(s, history, prefix).collect { emit(it) }
            }
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

    companion object {
        const val OFFLINE_PREFIX = "⚡ offline — brain answering\n\n"
    }
}
