package ai.omerta.assistant.viewmodel

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import ai.omerta.assistant.data.agent.DeviceTools
import ai.omerta.assistant.data.local.MemoryStore
import ai.omerta.assistant.data.local.OmertaSettings
import ai.omerta.assistant.data.local.Provider
import ai.omerta.assistant.data.local.SettingsStore
import ai.omerta.assistant.data.model.ChatItem
import ai.omerta.assistant.data.model.Role
import ai.omerta.assistant.data.remote.AnthropicClient
import ai.omerta.assistant.data.remote.StreamEvent
import ai.omerta.assistant.data.repository.ChatRepository
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.withContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

enum class ConnectionState { UNKNOWN, CHECKING, ONLINE, OFFLINE }

data class ChatUiState(
    val messages: List<ChatItem> = emptyList(),
    val input: String = "",
    val isSending: Boolean = false,
    val connection: ConnectionState = ConnectionState.UNKNOWN,
    val serverModel: String? = null,
    val lastUsage: String? = null,
)

class ChatViewModel(app: Application) : AndroidViewModel(app) {

    private val settingsStore = SettingsStore(app)
    private val repo = ChatRepository()
    private val deviceTools = DeviceTools(app)
    private val memory = MemoryStore(app)

    val settings: StateFlow<OmertaSettings?> =
        settingsStore.settings.stateIn(viewModelScope, SharingStarted.Eagerly, null)

    /** A pending device-tool action awaiting the operator's approval (Agent mode). */
    data class PendingApproval(
        val name: String,
        val input: Map<String, String>,
        val deferred: CompletableDeferred<Boolean>,
    )

    private val _approval = MutableStateFlow<PendingApproval?>(null)
    val approval: StateFlow<PendingApproval?> = _approval.asStateFlow()

    fun resolveApproval(allow: Boolean) {
        _approval.value?.deferred?.complete(allow)
        _approval.value = null
    }

    fun hasAllFilesAccess(): Boolean = deviceTools.hasAllFilesAccess()

    private val _ui = MutableStateFlow(ChatUiState())
    val ui: StateFlow<ChatUiState> = _ui.asStateFlow()

    private var streamJob: Job? = null

    init {
        checkConnection()
    }

    fun updateInput(text: String) = _ui.update { it.copy(input = text) }

    fun checkConnection() {
        viewModelScope.launch {
            _ui.update { it.copy(connection = ConnectionState.CHECKING) }
            val s = settingsStore.settings.first()
            val result = repo.health(s)
            _ui.update { state ->
                result.fold(
                    onSuccess = { h -> state.copy(connection = ConnectionState.ONLINE, serverModel = h.model) },
                    onFailure = { state.copy(connection = ConnectionState.OFFLINE) },
                )
            }
        }
    }

    fun clearChat() {
        streamJob?.cancel()
        _ui.update { it.copy(messages = emptyList(), isSending = false, lastUsage = null) }
    }

    fun stop() {
        _approval.value?.deferred?.complete(false)
        _approval.value = null
        streamJob?.cancel()
        finalizeStreaming(interrupted = true)
    }

    fun send() {
        val text = _ui.value.input.trim()
        if (text.isEmpty() || _ui.value.isSending) return
        if (handleCommand(text)) return
        val userItem = ChatItem(role = Role.USER, content = text)
        _ui.update { it.copy(messages = it.messages + userItem, input = "") }
        dispatch()
    }

