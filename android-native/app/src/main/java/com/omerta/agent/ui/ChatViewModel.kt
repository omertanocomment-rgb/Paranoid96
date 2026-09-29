package com.omerta.agent.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.omerta.agent.OmertaClient
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import org.json.JSONObject

enum class Role { YOU, AGENT, SYSTEM }

data class Message(
    val role: Role,
    val text: String,
    val streaming: Boolean = false,
    val id: Long = nextId(),
) {
    companion object {
        private var counter = 0L
        fun nextId(): Long = ++counter
    }
}

/** A side effect the agent wants to run, waiting on the user. */
data class Pending(
    val action: String,
    val danger: Boolean,
    val tier: String?,
)

data class ChatState(
    val messages: List<Message> = emptyList(),
    val pending: Pending? = null,
    val busy: Boolean = false,
    val provider: String = "—",
    val policy: String = "",
    val mode: String = "",
    val project: String = "general",
    val ready: Boolean = false,
    val startupError: String? = null,
)

class ChatViewModel : ViewModel() {

    private val _state = MutableStateFlow(ChatState())
    val state: StateFlow<ChatState> = _state.asStateFlow()

    fun boot() {
        viewModelScope.launch {
            refreshStatus()
            if (_state.value.messages.isEmpty()) {
                add(Message(Role.AGENT,
                    "OMERTA online. Ask, or switch to PLAN to think it through first."))
            }
        }
    }

    fun refreshStatus() {
        viewModelScope.launch {
            val s = OmertaClient.status()
            if (s.has("error")) {
                _state.update { it.copy(startupError = s.optString("error")) }
                return@launch
            }
            _state.update {
                it.copy(
                    provider = s.optString("active", "—"),
                    policy = s.optJSONObject("policy")?.optString("policy") ?: "",
                    mode = s.optString("mode", ""),
                    ready = true,
                    startupError = null,
                )
            }
        }
    }

    private fun add(m: Message) = _state.update { it.copy(messages = it.messages + m) }

    private fun replaceStreaming(text: String, streaming: Boolean) {
        _state.update { st ->
            val idx = st.messages.indexOfLast { it.streaming }
            if (idx < 0) st.copy(messages = st.messages +
                Message(Role.AGENT, text, streaming))
            else st.copy(messages = st.messages.toMutableList().also {
                it[idx] = it[idx].copy(text = text, streaming = streaming)
            })
        }
    }

    fun send(text: String) {
        if (text.isBlank() || _state.value.busy) return
        add(Message(Role.YOU, text))
        _state.update { it.copy(busy = true) }
        viewModelScope.launch {
            var streamed = StringBuilder()
            add(Message(Role.AGENT, "", streaming = true))
            val result = OmertaClient.turn(text, _state.value.project) { delta ->
                streamed.append(delta)
                replaceStreaming(streamed.toString(), true)
            }
            finish(result)
        }
    }

    private fun finish(result: JSONObject) {
        val text = result.optString("text", "")
        val p = result.optJSONObject("pending")
        // The streamed text is the model's raw output and may contain a tool
        // call; the final text is the cleaned version, so it replaces it.
        _state.update { st ->
            val msgs = st.messages.toMutableList()
            val idx = msgs.indexOfLast { it.streaming }
            if (idx >= 0) {
                if (text.isBlank()) msgs.removeAt(idx)
                else msgs[idx] = msgs[idx].copy(text = text, streaming = false)
            } else if (text.isNotBlank()) {
                msgs += Message(Role.AGENT, text)
            }
            st.copy(
                messages = msgs,
                busy = false,
                pending = p?.let {
                    Pending(it.optString("action"), it.optBoolean("danger"),
                            it.optString("tier").ifEmpty { null })
                },
            )
        }
        val err = result.optString("error", "")
        if (err.isNotEmpty()) add(Message(Role.SYSTEM, err))
        refreshStatus()
    }

    fun approve() = act { OmertaClient.approve(_state.value.project) }

    fun deny(note: String) = act { OmertaClient.deny(_state.value.project, note) }

    fun edit(cmd: String) = act { OmertaClient.edit(_state.value.project, cmd) }

    private fun act(block: suspend () -> JSONObject) {
        _state.update { it.copy(pending = null, busy = true) }
        viewModelScope.launch { finish(block()) }
    }

    fun setProvider(id: String) = viewModelScope.launch {
        OmertaClient.setProvider(id); refreshStatus()
    }

    fun setMode(m: String) = viewModelScope.launch {
        OmertaClient.setMode(m); refreshStatus()
    }

    fun setPolicy(p: String) = viewModelScope.launch {
        OmertaClient.setPolicy(p); refreshStatus()
    }

    fun clear() {
        _state.update { it.copy(messages = emptyList(), pending = null) }
        viewModelScope.launch {
            OmertaClient.post("/api/chat", JSONObject()
                .put("kind", "reset").put("project", _state.value.project))
            boot()
        }
    }
}
