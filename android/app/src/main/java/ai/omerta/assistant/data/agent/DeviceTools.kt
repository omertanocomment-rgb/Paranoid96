package ai.omerta.assistant.data.agent

import android.content.Context
import android.os.Build
import android.os.Environment
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.util.concurrent.TimeUnit

/**
 * On-device tools for Agent mode. Every call is gated by an approval callback in the
 * ViewModel before it runs. File access honors Android's storage model: with
 * "all files access" (MANAGE_EXTERNAL_STORAGE) granted the base is /sdcard, otherwise
 * the app's own external dir.
 */
class DeviceTools(private val context: Context) {

    private val http = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS).readTimeout(30, TimeUnit.SECONDS).build()

    fun hasAllFilesAccess(): Boolean =
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && Environment.isExternalStorageManager()

    fun baseDir(): File = when {
        hasAllFilesAccess() -> Environment.getExternalStorageDirectory()
        else -> context.getExternalFilesDir(null) ?: context.filesDir
    }

    private fun resolve(path: String): File {
        val p = path.trim()
        val f = if (p.startsWith("/")) File(p) else File(baseDir(), p)
        return f.canonicalFile
    }

    fun listDir(path: String): String {
        val dir = resolve(path)
        if (!dir.exists()) return "not found: ${dir.path}"
        if (!dir.isDirectory) return "not a directory: ${dir.path}"
        val entries = dir.listFiles()?.sortedBy { it.name } ?: emptyList()
        return buildString {
            appendLine(dir.path)
            for (e in entries) appendLine("${if (e.isDirectory) "d" else "-"} ${e.name} (${e.length()}b)")
        }.trim()
    }

    fun readFile(path: String, maxBytes: Int = 40_000): String {
        val f = resolve(path)
        if (!f.exists() || !f.isFile) return "not found: ${f.path}"
        val bytes = f.readBytes()
        val text = String(bytes.copyOf(minOf(bytes.size, maxBytes)))
        return if (bytes.size > maxBytes) "$text\n…[truncated ${bytes.size - maxBytes} bytes]" else text
    }

    fun writeFile(path: String, content: String): String {
        val f = resolve(path)
        f.parentFile?.mkdirs()
        f.writeText(content)
        return "wrote ${content.toByteArray().size} bytes to ${f.path}"
    }

    fun fetchUrl(url: String, maxBytes: Int = 40_000): String {
        if (!url.startsWith("http")) return "url must be http(s)"
        return runCatching {
            http.newCall(Request.Builder().url(url).get().build()).execute().use { r ->
                val body = r.body?.string().orEmpty()
                val clipped = body.take(maxBytes)
                "HTTP ${r.code}\n$clipped"
            }
        }.getOrElse { "fetch error: ${it.message}" }
    }

    /** Dispatch a tool call by name. */
    fun execute(name: String, input: Map<String, String>): String {
        return when (name) {
            "list_dir" -> listDir(input["path"] ?: ".")
            "read_file" -> input["path"]?.let { readFile(it) } ?: "path required"
            "write_file" -> input["path"]?.let { writeFile(it, input["content"] ?: "") } ?: "path required"
            "fetch_url" -> input["url"]?.let { fetchUrl(it) } ?: "url required"
            else -> "unknown tool: $name"
        }
    }

    companion object {
        /** Client-tool schemas advertised to the Messages API in Agent mode. */
        fun schemas(): JsonArray = buildJsonArray {
            add(tool("list_dir", "List files in a directory on the device.") {
                putJsonObject("path") { put("type", "string"); put("description", "Directory path (relative to base or absolute).") }
            })
            add(tool("read_file", "Read a text file from the device.", listOf("path")) {
                putJsonObject("path") { put("type", "string") }
            })
            add(tool("write_file", "Write a text file to the device.", listOf("path", "content")) {
                putJsonObject("path") { put("type", "string") }
                putJsonObject("content") { put("type", "string") }
            })
            add(tool("fetch_url", "HTTP GET a URL and return the body.", listOf("url")) {
                putJsonObject("url") { put("type", "string") }
            })
        }

        private fun tool(name: String, desc: String, required: List<String> = emptyList(),
                         props: JsonObjectBuilderScope) = buildJsonObject {
            put("name", name)
            put("description", desc)
            putJsonObject("input_schema") {
                put("type", "object")
                putJsonObject("properties") { props() }
                if (required.isNotEmpty()) {
                    put("required", buildJsonArray { required.forEach { add(it) } })
                }
            }
        }
    }
}

private typealias JsonObjectBuilderScope = kotlinx.serialization.json.JsonObjectBuilder.() -> Unit