    /** Slash-commands so you can teach the app by command. Returns true if handled. */
    private fun handleCommand(text: String): Boolean {
        if (!text.startsWith("/")) return false
        val (cmd, rest) = text.drop(1).split(" ", limit = 2).let {
            it[0].lowercase() to (it.getOrNull(1)?.trim() ?: "")
        }
        fun note(msg: String) = _ui.update {
            it.copy(messages = it.messages + ChatItem(role = Role.ASSISTANT, content = msg), input = "")
        }
        when (cmd) {
            "teach", "learn" -> {
                // /teach key: value   (or)   /learn free text
                val (key, value) = if (":" in rest) rest.split(":", limit = 2).let { it[0].trim() to it[1].trim() }
                    else "note" to rest
                if (value.isBlank()) { note("usage: /teach <key>: <value>"); return true }
                val id = memory.teach(key, value, if (cmd == "learn") "RULE" else "LESSON")
                note("✓ learned #$id [${if (cmd == "learn") "RULE" else "LESSON"}] $key: $value")
            }
            "forget" -> {
                val id = rest.toLongOrNull()
                note(if (id != null && memory.forget(id)) "✓ forgot #$id" else "usage: /forget <id>")
            }
            "memory", "mem" -> {
                val items = memory.all()
                note(if (items.isEmpty()) "no lessons yet — teach me with /teach key: value"
                    else items.joinToString("\n") { "#${it.id} [${it.type}] ${it.key}: ${it.value}" })
            }
            "help" -> note("commands: /teach key: value · /learn <rule> · /memory · /forget <id>")
            else -> return false
        }
        return true
    }

    fun retryLast() {
        // Drop a trailing error/assistant message and resend from last user turn.
        val msgs = _ui.value.messages.toMutableList()
        while (msgs.isNotEmpty() && msgs.last().role != Role.USER) msgs.removeAt(msgs.size - 1)
        if (msgs.isEmpty()) return
        _ui.update { it.copy(messages = msgs) }
        dispatch()
    }

    private fun dispatch() {
        val base = settings.value ?: return
        // Inject operator-taught memory so the app applies what it has learned.
        val taught = memory.learnedContext()
        val s = if (taught.isBlank()) base
        else base.copy(systemPrompt = (base.systemPrompt.trim() + "\n\n" + taught).trim())
        val history = _ui.value.messages.map { it.toWire() }
        when {
            // Agent tool-loop requires the Anthropic tool API.
            s.agentMode && s.embedded && s.provider == Provider.ANTHROPIC -> runAgent(s, history)
            s.streaming -> streamResponse(s, history)
            else -> sendResponse(s, history)
        }
    }

    /** Autonomous, permission-gated tool-use loop (Agent mode). */
    private fun runAgent(s: OmertaSettings, history: List<ai.omerta.assistant.data.model.WireMessage>) {
        _ui.update { it.copy(isSending = true) }
        streamJob = viewModelScope.launch {
            val handle: suspend (String, Map<String, String>) -> AnthropicClient.ToolOutcome = { name, input ->
                val allowed = if (s.autoApprove) true else {
                    val d = CompletableDeferred<Boolean>()
                    _approval.value = PendingApproval(name, input, d)
                    d.await()
                }
                if (!allowed) AnthropicClient.ToolOutcome("denied by operator", isError = true)
                else withContext(Dispatchers.IO) {
                    runCatching { AnthropicClient.ToolOutcome(deviceTools.execute(name, input)) }
                        .getOrElse { AnthropicClient.ToolOutcome(it.message ?: "tool error", isError = true) }
                }
            }
            try {
                repo.agent(s, history, DeviceTools.schemas(), handle) { ev ->
                    when (ev) {
                        is AnthropicClient.AgentEvent.Text ->
                            if (ev.text.isNotBlank()) appendAssistant(ev.text)
                        is AnthropicClient.AgentEvent.ToolStart ->
                            appendAssistant("⚙ ${ev.name} ${ev.input}")
                        is AnthropicClient.AgentEvent.ToolEnd ->
                            appendAssistant("↳ ${ev.result.take(800)}", isError = ev.isError)
                        is AnthropicClient.AgentEvent.Done -> { /* text already emitted */ }
                        is AnthropicClient.AgentEvent.Failure -> appendError(ev.message)
                    }
                }
            } catch (e: Exception) {
                appendError(e.message ?: "agent error")
            } finally {
                _approval.value = null
                _ui.update { it.copy(isSending = false) }
            }
        }
    }

    private fun appendAssistant(text: String, isError: Boolean = false) {
        _ui.update {
            it.copy(messages = it.messages + ChatItem(role = Role.ASSISTANT, content = text, isError = isError))
        }
    }

