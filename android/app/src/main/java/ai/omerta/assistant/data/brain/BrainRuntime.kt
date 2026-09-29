package ai.omerta.assistant.data.brain

import android.content.Context
import android.net.Uri
import ai.omerta.assistant.data.local.BrainLlmMode
import ai.omerta.assistant.data.local.OmertaSettings
import ai.omerta.assistant.data.model.WireMessage
import ai.omerta.assistant.data.remote.StreamEvent
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.io.File

/**
 * Process-wide owner of the active brain: the offline engine, its storage and the
 * optional on-device LLM. Shared by chat (via ChatRepository) and the Brain screen.
 */
class BrainRuntime private constructor(context: Context) {

    val store = BrainStore(context.applicationContext)
    val llm = OnDeviceLlm(context.applicationContext)
    private val inboxDir: File? = context.applicationContext.getExternalFilesDir("inbox")?.apply { mkdirs() }
    private val lock = Mutex()
    private val engine = BrainEngine(store.loadActive())

    private val _brain = MutableStateFlow(engine.brain)
    /** Live view of the active brain for the UI. */
    val brain: StateFlow<BrainFile> = _brain.asStateFlow()

    private val _status = MutableStateFlow("")
    /** Human-readable status of the on-device model ("loading…", errors). */
    val status: StateFlow<String> = _status.asStateFlow()

    private fun commit() {
        store.save(engine.brain)
        _brain.value = engine.brain
    }

    /** Runs a mutation on the engine and persists it. */
    suspend fun <T> edit(block: (BrainEngine) -> T): T = withContext(Dispatchers.IO) {
        lock.withLock { block(engine).also { commit() } }
    }

    fun greeting(): String = engine.greeting()

    suspend fun newConversation() = edit { it.newConversation() }

    fun modelFile(s: OmertaSettings): File? {
        val all = store.models()
        if (all.isEmpty()) return null
        return all.firstOrNull { it.name == s.brainModel } ?: all.first()
    }

    /** Brain personality + relevant knowledge, for online providers ("persona everywhere"). */
    fun systemPromptFor(input: String): String = engine.systemPrompt(input)

    /**
     * Answers the last user turn fully offline.
     *  - Teaching / trained replies / skills are always handled by the brain engine.
     *  - With a model file present, [BrainLlmMode] decides when the on-device LLM speaks,
     *    grounded in the brain's persona and retrieved knowledge.
     */
    fun stream(s: OmertaSettings, history: List<WireMessage>, prefix: String = ""): Flow<StreamEvent> = flow {
        val input = history.lastOrNull { it.role == "user" }?.content.orEmpty()
        val reply = withContext(Dispatchers.IO) {
            lock.withLock {
                if (s.adaptivePersona) engine.observeUser(input)
                engine.respond(input).also { commit() }
            }
        }
        if (prefix.isNotEmpty()) emit(StreamEvent.Delta(prefix))

        val model = modelFile(s)
        val useLlm = model != null && when (s.brainLlmMode) {
            BrainLlmMode.ALWAYS -> reply.kind != BrainReply.Kind.TAUGHT && reply.kind != BrainReply.Kind.REFLEX
            BrainLlmMode.ASSIST -> reply.deferToModel
            else -> false
        }
        if (useLlm && model != null) {
            if (llm.loadedModel != model.name) _status.value = "loading ${model.name}…"
            val loaded = llm.ensureLoaded(model, maxTokens = 2048, gpu = s.brainGpu)
            if (loaded.isSuccess) {
                _status.value = "on-device: ${model.name}"
                var system = engine.systemPrompt(input)
                if (reply.kind == BrainReply.Kind.KNOWLEDGE || reply.kind == BrainReply.Kind.SKILL) {
                    system += "\n\nYour memory already answered this — rephrase it in character:\n${reply.text}"
                }
                var any = false
                val ok = runCatching {
                    llm.stream(system, history, s.brainPromptFormat, s.brainTemperature).collect { c ->
                        if (c is OnDeviceLlm.Chunk.Text && c.text.isNotEmpty()) { any = true; emit(StreamEvent.Delta(c.text)) }
                    }
                }
                if (ok.isSuccess && any) {
                    emit(StreamEvent.Done("${engine.brain.persona.name} · ${model.name}", "stop")); return@flow
                }
                ok.exceptionOrNull()?.let { _status.value = "model error: ${it.message}" }
            } else {
                _status.value = "model failed to load: ${loaded.exceptionOrNull()?.message}"
                emit(StreamEvent.Delta("[on-device model unavailable — brain-only reply]\n"))
            }
        }
        // Pure brain reply, "typed" out so it feels alive.
        for (piece in reply.text.split(Regex("(?<=\\s)"))) {
            emit(StreamEvent.Delta(piece)); delay(12)
        }
        emit(StreamEvent.Done("brain · ${engine.brain.persona.name}", "stop"))
    }.flowOn(Dispatchers.Default)

    // ---------------------------------------------------------------- library ops

    suspend fun switchTo(id: String) = withContext(Dispatchers.IO) {
        lock.withLock {
            val b = store.load(id) ?: error("brain not found: $id")
            store.save(engine.brain)
            engine.replace(b); store.setActive(b.id); _brain.value = b
        }
    }

