package ai.omerta.assistant.data.brain

import android.content.Context
import ai.omerta.assistant.data.model.WireMessage
import com.google.mediapipe.tasks.genai.llminference.LlmInference
import com.google.mediapipe.tasks.genai.llminference.LlmInferenceSession
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.io.File

/**
 * Fully offline on-device LLM (Google MediaPipe LLM Inference).
 *
 * Load any MediaPipe-compatible model file you copied onto the phone — e.g.
 * `gemma3-1b-it-int4.task` (~550 MB), Gemma 2 2B, Phi-2, Qwen 2.5 `.task`. The brain
 * supplies personality + retrieved knowledge as the system prompt, so the small model
 * speaks as *your* brain and answers from what you taught it.
 */
class OnDeviceLlm(private val context: Context) {

    sealed class Chunk {
        data class Text(val text: String) : Chunk()
        data class Done(val model: String) : Chunk()
    }

    private var engine: LlmInference? = null
    private var loadedPath: String? = null
    private val lock = Mutex()

    val loadedModel: String? get() = loadedPath?.let { File(it).name }

    suspend fun ensureLoaded(model: File, maxTokens: Int, gpu: Boolean): Result<Unit> = lock.withLock {
        if (engine != null && loadedPath == model.absolutePath) return Result.success(Unit)
        runCatching {
            unload()
            val opts = LlmInference.LlmInferenceOptions.builder()
                .setModelPath(model.absolutePath)
                .setMaxTokens(maxTokens.coerceIn(256, 8192))
                .setMaxTopK(64)
                .setPreferredBackend(if (gpu) LlmInference.Backend.GPU else LlmInference.Backend.CPU)
                .build()
            engine = LlmInference.createFromOptions(context, opts)
            loadedPath = model.absolutePath
        }
    }

    fun unload() {
        runCatching { engine?.close() }
        engine = null; loadedPath = null
    }

    /** Streams a reply. The prompt is formatted for the model family (Gemma/ChatML/Phi/Llama 3). */
    fun stream(
        system: String,
        history: List<WireMessage>,
        format: String,
        temperature: Float,
    ): Flow<Chunk> = callbackFlow {
        val llm = engine ?: run { close(IllegalStateException("on-device model not loaded")); return@callbackFlow }
        val fmt = resolveFormat(format, loadedPath.orEmpty())
        val prompt = PromptFormat.build(fmt, system, trimHistory(llm, system, history))
        val session = LlmInferenceSession.createFromOptions(
            llm,
            LlmInferenceSession.LlmInferenceSessionOptions.builder()
                .setTemperature(temperature.coerceIn(0f, 2f))
                .setTopK(40).setTopP(0.95f)
                .build(),
        )
        session.addQueryChunk(prompt)
        val stopMarkers = PromptFormat.stops(fmt)
        val acc = StringBuilder()
        var emitted = 0
        session.generateResponseAsync { partial, done ->
            acc.append(partial)
            // Hold back text that could be the start of a stop marker; cut at a real one.
            var text = acc.toString()
            val cut = stopMarkers.map { text.indexOf(it) }.filter { it >= 0 }.minOrNull()
            if (cut != null) text = text.substring(0, cut)
            val safeEnd = if (cut != null || done) text.length else (text.length - 12).coerceAtLeast(emitted)
            if (safeEnd > emitted) {
                trySend(Chunk.Text(text.substring(emitted, safeEnd))); emitted = safeEnd
            }
            if (done || cut != null) {
                if (cut != null) runCatching { session.cancelGenerateResponseAsync() }
                trySend(Chunk.Done(loadedModel ?: "on-device"))
                close()
            }
        }
        awaitClose { runCatching { session.cancelGenerateResponseAsync() }; runCatching { session.close() } }
    }.flowOn(Dispatchers.Default)

    /** Keeps the most recent turns that fit the model's context window. */
    private fun trimHistory(llm: LlmInference, system: String, history: List<WireMessage>): List<WireMessage> {
        val budget = 1400
        var used = runCatching { llm.sizeInTokens(system) }.getOrDefault(system.length / 4)
        val kept = ArrayDeque<WireMessage>()
        for (m in history.asReversed()) {
            val t = runCatching { llm.sizeInTokens(m.content) }.getOrDefault(m.content.length / 4) + 8
            if (kept.isNotEmpty() && used + t > budget) break
            kept.addFirst(m); used += t
        }
        return kept.toList()
    }

    companion object {
        fun resolveFormat(format: String, path: String): String {
            if (format != "auto") return format
            val n = path.lowercase()
            return when {
                "gemma" in n -> "gemma"
                "qwen" in n || "smol" in n || "chatml" in n -> "chatml"
                "phi" in n -> "phi"
                "llama" in n -> "llama3"
                else -> "gemma"
            }
        }
    }
}

/** Chat templates for common small on-device model families. Pure — unit tested. */
object PromptFormat {
    val ALL = listOf("auto", "gemma", "chatml", "phi", "llama3", "raw")

    fun build(format: String, system: String, history: List<WireMessage>): String {
        val sb = StringBuilder()
        when (format) {
            "chatml" -> {
                sb.append("<|im_start|>system\n").append(system).append("<|im_end|>\n")
                history.forEach { sb.append("<|im_start|>${it.role}\n${it.content}<|im_end|>\n") }
                sb.append("<|im_start|>assistant\n")
            }
            "phi" -> {
                sb.append("<|system|>\n").append(system).append("<|end|>\n")
                history.forEach { sb.append(if (it.role == "user") "<|user|>\n" else "<|assistant|>\n").append(it.content).append("<|end|>\n") }
                sb.append("<|assistant|>\n")
            }
            "llama3" -> {
                sb.append("<|start_header_id|>system<|end_header_id|>\n\n").append(system).append("<|eot_id|>")
                history.forEach { sb.append("<|start_header_id|>${it.role}<|end_header_id|>\n\n${it.content}<|eot_id|>") }
                sb.append("<|start_header_id|>assistant<|end_header_id|>\n\n")
            }
            "raw" -> {
                sb.append(system).append("\n\n")
                history.forEach { sb.append(if (it.role == "user") "User: " else "Assistant: ").append(it.content).append('\n') }
                sb.append("Assistant: ")
            }
            else -> { // gemma: no system role — fold it into the first user turn
                history.forEachIndexed { i, m ->
                    val role = if (m.role == "user") "user" else "model"
                    val body = if (i == 0 && m.role == "user") "$system\n\n${m.content}" else m.content
                    sb.append("<start_of_turn>$role\n$body<end_of_turn>\n")
                }
                if (history.isEmpty()) sb.append("<start_of_turn>user\n$system<end_of_turn>\n")
                sb.append("<start_of_turn>model\n")
            }
        }
        return sb.toString()
    }

    fun stops(format: String): List<String> = when (format) {
        "chatml" -> listOf("<|im_end|>", "<|im_start|>")
        "phi" -> listOf("<|end|>", "<|user|>", "<|endoftext|>")
        "llama3" -> listOf("<|eot_id|>", "<|start_header_id|>")
        "raw" -> listOf("\nUser:", "\nuser:")
        else -> listOf("<end_of_turn>", "<start_of_turn>")
    }
}
