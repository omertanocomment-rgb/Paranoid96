package com.omerta.agent.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.omerta.agent.OmertaClient
import com.omerta.agent.err
import com.omerta.agent.list
import com.omerta.agent.names
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
    val diff: String? = null,
)

data class ChatState(
    val messages: List<Message> = emptyList(),
    val pending: Pending? = null,
    val busy: Boolean = false,
    val provider: String = "—",
    val policy: String = "",
    val mode: String = "",
    val workMode: String = "build",
    val workModes: List<String> = emptyList(),
    val workBlurb: String = "",
    val project: String = "general",
    val projects: List<String> = emptyList(),
    val chatId: String? = null,
    val chatTitle: String = "",
    val queued: List<String> = emptyList(),
    val attachments: Int = 0,
    val ready: Boolean = false,
    val startupError: String? = null,
)

class ChatViewModel : ViewModel() {

    private val _state = MutableStateFlow(ChatState())
    val state: StateFlow<ChatState> = _state.asStateFlow()

    /** The turn currently streaming, so STOP has something to cancel. */
    private var liveStream: String? = null

    fun boot() {
        viewModelScope.launch {
            refreshStatus()
            refreshProjects()
            if (_state.value.messages.isEmpty()) {
                add(Message(Role.AGENT,
                    "OMERTA online. Ask, or switch to PLAN to think it through first."))
            }
        }
    }

    fun refreshStatus() {
        viewModelScope.launch {
            val s = OmertaClient.status()
            val e = s.err()
            if (e.isNotEmpty()) {
                _state.update { it.copy(startupError = e) }
                return@launch
            }
            val work = s.optJSONObject("work_mode")
            _state.update {
                it.copy(
                    provider = s.optString("active", "—"),
                    policy = s.optJSONObject("policy")?.optString("policy") ?: "",
                    mode = s.optString("mode", ""),
                    workMode = work?.optString("mode") ?: it.workMode,
                    workModes = work?.optJSONObject("modes")?.let { m ->
                        m.keys().asSequence().toList().sorted()
                    } ?: it.workModes,
                    workBlurb = work?.optString("blurb") ?: it.workBlurb,
                    attachments = s.optJSONObject("attachments")?.optInt("count", 0) ?: 0,
                    ready = true,
                    startupError = null,
                )
            }
        }
    }

    fun refreshProjects() {
        viewModelScope.launch {
            val p = OmertaClient.chatProjects()
            val found = p.names("projects")
            _state.update {
                it.copy(projects = if (found.isEmpty()) listOf(it.project) else found)
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

    /**
     * Send, or queue if a turn is already running.
     *
     * Typing while the agent is working used to do nothing at all, which reads
     * as the app having dropped the message. The backend keeps a per-chat
     * queue for exactly this, so a second message is held and sent in order
     * rather than discarded.
     */
    fun send(text: String) {
        if (text.isBlank()) return
        if (_state.value.busy) { enqueue(text); return }
        add(Message(Role.YOU, text))
        _state.update { it.copy(busy = true) }
        viewModelScope.launch {
            val streamed = StringBuilder()
            add(Message(Role.AGENT, "", streaming = true))
            val result = OmertaClient.turn(
                text, _state.value.project,
                onStarted = { liveStream = it },
            ) { delta ->
                streamed.append(delta)
                replaceStreaming(streamed.toString(), true)
            }
            liveStream = null
            finish(result)
        }
    }

    private fun enqueue(text: String) {
        _state.update { it.copy(queued = it.queued + text) }
        val id = _state.value.chatId ?: return
        viewModelScope.launch { OmertaClient.enqueue(id, text) }
    }

    /** Stop the turn in flight. The partial reply stays; it was really said. */
    fun stop() {
        val id = liveStream ?: return
        viewModelScope.launch {
            OmertaClient.cancelTurn(id)
            _state.update { st ->
                st.copy(busy = false, messages = st.messages.map {
                    if (it.streaming) it.copy(streaming = false) else it
                })
            }
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
                            it.optString("tier").ifEmpty { null },
                            it.optString("diff").ifEmpty { null })
                },
            )
        }
        val err = result.err()
        if (err.isNotEmpty()) add(Message(Role.SYSTEM, err))
        refreshStatus()
        drainQueue()
    }

    /** Send the next message typed while the agent was busy. */
    private fun drainQueue() {
        val st = _state.value
        if (st.busy || st.pending != null || st.queued.isEmpty()) return
        val next = st.queued.first()
        _state.update { it.copy(queued = it.queued.drop(1)) }
        send(next)
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

    fun setWorkMode(m: String) = viewModelScope.launch {
        val r = OmertaClient.setWorkMode(m)
        _state.update {
            it.copy(workMode = r.optString("mode", m),
                    workBlurb = r.optString("blurb", it.workBlurb))
        }
        refreshStatus()
    }

    /**
     * Switch project.
     *
     * Each project is a separate agent with its own history, memory scope and
     * approval policy, so this is not a filter -- it is a different assistant.
     * The transcript on screen belongs to the old one and does not follow.
     */
    fun setProject(name: String) {
        if (name == _state.value.project) return
        _state.update {
            it.copy(project = name, messages = emptyList(), pending = null,
                    queued = emptyList(), chatId = null, chatTitle = "")
        }
        boot()
    }

    /** Put a saved conversation back on screen. */
    fun loadChat(full: JSONObject) {
        val e = full.err()
        if (e.isNotEmpty()) { add(Message(Role.SYSTEM, e)); return }
        if (full.optString("status") == "locked") {
            add(Message(Role.SYSTEM,
                "That chat is locked. Unlock it from the CHATS tab."))
            return
        }
        val msgs = full.list("messages").mapNotNull { m ->
            val text = m.optString("content", "").ifEmpty { m.optString("text", "") }
            if (text.isEmpty()) null else Message(
                when (m.optString("role")) {
                    "user" -> Role.YOU
                    "system" -> Role.SYSTEM
                    else -> Role.AGENT
                },
                text,
            )
        }
        _state.update {
            it.copy(messages = msgs, pending = null, busy = false,
                    chatId = full.optString("id").ifEmpty { null },
                    chatTitle = full.optString("title", ""),
                    project = full.optString("project", it.project))
        }
    }

    fun clear() {
        _state.update {
            it.copy(messages = emptyList(), pending = null, queued = emptyList(),
                    chatId = null, chatTitle = "")
        }
        viewModelScope.launch {
            OmertaClient.post("/api/chat", JSONObject()
                .put("kind", "reset").put("project", _state.value.project))
            boot()
        }
    }
}