    private fun sendResponse(s: OmertaSettings, history: List<ai.omerta.assistant.data.model.WireMessage>) {
        _ui.update { it.copy(isSending = true) }
        viewModelScope.launch {
            val result = repo.send(s, history)
            result.fold(
                onSuccess = { resp ->
                    _ui.update {
                        it.copy(
                            messages = it.messages + ChatItem(role = Role.ASSISTANT, content = resp.content),
                            isSending = false,
                            connection = ConnectionState.ONLINE,
                            serverModel = resp.model,
                            lastUsage = resp.usage?.let { u -> "in ${u.inputTokens} / out ${u.outputTokens}" },
                        )
                    }
                },
                onFailure = { e -> appendError(e.message ?: "Request failed") },
            )
        }
    }

    private fun streamResponse(s: OmertaSettings, history: List<ai.omerta.assistant.data.model.WireMessage>) {
        val placeholder = ChatItem(role = Role.ASSISTANT, content = "", streaming = true)
        _ui.update { it.copy(messages = it.messages + placeholder, isSending = true) }
        streamJob = viewModelScope.launch {
            val builder = StringBuilder()
            try {
                repo.stream(s, history).collect { ev ->
                    when (ev) {
                        is StreamEvent.Delta -> {
                            builder.append(ev.text)
                            updateStreaming(placeholder.id, builder.toString())
                        }
                        is StreamEvent.Thinking -> { /* reserved for a thinking pane */ }
                        is StreamEvent.Done -> {
                            _ui.update { st ->
                                st.copy(
                                    connection = ConnectionState.ONLINE,
                                    serverModel = ev.model,
                                    messages = st.messages.map {
                                        if (it.id == placeholder.id)
                                            it.copy(content = builder.toString(), streaming = false)
                                        else it
                                    },
                                    isSending = false,
                                )
                            }
                        }
                        is StreamEvent.Failure -> {
                            // Remove empty placeholder, then surface the error.
                            _ui.update { st ->
                                st.copy(messages = st.messages.filterNot {
                                    it.id == placeholder.id && it.content.isEmpty()
                                })
                            }
                            if (builder.isNotEmpty()) updateStreaming(placeholder.id, builder.toString(), false)
                            appendError(ev.message)
                        }
                    }
                }
            } catch (e: Exception) {
                finalizeStreaming(interrupted = true)
            }
        }
    }

    private fun updateStreaming(id: String, content: String, streaming: Boolean = true) {
        _ui.update { st ->
            st.copy(messages = st.messages.map {
                if (it.id == id) it.copy(content = content, streaming = streaming) else it
            })
        }
    }

    private fun finalizeStreaming(interrupted: Boolean) {
        _ui.update { st ->
            st.copy(
                isSending = false,
                messages = st.messages.map {
                    if (it.streaming) it.copy(streaming = false,
                        content = if (interrupted && it.content.isEmpty()) "[stopped]" else it.content)
                    else it
                },
            )
        }
    }

    private fun appendError(message: String) {
        _ui.update {
            it.copy(
                messages = it.messages + ChatItem(role = Role.ASSISTANT, content = message, isError = true),
                isSending = false,
                connection = ConnectionState.OFFLINE,
            )
        }
    }

    // --- settings passthrough ---
    fun saveSettings(
        engineMode: String? = null, anthropicApiKey: String? = null,
        backendUrl: String? = null, appToken: String? = null, model: String? = null,
        systemPrompt: String? = null, effort: String? = null, streaming: Boolean? = null,
        maxTokens: Int? = null, webSearch: Boolean? = null, codeExecution: Boolean? = null,
        mcpName: String? = null, mcpUrl: String? = null,
        agentMode: Boolean? = null, autoApprove: Boolean? = null,
        provider: String? = null, openAiKey: String? = null, ollamaUrl: String? = null,
    ) {
        viewModelScope.launch {
            settingsStore.update(
                engineMode, anthropicApiKey, backendUrl, appToken,
                model, systemPrompt, effort, streaming,
                maxTokens, webSearch, codeExecution, mcpName, mcpUrl,
                agentMode, autoApprove, provider, openAiKey, ollamaUrl,
            )
            checkConnection()
        }
    }

    // --- teachable memory (also drives the Settings memory list) ---
    fun lessons() = memory.all()
    fun forgetLesson(id: Long) = memory.forget(id)
    fun clearMemory() = memory.clear()
}
