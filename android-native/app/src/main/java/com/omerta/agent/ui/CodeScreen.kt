package com.omerta.agent.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import com.omerta.agent.OmertaClient
import com.omerta.agent.err
import com.omerta.agent.list
import kotlinx.coroutines.launch
import org.json.JSONObject

/**
 * The editor. Browse the workspace, read a file, change it, save it.
 *
 * A save is never direct: propose describes the write and returns a diff
 * having written nothing, and only a commit moves the file, keeping a backup
 * as it goes. That is the same contract the agent itself is held to, so a
 * change made by hand and a change made by the model are equally recoverable.
 */
@Composable
fun CodeScreen() {
    var path by remember { mutableStateOf("") }
    var entries by remember { mutableStateOf<List<JSONObject>>(emptyList()) }
    var openPath by remember { mutableStateOf<String?>(null) }
    var content by remember { mutableStateOf("") }
    var original by remember { mutableStateOf("") }
    var diff by remember { mutableStateOf<String?>(null) }
    var note by remember { mutableStateOf("") }
    var good by remember { mutableStateOf(false) }
    var query by remember { mutableStateOf("") }
    var hits by remember { mutableStateOf<List<JSONObject>>(emptyList()) }
    var files by remember { mutableStateOf<List<String>>(emptyList()) }
    val scope = rememberCoroutineScope()

    suspend fun browse(p: String) {
        val r = OmertaClient.wsTree(p)
        note = r.err(); good = false
        if (note.isEmpty()) {
            path = r.optString("path", p)
            entries = r.list("entries")
            openPath = null
            hits = emptyList()
            files = emptyList()
        }
    }

    suspend fun open(target: String) {
        val r = OmertaClient.wsRead(target)
        note = r.err(); good = false
        if (note.isNotEmpty()) return
        if (r.optBoolean("binary", false)) {
            note = r.optString("note", "binary file — not editable here")
            return
        }
        content = r.optString("content", "")
        original = content
        openPath = r.optString("path", target)
        diff = null
    }

    LaunchedEffect(Unit) { browse("") }

    Column(Modifier.fillMaxSize().background(Ink)) {
        if (openPath == null) {
            LazyColumn(
                Modifier.weight(1f),
                contentPadding = PaddingValues(12.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                item {
                    Section("Search", trailing = path.ifEmpty { "roots" }) {
                        Field(query, { query = it }, "a symbol or a file name")
                        Spacer(Modifier.height(8.dp))
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Chip("SEARCH", false, Modifier.weight(1f)) {
                                scope.launch {
                                    val r = OmertaClient.wsSearch(query)
                                    note = r.err(); good = false
                                    // results mixes symbol records with plain
                                    // file paths -- both are strings to the
                                    // JSON array, so they are split here
                                    // rather than rendered as one blank row.
                                    val arr = r.optJSONArray("results")
                                    hits = arr?.let { a ->
                                        (0 until a.length()).mapNotNull { a.optJSONObject(it) }
                                    } ?: emptyList()
                                    files = arr?.let { a ->
                                        (0 until a.length())
                                            .filter { a.optJSONObject(it) == null }
                                            .map { a.optString(it) }
                                            .filter { it.isNotEmpty() }
                                    } ?: emptyList()
                                }
                            }
                            Chip("SYMBOL", false, Modifier.weight(1f)) {
                                scope.launch {
                                    val r = OmertaClient.wsSearch(query, symbol = true)
                                    note = r.err(); good = false
                                    hits = r.list("results")
                                    files = emptyList()
                                }
                            }
                            Chip("REINDEX", false, Modifier.weight(1f)) {
                                scope.launch {
                                    val r = OmertaClient.wsReindex()
                                    good = r.err().isEmpty()
                                    note = r.err().ifEmpty {
                                        "indexed ${r.optInt("files")} files, " +
                                            "${r.optInt("symbols")} symbols"
                                    }
                                }
                            }
                        }
                        Note(note, if (good) Good else Ember)
                    }
                }

                if (hits.isNotEmpty() || files.isNotEmpty()) {
                    item {
                        Section("Matches", trailing = "${hits.size + files.size}") {
                            hits.take(40).forEach { h ->
                                ListRow(
                                    h.optString("name"),
                                    detail = h.optString("file") + ":" +
                                             h.optInt("line"),
                                    right = h.optString("kind"),
                                    mono = true,
                                ) { scope.launch { open(h.optString("file")) } }
                                Spacer(Modifier.height(6.dp))
                            }
                            files.take(40).forEach { f ->
                                ListRow(f, right = "file", mono = true) {
                                    scope.launch { open(f) }
                                }
                                Spacer(Modifier.height(6.dp))
                            }
                        }
                    }
                }

                item {
                    Section("Files", trailing = "${entries.size}") {
                        if (path.isNotEmpty()) {
                            ListRow("..", right = "up") {
                                scope.launch {
                                    browse(path.substringBeforeLast('/', ""))
                                }
                            }
                            Spacer(Modifier.height(6.dp))
                        }
                        if (entries.isEmpty()) Empty("nothing here")
                        entries.forEach { e ->
                            val dir = e.optBoolean("dir", false)
                            ListRow(
                                e.optString("name"),
                                right = if (dir) "dir"
                                        else bytesLabel(e.optLong("size", 0)),
                                mono = true,
                            ) {
                                scope.launch {
                                    if (dir) browse(e.optString("path"))
                                    else open(e.optString("path"))
                                }
                            }
                            Spacer(Modifier.height(6.dp))
                        }
                    }
                }
            }
        } else {
            Column(Modifier.weight(1f).padding(12.dp)) {
                Row(Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween) {
                    Text(openPath!!, style = MaterialTheme.typography.labelSmall,
                         color = Ember, modifier = Modifier.weight(1f))
                    Text(if (content != original) "edited" else "unchanged",
                         style = MaterialTheme.typography.labelSmall,
                         color = if (content != original) Amber else TextLo)
                }
                Spacer(Modifier.height(8.dp))
                Box(
                    Modifier
                        .weight(1f)
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(6.dp))
                        .background(Color.Black)
                        .border(1.dp, Border, RoundedCornerShape(6.dp))
                        .verticalScroll(rememberScrollState())
                        .padding(10.dp),
                ) {
                    BasicTextField(
                        value = content,
                        onValueChange = { content = it },
                        textStyle = MaterialTheme.typography.labelSmall.copy(
                            color = TextHi, fontFamily = FontFamily.Monospace),
                        cursorBrush = SolidColor(Ember),
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                Note(note, if (good) Good else Ember)
                Spacer(Modifier.height(8.dp))
                Row(Modifier.navigationBarsPadding().imePadding(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Chip("BACK", false, Modifier.weight(1f)) {
                        openPath = null; diff = null; note = ""
                    }
                    Chip("REVIEW & SAVE", false, Modifier.weight(1f), tint = Amber) {
                        scope.launch {
                            val r = OmertaClient.wsPropose(openPath!!, content)
                            val e = r.err()
                            good = false
                            when {
                                e.isNotEmpty() -> note = e
                                r.optString("status") == "unchanged" ->
                                    note = r.optString("note", "no change")
                                else -> {
                                    diff = r.optString("diff", "")
                                    note = r.optString("action", "")
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // Nothing has been written at this point. The diff is what WOULD change,
    // and the file only moves when this is confirmed.
    diff?.let { d ->
        AlertDialog(
            onDismissRequest = { diff = null },
            containerColor = Panel,
            title = { Text("Save this?", color = TextHi,
                           style = MaterialTheme.typography.titleMedium) },
            text = {
                Column {
                    Text(note, style = MaterialTheme.typography.labelSmall,
                         color = Amber)
                    Spacer(Modifier.height(8.dp))
                    Mono(d.ifEmpty { "(new file)" }, max = 320)
                }
            },
            confirmButton = {
                TextButton({
                    val target = openPath ?: return@TextButton
                    val body = content
                    diff = null
                    scope.launch {
                        val r = OmertaClient.wsCommit(target, body)
                        good = r.err().isEmpty()
                        note = r.err().ifEmpty {
                            "written" + (r.optString("backup", "")
                                .takeIf { it.isNotEmpty() }
                                ?.let { " · backup kept" } ?: "")
                        }
                        if (good) original = body
                    }
                }) { Text("WRITE IT", color = Good) }
            },
            dismissButton = {
                TextButton({ diff = null }) { Text("CANCEL", color = TextLo) }
            },
        )
    }
}
