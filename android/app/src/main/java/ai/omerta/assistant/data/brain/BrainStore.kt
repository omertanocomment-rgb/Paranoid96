package ai.omerta.assistant.data.brain

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import java.io.File
import java.util.zip.ZipInputStream

/**
 * On-device library of brains + on-device model files.
 *
 *   files/brains/<id>.brain     one JSON file per brain
 *   files/brains/.active        id of the active brain
 *   files/models/<name>.task    imported on-device LLM weights (optional)
 *
 * The first launch seeds the bundled `assets/brains/omerta.brain`.
 */
class BrainStore(private val context: Context) {

    private val brainDir = File(context.filesDir, "brains").apply { mkdirs() }
    val modelDir = File(context.filesDir, "models").apply { mkdirs() }
    private val activeFile = File(brainDir, ".active")

    fun list(): List<BrainFile> = brainDir.listFiles { f -> f.name.endsWith(".brain") }
        .orEmpty().mapNotNull { f -> runCatching { BrainFile.parse(f.readText()) }.getOrNull() }
        .sortedBy { it.name.lowercase() }

    fun activeId(): String? = activeFile.takeIf { it.exists() }?.readText()?.trim()?.ifBlank { null }

    fun setActive(id: String) { activeFile.writeText(id) }

    /** Loads the active brain, seeding the bundled default on first run. */
    fun loadActive(): BrainFile {
        activeId()?.let { id -> load(id)?.let { return it } }
        val existing = list().firstOrNull()
        if (existing != null) { setActive(existing.id); return existing }
        val seeded = runCatching {
            BrainFile.parse(context.assets.open("brains/omerta.brain").bufferedReader().readText())
        }.getOrElse { BrainEngine.blank("omerta", "Omerta") }
        save(seeded); setActive(seeded.id)
        return seeded
    }

    fun load(id: String): BrainFile? = File(brainDir, "${safe(id)}.brain").takeIf { it.exists() }
        ?.let { runCatching { BrainFile.parse(it.readText()) }.getOrNull() }

    fun save(b: BrainFile) {
        val f = File(brainDir, "${safe(b.id)}.brain")
        val tmp = File(brainDir, "${safe(b.id)}.brain.tmp")
        tmp.writeText(b.encode()); tmp.renameTo(f)
    }

    fun delete(id: String) {
        File(brainDir, "${safe(id)}.brain").delete()
        if (activeId() == id) activeFile.delete()
    }

    fun create(name: String): BrainFile {
        var id = safe(name.lowercase().replace(' ', '-')).ifBlank { "brain" }
        if (File(brainDir, "$id.brain").exists()) id += "-" + System.currentTimeMillis().toString(36)
        val b = BrainEngine.blank(id, name)
        save(b)
        return b
    }

    /** Reset a brain back to the bundled default (keeps nothing learned). */
    fun factoryDefault(): BrainFile =
        BrainFile.parse(context.assets.open("brains/omerta.brain").bufferedReader().readText())

    // ------------------------------------------------------------- import / export

    sealed class Imported {
        data class Brain(val brain: BrainFile) : Imported()
        data class Document(val name: String, val text: String) : Imported()
    }

    /**
     * Reads a picked file. `.brain` / `.json` become a brain; `.zip` may hold a brain plus
     * documents; everything else textual (`.txt`, `.md`, `.csv`, `.html`, …) becomes a document
     * to teach the active brain.
     */
    fun readImport(uri: Uri): List<Imported> {
        val name = displayName(uri)
        val bytes = context.contentResolver.openInputStream(uri)?.use { it.readBytes() }
            ?: error("cannot open $name")
        if (name.endsWith(".zip", true) || (bytes.size > 4 && bytes[0] == 'P'.code.toByte() && bytes[1] == 'K'.code.toByte())) {
            val out = mutableListOf<Imported>()
            ZipInputStream(bytes.inputStream()).use { z ->
                while (true) {
                    val e = z.nextEntry ?: break
                    if (e.isDirectory) continue
                    val content = z.readBytes().toString(Charsets.UTF_8)
                    out += classify(e.name.substringAfterLast('/'), content)
                }
            }
            return out
        }
        return listOf(classify(name, bytes.toString(Charsets.UTF_8)))
    }

    private fun classify(name: String, text: String): Imported {
        val t = text.trimStart('﻿').trim()
        if ((name.endsWith(".brain", true) || name.endsWith(".json", true) || t.startsWith("{")) &&
            t.contains("omerta-brain/")) {
            return Imported.Brain(BrainFile.parse(t))
        }
        val clean = if (name.endsWith(".html", true) || name.endsWith(".htm", true))
            t.replace(Regex("(?is)<(script|style)[^>]*>.*?</\\1>"), " ").replace(Regex("<[^>]+>"), " ")
                .replace(Regex("[ \\t]+"), " ")
        else t
        return Imported.Document(name, clean)
    }

    /** Installs an imported brain; returns it (id de-duplicated if [keepBoth]). */
    fun install(b: BrainFile, keepBoth: Boolean = false): BrainFile {
        val target = if (keepBoth && load(b.id) != null)
            b.copy(id = b.id + "-" + System.currentTimeMillis().toString(36)) else b
        save(target)
        return target
    }

    fun export(b: BrainFile, uri: Uri) {
        context.contentResolver.openOutputStream(uri, "wt")?.use { it.write(b.encode().toByteArray()) }
            ?: error("cannot write export")
    }

    // ------------------------------------------------------------- model files

    fun models(): List<File> = modelDir.listFiles { f ->
        f.isFile && MODEL_EXT.any { f.name.endsWith(it, true) }
    }.orEmpty().sortedBy { it.name }

    /** Copies a picked model file into app storage (MediaPipe needs a real path). */
    fun importModel(uri: Uri, onProgress: (Long, Long) -> Unit): File {
        val name = safeFile(displayName(uri)).let { n ->
            if (MODEL_EXT.any { n.endsWith(it, true) }) n else "$n.task"
        }
        val total = size(uri)
        val dst = File(modelDir, name)
        val tmp = File(modelDir, "$name.part")
        context.contentResolver.openInputStream(uri)?.use { input ->
            tmp.outputStream().use { out ->
                val buf = ByteArray(1 shl 20)
                var done = 0L
                while (true) {
                    val n = input.read(buf); if (n < 0) break
                    out.write(buf, 0, n); done += n
                    onProgress(done, total)
                }
            }
        } ?: error("cannot open model")
        if (dst.exists()) dst.delete()
        tmp.renameTo(dst)
        return dst
    }

    fun deleteModel(name: String) { File(modelDir, safeFile(name)).delete() }

    private fun displayName(uri: Uri): String {
        runCatching {
            context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
                if (c.moveToFirst()) return c.getString(0) ?: "import"
            }
        }
        return uri.lastPathSegment?.substringAfterLast('/') ?: "import"
    }

    private fun size(uri: Uri): Long = runCatching {
        context.contentResolver.query(uri, arrayOf(OpenableColumns.SIZE), null, null, null)?.use { c ->
            if (c.moveToFirst()) c.getLong(0) else -1L
        } ?: -1L
    }.getOrDefault(-1L)

    private fun safe(s: String) = s.replace(Regex("[^A-Za-z0-9_-]"), "_").take(64)
    private fun safeFile(s: String) = s.replace(Regex("[^A-Za-z0-9._-]"), "_").take(96)

    companion object {
        val MODEL_EXT = listOf(".task", ".bin")
    }
}
