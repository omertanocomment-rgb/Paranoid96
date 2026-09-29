package ai.omerta.assistant.data.agent

import android.content.Context
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * A local, viewable audit log of everything the agent does on the device. Because the
 * agent can run shell/root and touch files, every tool call — proposed, approved, denied,
 * and its result — is appended here so the operator has an honest record. Never leaves
 * the device; capped so it can't grow without bound.
 */
class AgentLog(context: Context) {

    private val file = File(context.filesDir, "agent-actions.log")
    private val fmt = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US)
    private val maxBytes = 512 * 1024

    @Synchronized
    fun record(tool: String, input: Map<String, String>, risk: RiskLevel, decision: String, result: String? = null) {
        val line = buildString {
            append(fmt.format(Date())).append("  [").append(risk).append("] ").append(decision)
            append("  ").append(tool).append(' ').append(input.toString().take(300))
            if (result != null) append("\n    → ").append(result.replace("\n", " ").take(300))
        }
        runCatching {
            if (file.exists() && file.length() > maxBytes) trim()
            file.appendText(line + "\n")
        }
    }

    fun read(maxLines: Int = 400): List<String> =
        runCatching { file.readLines().takeLast(maxLines).asReversed() }.getOrDefault(emptyList())

    fun clear() { runCatching { file.writeText("") } }

    private fun trim() {
        runCatching {
            val kept = file.readLines().takeLast(2000)
            file.writeText(kept.joinToString("\n") + "\n")
        }
    }
}
