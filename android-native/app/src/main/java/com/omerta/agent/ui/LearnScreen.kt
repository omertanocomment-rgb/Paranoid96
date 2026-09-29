package com.omerta.agent.ui

import android.net.Uri
import android.util.Base64
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.omerta.agent.OmertaClient
import com.omerta.agent.err
import com.omerta.agent.list
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

/**
 * What OMERTA has been taught.
 *
 * Two different things live here and they are not the same. A DOCUMENT is a
 * file you handed over: it is chunked into memory and can be taken back out
 * whole. LEARNED BEHAVIOUR is what it inferred from what you approved and
 * refused -- nobody typed it, and it is the part worth reading before
 * wondering why the agent keeps doing something.
 */
@Composable
fun LearnScreen(vm: ChatViewModel) {
    val st by vm.state.collectAsStateWithLifecycleCompat()
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var docs by remember { mutableStateOf<List<JSONObject>>(emptyList()) }
    var behaviour by remember { mutableStateOf<JSONObject?>(null) }
    var path by remember { mutableStateOf("") }
    var note by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var shelfDir by remember { mutableStateOf("") }

    suspend fun refresh() {
        val r = OmertaClient.learnList(st.project)
        docs = r.list("documents")
        shelfDir = r.optString("dir", "")
        behaviour = OmertaClient.learnBehaviour(st.project)
    }

    // Read the file the picker returned and hand it over as base64, so one
    // plain JSON POST covers a PDF and a text file alike.
    val picker = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenDocument()
    ) { uri: Uri? ->
        if (uri == null) return@rememberLauncherForActivityResult
        busy = true
        scope.launch {
            val payload = withContext(Dispatchers.IO) {
                runCatching {
                    val bytes = ctx.contentResolver.openInputStream(uri)
                        ?.use { it.readBytes() } ?: ByteArray(0)
                    displayName(ctx, uri) to Base64.encodeToString(bytes, Base64.NO_WRAP)
                }
            }
            payload.onSuccess { (name, b64) ->
                val r = OmertaClient.learnUpload(name, b64, st.project)
                note = r.err().ifEmpty {
                    if (r.optBoolean("already_known")) "already on the shelf: $name"
                    else "learned $name — ${r.optInt("chunks")} chunks"
                }
                refresh()
            }.onFailure { note = "could not read that file: ${it.message}" }
            busy = false
        }
    }

    LaunchedEffect(st.project) { refresh() }

    // Files shared from another app. The manifest has accepted shares since
    // the web build and the Compose rebuild left them unhandled, so the share
    // sheet listed OMERTA and nothing happened.
    val shared by Intake.files.collectAsStateWithLifecycleCompat()
    LaunchedEffect(shared) {
        val taken = Intake.takeFiles()
        if (taken.isEmpty()) return@LaunchedEffect
        busy = true
        var learned = 0
        for (raw in taken) {
            val uri = Uri.parse(raw)
            val read = withContext(Dispatchers.IO) {
                runCatching {
                    val bytes = ctx.contentResolver.openInputStream(uri)
                        ?.use { it.readBytes() } ?: ByteArray(0)
                    displayName(ctx, uri) to Base64.encodeToString(bytes, Base64.NO_WRAP)
                }
            }
            read.onSuccess { (name, b64) ->
                val r = OmertaClient.learnUpload(name, b64, st.project, "shared")
                if (r.err().isEmpty()) learned += 1 else note = r.err()
            }.onFailure { note = "could not read a shared file: ${it.message}" }
        }
        if (learned > 0) note = "learned $learned shared file(s)"
        busy = false
        refresh()
    }

    LazyColumn(
        Modifier.fillMaxSize().background(Ink),
        contentPadding = PaddingValues(12.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            Section("Teach it something", trailing = st.project) {
                Chip(if (busy) "READING…" else "PICK A FILE", false,
                     Modifier.fillMaxWidth(), tint = Good) {
                    if (!busy) picker.launch(arrayOf("*/*"))
                }
                Spacer(Modifier.height(8.dp))
                Field(path, { path = it }, "…or a path on this device")
                Spacer(Modifier.height(8.dp))
                Chip("LEARN PATH", false, Modifier.fillMaxWidth()) {
                    if (path.isNotBlank()) scope.launch {
                        val r = OmertaClient.learnAddPath(path.trim(), st.project)
                        note = r.err().ifEmpty {
                            "learned ${r.optString("name", path)}" +
                                (r.optInt("count", 0).takeIf { it > 0 }
                                    ?.let { " ($it files)" } ?: "")
                        }
                        path = ""
                        refresh()
                    }
                }
                Note(note, if (note.startsWith("learned")) Good else Ember)
            }
        }

        item {
            Section("Documents", trailing = "${docs.size}") {
                if (docs.isEmpty()) Empty("nothing learned in this project yet")
                docs.forEach { d ->
                    ListRow(
                        d.optString("name"),
                        detail = "${d.optInt("chunks")} chunks · " +
                                 bytesLabel(d.optLong("bytes", 0)) +
                                 (if (!d.optBoolean("text", true)) " · not text" else ""),
                        right = "FORGET",
                        rightColor = Ember,
                        mono = true,
                    ) {
                        scope.launch {
                            val r = OmertaClient.learnForgetDoc(d.optString("id"))
                            note = r.err().ifEmpty { "forgotten" }
                            refresh()
                        }
                    }
                    Spacer(Modifier.height(6.dp))
                }
                if (shelfDir.isNotEmpty()) {
                    Note("shelf: $shelfDir")
                }
            }
        }

        item {
            Section("Learned behaviour") {
                val counts = behaviour?.optJSONObject("counts")
                val prefs = behaviour?.optString("preferences", "") ?: ""
                if (counts == null || counts.length() == 0) {
                    Empty("nothing inferred yet — it learns from what you approve")
                } else {
                    counts.keys().forEach { k ->
                        ListRow(k, right = "${counts.optInt(k)}")
                        Spacer(Modifier.height(6.dp))
                    }
                }
                if (prefs.isNotEmpty()) {
                    Spacer(Modifier.height(4.dp))
                    Text("WHAT IT THINKS YOU WANT",
                         style = MaterialTheme.typography.labelSmall, color = Ember)
                    Spacer(Modifier.height(4.dp))
                    Text(prefs, style = MaterialTheme.typography.bodySmall, color = TextLo)
                }
                val choices = behaviour?.optJSONObject("choices")
                if (choices != null && choices.length() > 0) {
                    Spacer(Modifier.height(10.dp))
                    Text("DECISIONS, BY SUBJECT",
                         style = MaterialTheme.typography.labelSmall, color = Ember)
                    Spacer(Modifier.height(4.dp))
                    // choice_stats is {subject: {decision: count}} -- a subject
                    // you approved five times and refused once is the useful
                    // row here, not a single global tally.
                    choices.keys().forEach { subject ->
                        val d = choices.optJSONObject(subject) ?: return@forEach
                        ListRow(
                            subject,
                            detail = "approved ${d.optInt("approved", 0)} · " +
                                     "refused ${d.optInt("denied", 0)}",
                            mono = true,
                        )
                        Spacer(Modifier.height(6.dp))
                    }
                }
            }
        }
    }
}

/** The file's own name, not the opaque document-provider id. */
private fun displayName(ctx: android.content.Context, uri: Uri): String {
    val cursor = runCatching {
        ctx.contentResolver.query(uri, null, null, null, null)
    }.getOrNull()
    cursor?.use {
        val i = it.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME)
        if (i >= 0 && it.moveToFirst()) {
            val n = it.getString(i)
            if (!n.isNullOrEmpty()) return n
        }
    }
    return uri.lastPathSegment?.substringAfterLast('/') ?: "document"
}