    suspend fun createBrain(name: String) = withContext(Dispatchers.IO) {
        val b = store.create(name.trim().ifBlank { "New Brain" })
        switchTo(b.id)
    }

    suspend fun deleteActive() = withContext(Dispatchers.IO) {
        val id = engine.brain.id
        store.delete(id)
        val next = store.list().firstOrNull() ?: store.install(store.factoryDefault())
        switchTo(next.id)
    }

    suspend fun resetActive() = edit { e ->
        val d = store.factoryDefault()
        e.replace(d.copy(id = e.brain.id, name = e.brain.name, persona = d.persona.copy(name = e.brain.persona.name)))
    }

    data class ImportResult(val brains: Int, val documents: Int, val chunks: Int, val activated: String?)

    /** Imports `.brain`/`.json` (installs + activates), `.zip`, or documents (teaches the active brain). */
    suspend fun import(uri: Uri): ImportResult = withContext(Dispatchers.IO) {
        val items = store.readImport(uri)
        var brains = 0; var docs = 0; var chunks = 0; var activated: String? = null
        for (it in items.filterIsInstance<BrainStore.Imported.Brain>()) {
            val installed = store.install(it.brain)
            brains++; activated = installed.id
        }
        activated?.let { switchTo(it) }
        for (d in items.filterIsInstance<BrainStore.Imported.Document>()) {
            if (d.text.isBlank()) continue
            chunks += edit { e -> e.learnDocument(d.text, d.name, topic = d.name.substringBeforeLast('.')) }
            docs++
        }
        ImportResult(brains, docs, chunks, activated?.let { engine.brain.name })
    }

    /**
     * Auto-install anything dropped into `Android/data/<pkg>/files/inbox/` (e.g. by
     * `omerta_brain.py push` over adb). Processed files move to `inbox/imported/`.
     */
    suspend fun scanInbox(): List<String> = withContext(Dispatchers.IO) {
        val inbox = inboxDir ?: return@withContext emptyList()
        val done = File(inbox, "imported").apply { mkdirs() }
        val notes = mutableListOf<String>()
        inbox.listFiles { f -> f.isFile }.orEmpty().sortedBy { it.name }.forEach { f ->
            runCatching { import(Uri.fromFile(f)) }
                .onSuccess { r ->
                    notes += if (r.brains > 0) "installed brain \"${r.activated}\" from ${f.name}"
                    else "learned ${f.name} → ${r.chunks} chunk(s)"
                }
                .onFailure { notes += "could not import ${f.name}: ${it.message}" }
            f.renameTo(File(done, f.name))
        }
        notes
    }

    suspend fun export(uri: Uri) = withContext(Dispatchers.IO) { store.export(engine.brain, uri) }

    suspend fun exportEncrypted(uri: Uri, password: String) =
        withContext(Dispatchers.IO) { store.exportEncrypted(engine.brain, uri, password) }

    /** Import a plain or password-encrypted brain and activate it. */
    suspend fun importMaybeEncrypted(uri: Uri, password: String?): String = withContext(Dispatchers.IO) {
        val installed = if (store.isEncryptedFile(uri)) {
            require(!password.isNullOrEmpty()) { "password required" }
            store.importEncrypted(uri, password)
        } else {
            (store.readImport(uri).filterIsInstance<BrainStore.Imported.Brain>().firstOrNull()
                ?: error("no brain in that file")).brain.let { store.install(it) }
        }
        switchTo(installed.id); installed.name
    }

    fun versions(): List<BrainStore.Version> = store.versions(engine.brain.id)

    suspend fun restoreVersion(timestamp: Long): Boolean = withContext(Dispatchers.IO) {
        lock.withLock {
            val restored = store.restoreVersion(engine.brain.id, timestamp) ?: return@withLock false
            engine.replace(restored); _brain.value = restored; true
        }
    }

    /** Restore every brain from a .zip/.brain backup, then activate the first one. */
    suspend fun importAll(uri: Uri): Int = withContext(Dispatchers.IO) {
        val n = store.restoreAll(uri)
        store.list().firstOrNull()?.let { switchTo(it.id) }
        n
    }

    suspend fun importModel(uri: Uri, onProgress: (Long, Long) -> Unit): File = withContext(Dispatchers.IO) {
        store.importModel(uri, onProgress)
    }

    suspend fun downloadModel(url: String, onProgress: (Long, Long) -> Unit): File = withContext(Dispatchers.IO) {
        store.downloadModel(url.trim(), onProgress)
    }

    fun deleteModel(name: String) {
        if (llm.loadedModel == name) llm.unload()
        store.deleteModel(name)
    }

    companion object {
        @Volatile private var instance: BrainRuntime? = null
        fun get(context: Context): BrainRuntime =
            instance ?: synchronized(this) { instance ?: BrainRuntime(context).also { instance = it } }

        /** Tests only: drop the process singleton (each Robolectric test gets a fresh data dir). */
        internal fun resetForTests() { instance?.llm?.unload(); instance = null }
    }
}
