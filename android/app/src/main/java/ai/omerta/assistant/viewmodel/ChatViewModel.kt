package ai.omerta.assistant.viewmodel

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import ai.omerta.assistant.data.local.OmertaSettings
import ai.omerta.assistant.data.local.SettingsStore
import ai.omerta.assistant.data.model.ChatItem
import ai.omerta.assistant.data.model.Role
import ai.omerta.assistant.data.remote.StreamEvent
import ai.omerta.assistant.data.repository.ChatRepository
import kotlinx.coroutines.Job
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

    val settings: StateFlow<OmertaSettings?> =
        settingsStore.settings.stateIn(viewModelScope, SharingStarted.Eagerly, null)

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
        streamJob?.cancel()
        finalizeStreaming(interrupted = true)
    }

    fun send() {
        val text = _ui.value.input.trim()
        if (text.isEmpty() || _ui.value.isSending) return
        val userItem = ChatItem(role = Role.USER, content = text)
        _ui.update { it.copy(messages = it.messages + userItem, input = "") }
        dispatch()
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
        val s = settings.value ?: return
        val history = _ui.value.messages.map { it.toWire() }
        if (s.streaming) streamResponse(s, history) else sendResponse(s, history)
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
    ) {
        viewModelScope.launch {
            settingsStore.update(
                engineMode, anthropicApiKey, backendUrl, appToken,
                model, systemPrompt, effort, streaming,
            )
            checkConnection()
        }
    }
}
