package ai.omerta.assistant.viewmodel

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import ai.omerta.assistant.data.agent.DeviceTools
import ai.omerta.assistant.data.brain.BrainRuntime
import ai.omerta.assistant.data.local.EngineMode
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
    /** The offline brain (shared with the Brain screen). */
    val brain = BrainRuntime.get(app)
    private val repo = ChatRepository(brain)
    private val deviceTools = DeviceTools(app)
    private val memory = MemoryStore(app)
    val agentLog = ai.omerta.assistant.data.agent.AgentLog(app)

    val settings: StateFlow<OmertaSettings?> =
        settingsStore.settings.stateIn(viewModelScope, SharingStarted.Eagerly, null)

    /** A pending device-tool action awaiting the operator's approval (Agent mode). */
    data class PendingApproval(
        val name: String,
        val input: Map<String, String>,
        val risk: ai.omerta.assistant.data.agent.RiskLevel,
        val reason: String,
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
        scanBrainInbox()
        maybeAutoBackup()
    }

    /** Picks up brains pushed from a PC (`omerta_brain.py push`). */
    fun scanBrainInbox() {
        viewModelScope.launch {
            brain.scanInbox().forEach { appendAssistant("🧠 $it") }
        }
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
        viewModelScope.launch { brain.newConversation() }
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
                viewModelScope.launch {
                    brain.edit { e ->
                        if (cmd == "learn") e.addLesson(if (key == "note") value else "$key: $value")
                        else e.addFact(if (key == "note") value else "$key: $value", topic = if (key == "note") "" else key)
                    }
                }
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
            "brain" -> {
                val b = brain.brain.value
                note("🧠 ${b.name} (persona ${b.persona.name}, tone ${b.persona.tone}) — " +
                    "${b.knowledge.size} facts · ${b.reflexes.size} trained replies · ${b.lessons.size} rules · " +
                    "${b.stats.messages} messages seen. Open the Brain screen to edit, import or export.")
            }
            "offline" -> { useBrain(); note("🧠 switched to the offline brain — no network needed.") }
            "help" -> note("commands: /teach key: value · /learn <rule> · /memory · /forget <id> · " +
                "/brain · /offline\nIn offline brain mode just talk: \"remember that …\", " +
                "\"when I say X, say Y\", \"wrong, it's …\", \"what do you know\".")
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
        val extras = buildString {
            if (taught.isNotBlank()) append("\n\n").append(taught)
            if (base.agentMode) append("\n\n").append(agentGuidance(base))
        }
        val s = if (extras.isBlank()) base
        else base.copy(systemPrompt = (base.systemPrompt.trim() + extras).trim())
        val history = _ui.value.messages.map { it.toWire() }
        when {
            // Agent tool-loop requires the Anthropic tool API.
            s.agentMode && s.embedded && s.provider == Provider.ANTHROPIC -> runAgent(s, history)
            s.streaming -> streamResponse(s, history)
            else -> sendResponse(s, history)
        }
    }

    /**
     * The system guidance that shapes autonomous behavior: do what the operator asked,
     * but flag a better option first, run only low-risk steps unattended, and always
     * pause on anything consequential — spelling out the risk in the tool call.
     */
    private fun agentGuidance(s: OmertaSettings): String = buildString {
        append("You can act on the operator's own device with the provided tools ")
        append("(files, shell, network, device info). This is authorized, owned-device use.\n")
        append("- Do what the operator asks. You carry it out — you don't refuse reasonable owned-device tasks.\n")
        if (s.suggestBetter)
            append("- If you see a safer or better way to reach their goal, say so in one line and recommend it before acting; then follow their call.\n")
        append("- Read/inspect freely. Before anything that changes the device, network state, or other apps, ")
        append("keep the step small and state plainly what it will do; the app will ask the operator to approve it.\n")
        append("- For high-risk steps (root/su, deletes, system paths, flashing, network writes) explain the risk and why it's needed before requesting it.\n")
        append("- Never work around the approval prompt. If a step is denied, adapt or ask.")
    }

    /** Autonomous, permission-gated tool-use loop (Agent mode). */
    private fun runAgent(s: OmertaSettings, history: List<ai.omerta.assistant.data.model.WireMessage>) {
        _ui.update { it.copy(isSending = true) }
        streamJob = viewModelScope.launch {
            val handle: suspend (String, Map<String, String>) -> AnthropicClient.ToolOutcome = { name, input ->
                val risk = ai.omerta.assistant.data.agent.Risk.forTool(name, input)
                // Low-risk steps may run unattended in AUTO_LOW; everything else always asks.
                val autoOk = s.autonomy == ai.omerta.assistant.data.local.Autonomy.AUTO_LOW &&
                    risk.level == ai.omerta.assistant.data.agent.RiskLevel.LOW
                val allowed = if (autoOk) true else {
                    val d = CompletableDeferred<Boolean>()
                    _approval.value = PendingApproval(name, input, risk.level, risk.reason, d)
                    d.await()
                }
                if (!allowed) {
                    agentLog.record(name, input, risk.level, "DENIED")
                    AnthropicClient.ToolOutcome("denied by operator", isError = true)
                } else withContext(Dispatchers.IO) {
                    runCatching { AnthropicClient.ToolOutcome(deviceTools.execute(name, input)) }
                        .getOrElse { AnthropicClient.ToolOutcome(it.message ?: "tool error", isError = true) }
                        .also { agentLog.record(name, input, risk.level,
                            if (autoOk) "AUTO-RAN" else "ALLOWED", it.content) }
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

    fun backupAllBrains(uri: android.net.Uri) {
        viewModelScope.launch {
            runCatching { brain.store.backupAll(uri) }.fold(
                onSuccess = { appendAssistant("🧠 backed up $it brain(s) to the chosen file.") },
                onFailure = { appendAssistant("🧠 backup failed: ${it.message}", isError = true) })
        }
    }

    fun restoreAllBrains(uri: android.net.Uri) {
        viewModelScope.launch {
            runCatching { brain.importAll(uri) }.fold(
                onSuccess = { appendAssistant("🧠 restored $it brain(s).") },
                onFailure = { appendAssistant("🧠 restore failed: ${it.message}", isError = true) })
        }
    }

    /** The current conversation as shareable Markdown (for export / share sheet). */
    fun transcriptMarkdown(): String {
        val b = brain.brain.value
        val sb = StringBuilder("# ${b.persona.name} — conversation\n\n")
        _ui.value.messages.forEach { m ->
            val who = if (m.role == Role.USER) "**You**" else "**${b.persona.name}**"
            sb.append(who).append(": ").append(m.content.trim()).append("\n\n")
        }
        return sb.toString().trim() + "\n"
    }

    /** Files opened with / shared to the app: install brains, learn documents. */
    fun importIncoming(uris: List<android.net.Uri>) {
        viewModelScope.launch {
            for (u in uris) {
                runCatching { brain.import(u) }.fold(
                    onSuccess = { r ->
                        val msg = buildString {
                            append("🧠 ")
                            if (r.brains > 0) append("Installed brain \"${r.activated}\" and made it active. ")
                            if (r.documents > 0) append("Learned ${r.documents} document(s) → ${r.chunks} knowledge chunk(s). ")
                            if (r.brains == 0 && r.documents == 0) append("Nothing usable in that file.")
                        }
                        appendAssistant(msg.trim())
                    },
                    onFailure = { appendAssistant("🧠 import failed: ${it.message}", isError = true) },
                )
            }
        }
    }

    fun teachShared(subject: String, text: String) {
        viewModelScope.launch {
            val n = brain.edit { it.learnDocument(text, subject.ifBlank { "shared" }, topic = subject) }
            appendAssistant("🧠 Learned shared text${if (subject.isNotBlank()) " \"$subject\"" else ""} → $n chunk(s).")
        }
    }

    fun markOnboarded() { viewModelScope.launch { settingsStore.setOnboarded() } }

    /** Persist a SAF folder for auto-backup (takes a persistable permission so it survives reboots). */
    fun setAutoBackupFolder(uri: android.net.Uri) {
        viewModelScope.launch {
            runCatching {
                getApplication<Application>().contentResolver.takePersistableUriPermission(
                    uri, android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION or
                        android.content.Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
            }
            settingsStore.setAutoBackup(uri.toString(), null)
            appendAssistant("🧠 auto-backup folder set — I'll snapshot all brains here.")
            backupNow()
        }
    }

    fun setAutoBackupHours(hours: Int) { viewModelScope.launch { settingsStore.setAutoBackup(null, hours) } }

    fun backupNow() {
        viewModelScope.launch {
            val s = settingsStore.settings.first()
            if (s.autoBackupDir.isBlank()) { appendAssistant("🧠 pick an auto-backup folder first (Brain → AUTO-BACKUP)."); return@launch }
            runCatching { brain.store.backupAllToTree(android.net.Uri.parse(s.autoBackupDir)) }
                .fold(onSuccess = { settingsStore.markBackupNow(); appendAssistant("🧠 backed up all brains → $it") },
                      onFailure = { appendAssistant("🧠 backup failed: ${it.message}", isError = true) })
        }
    }

    /** On launch: if a folder is set and the interval elapsed, back up silently. */
    private fun maybeAutoBackup() {
        viewModelScope.launch {
            val s = settingsStore.settings.first()
            if (s.autoBackupDir.isBlank() || s.autoBackupHours <= 0) return@launch
            val due = System.currentTimeMillis() - s.lastBackupMs >= s.autoBackupHours * 3_600_000L
            if (!due) return@launch
            runCatching { brain.store.backupAllToTree(android.net.Uri.parse(s.autoBackupDir)) }
                .onSuccess { settingsStore.markBackupNow() }
        }
    }

    /**
     * True when the app can reach the internet for an answer: an online provider is active,
     * or the offline brain has web search enabled.
     */
    fun isOnline(s: OmertaSettings): Boolean =
        !s.embedded || s.provider != Provider.BRAIN || s.brainWebSearch

    /**
     * One-tap ONLINE ⇄ OFFLINE. Going offline forces the local brain and disables web
     * lookups (nothing leaves the device). Going online lets the brain search the web.
     */
    fun toggleOnlineMode() {
        viewModelScope.launch {
            val s = settingsStore.settings.first()
            if (isOnline(s)) {
                settingsStore.update(engineMode = EngineMode.EMBEDDED, provider = Provider.BRAIN)
                settingsStore.updateBrain(webSearch = false)
                appendAssistant("○ OFFLINE — local brain only. Nothing leaves this device.")
            } else {
                settingsStore.updateBrain(webSearch = true)
                appendAssistant("● ONLINE — I'll look things up on the web when I don't know.")
            }
            checkConnection()
        }
    }

    /** One tap to fully offline: embedded engine + the on-device brain. */
    fun useBrain() {
        viewModelScope.launch {
            settingsStore.update(engineMode = EngineMode.EMBEDDED, provider = Provider.BRAIN)
            checkConnection()
        }
    }

    fun saveBrainSettings(
        llmMode: String? = null, model: String? = null, promptFormat: String? = null,
        gpu: Boolean? = null, temperature: Float? = null,
        personaEverywhere: Boolean? = null, offlineFallback: Boolean? = null,
        autonomy: String? = null, suggestBetter: Boolean? = null, adaptivePersona: Boolean? = null,
        webSearch: Boolean? = null,
    ) {
        viewModelScope.launch {
            settingsStore.updateBrain(llmMode, model, promptFormat, gpu, temperature,
                personaEverywhere, offlineFallback, autonomy, suggestBetter, adaptivePersona, webSearch)
            checkConnection()
        }
    }

    // --- teachable memory (also drives the Settings memory list) ---
    fun lessons() = memory.all()
    fun forgetLesson(id: Long) = memory.forget(id)
    fun clearMemory() = memory.clear()
}
