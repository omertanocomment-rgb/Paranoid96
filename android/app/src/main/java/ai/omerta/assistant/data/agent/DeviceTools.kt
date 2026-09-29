package ai.omerta.assistant.data.agent

import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Environment
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.File
import java.util.concurrent.TimeUnit

/**
 * On-device tools for Agent mode, on the operator's own device. Every call is gated by
 * an approval callback in the ViewModel (with a [Risk] assessment) before it runs.
 *
 * File access honors Android's storage model: with "all files access"
 * (MANAGE_EXTERNAL_STORAGE) granted the base is /sdcard, otherwise the app's own dir.
 * Shell access uses, in order: a rooted `su` shell when requested/available, the Termux
 * bridge (RUN_COMMAND) when Termux is installed and configured, else a plain in-process
 * shell. This is the "root / computer access" path for owned-device automation.
 */
class DeviceTools(private val context: Context) {

    private val http = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS).readTimeout(60, TimeUnit.SECONDS).build()

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

    // ---------------------------------------------------------------- files

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

    fun deleteFile(path: String): String {
        val f = resolve(path)
        if (!f.exists()) return "not found: ${f.path}"
        val ok = f.deleteRecursively()
        return if (ok) "deleted ${f.path}" else "could not delete ${f.path}"
    }

    fun moveFile(from: String, to: String): String {
        val src = resolve(from); val dst = resolve(to)
        if (!src.exists()) return "not found: ${src.path}"
        dst.parentFile?.mkdirs()
        if (dst.exists()) dst.deleteRecursively()
        return if (src.renameTo(dst)) "moved ${src.path} → ${dst.path}"
        else runCatching { src.copyRecursively(dst, overwrite = true); src.deleteRecursively(); "moved (copied) ${src.path} → ${dst.path}" }
            .getOrElse { "could not move: ${it.message}" }
    }

    // ---------------------------------------------------------------- network

    fun httpRequest(url: String, method: String = "GET", body: String? = null,
                    headers: String? = null, maxBytes: Int = 60_000): String {
        if (!url.startsWith("http")) return "url must be http(s)"
        return runCatching {
            val b = body?.let { it.toRequestBody((detectMedia(headers) ?: "text/plain").toMediaTypeOrNull()) }
            val req = Request.Builder().url(url).method(method.uppercase(), b).apply {
                headers?.lineSequence()?.forEach { line ->
                    val i = line.indexOf(':'); if (i > 0) header(line.take(i).trim(), line.substring(i + 1).trim())
                }
            }.build()
            http.newCall(req).execute().use { r ->
                "HTTP ${r.code}\n${r.body?.string().orEmpty().take(maxBytes)}"
            }
        }.getOrElse { "request error: ${it.message}" }
    }

    private fun detectMedia(headers: String?): String? =
        headers?.lineSequence()?.firstOrNull { it.startsWith("content-type", true) }
            ?.substringAfter(':')?.trim()

    // ---------------------------------------------------------------- device / shell

    fun deviceInfo(): String = buildString {
        appendLine("model: ${Build.MANUFACTURER} ${Build.MODEL}")
        appendLine("android: ${Build.VERSION.RELEASE} (SDK ${Build.VERSION.SDK_INT})")
        appendLine("abis: ${Build.SUPPORTED_ABIS.joinToString()}")
        appendLine("all-files access: ${hasAllFilesAccess()}")
        appendLine("rooted: ${isRooted()}")
        appendLine("termux bridge: ${hasTermux()}")
        appendLine("base dir: ${baseDir().path}")
    }.trim()

    fun listPackages(): String = runCatching {
        val pm = context.packageManager
        pm.getInstalledPackages(0).map { it.packageName }.sorted().joinToString("\n")
    }.getOrElse { "could not list packages: ${it.message}" }

    fun isRooted(): Boolean =
        listOf("/sbin/su", "/system/bin/su", "/system/xbin/su", "/su/bin/su", "/data/adb/magisk")
            .any { File(it).exists() } || runCatching {
            Runtime.getRuntime().exec(arrayOf("which", "su")).inputStream.bufferedReader().readText().isNotBlank()
        }.getOrDefault(false)

    fun hasTermux(): Boolean = runCatching {
        context.packageManager.getPackageInfo("com.termux", 0); true
    }.getOrDefault(false)

    /**
     * Runs a shell command on the operator's own device.
     *  - `root=true` (or a rooted device): executes through `su -c` for full-device reach.
     *  - otherwise, uses the standard in-process shell (`sh -c`).
     * For an interactive Termux session (packages, sensors, real PATH), the Termux
     * RUN_COMMAND bridge is used when installed and `termux=true`.
     */
    fun runShell(command: String, root: Boolean = false, termux: Boolean = false, timeoutSec: Int = 60): String {
        if (command.isBlank()) return "command required"
        if (termux && hasTermux()) return runTermux(command)
        val argv = when {
            root || isRooted() && root -> arrayOf("su", "-c", command)
            else -> arrayOf("sh", "-c", command)
        }
        return runCatching {
            val proc = Runtime.getRuntime().exec(argv)
            val finished = proc.waitForCompat(timeoutSec.toLong())
            val out = proc.inputStream.bufferedReader().readText()
            val err = proc.errorStream.bufferedReader().readText()
            if (!finished) { proc.destroy(); return "timed out after ${timeoutSec}s\n$out$err" }
            buildString {
                append("exit ${proc.exitValue()}\n")
                if (out.isNotBlank()) append(out)
                if (err.isNotBlank()) append("\n[stderr]\n$err")
            }.trim().take(60_000)
        }.getOrElse { "shell error: ${it.message}${if (root) " (is the device rooted and su granted?)" else ""}" }
    }

    /** Fires a Termux RUN_COMMAND intent. Requires Termux with allow-external-apps=true. */
    private fun runTermux(command: String): String = runCatching {
        val intent = Intent().apply {
            setClassName("com.termux", "com.termux.app.RunCommandService")
            action = "com.termux.RUN_COMMAND"
            putExtra("com.termux.RUN_COMMAND_PATH", "/data/data/com.termux/files/usr/bin/bash")
            putExtra("com.termux.RUN_COMMAND_ARGUMENTS", arrayOf("-c", command))
            putExtra("com.termux.RUN_COMMAND_BACKGROUND", true)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent)
        else context.startService(intent)
        "dispatched to Termux: $command\n(Termux runs it in the background; check Termux for output.)"
    }.getOrElse { "Termux bridge failed: ${it.message}. In Termux set allow-external-apps=true in ~/.termux/termux.properties." }

    private fun Process.waitForCompat(seconds: Long): Boolean =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) waitFor(seconds, TimeUnit.SECONDS)
        else { Thread.sleep(seconds * 1000); runCatching { exitValue(); true }.getOrDefault(false) }

    // ---------------------------------------------------------------- dispatch

    fun execute(name: String, input: Map<String, String>): String = when (name) {
        "list_dir" -> listDir(input["path"] ?: ".")
        "read_file" -> input["path"]?.let { readFile(it) } ?: "path required"
        "write_file" -> input["path"]?.let { writeFile(it, input["content"] ?: "") } ?: "path required"
        "delete_file" -> input["path"]?.let { deleteFile(it) } ?: "path required"
        "move_file" -> {
            val from = input["from"]; val to = input["to"]
            if (from == null || to == null) "from and to required" else moveFile(from, to)
        }
        "fetch_url" -> input["url"]?.let { httpRequest(it, "GET") } ?: "url required"
        "http_request" -> input["url"]?.let {
            httpRequest(it, input["method"] ?: "GET", input["body"], input["headers"])
        } ?: "url required"
        "device_info" -> deviceInfo()
        "list_packages" -> listPackages()
        "run_shell" -> input["command"]?.let {
            runShell(it, root = input["root"].equals("true", true), termux = input["termux"].equals("true", true))
        } ?: "command required"
        else -> "unknown tool: $name"
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
            add(tool("write_file", "Create or overwrite a text file on the device.", listOf("path", "content")) {
                putJsonObject("path") { put("type", "string") }
                putJsonObject("content") { put("type", "string") }
            })
            add(tool("delete_file", "Delete a file or folder on the device.", listOf("path")) {
                putJsonObject("path") { put("type", "string") }
            })
            add(tool("move_file", "Move or rename a file/folder.", listOf("from", "to")) {
                putJsonObject("from") { put("type", "string") }
                putJsonObject("to") { put("type", "string") }
            })
            add(tool("fetch_url", "HTTP GET a URL and return the body.", listOf("url")) {
                putJsonObject("url") { put("type", "string") }
            })
            add(tool("http_request", "Make an HTTP request (GET/POST/PUT/DELETE) with optional body and headers.", listOf("url")) {
                putJsonObject("url") { put("type", "string") }
                putJsonObject("method") { put("type", "string"); put("description", "GET, POST, PUT, PATCH or DELETE") }
                putJsonObject("body") { put("type", "string") }
                putJsonObject("headers") { put("type", "string"); put("description", "One 'Name: value' per line.") }
            })
            add(tool("device_info", "Report device model, OS, root/Termux availability and storage access.") {})
            add(tool("list_packages", "List installed app package names.") {})
            add(tool("run_shell",
                "Run a shell command on the operator's own device. Set root=true for a su shell " +
                    "(full device access on rooted devices), or termux=true to run it in Termux.",
                listOf("command")) {
                putJsonObject("command") { put("type", "string") }
                putJsonObject("root") { put("type", "boolean"); put("description", "Run via su (root). Owned-device use only.") }
                putJsonObject("termux") { put("type", "boolean"); put("description", "Run inside Termux via its RUN_COMMAND bridge.") }
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
