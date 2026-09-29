package com.omerta.agent.ui

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import com.omerta.agent.names
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

/**
 * Saved conversations, grouped by project.
 *
 * Chats were not persisted at all for several releases -- the endpoint existed
 * and nothing called it -- so anything said before that is genuinely gone.
 * What is here is what has been saved since.
 */
@Composable
fun ChatsScreen(vm: ChatViewModel) {
    val st by vm.state.collectAsStateWithLifecycleCompat()
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var projects by remember { mutableStateOf<List<String>>(emptyList()) }
    var chats by remember { mutableStateOf<List<JSONObject>>(emptyList()) }
    var archived by remember { mutableStateOf(false) }
    var note by remember { mutableStateOf("") }
    var good by remember { mutableStateOf(false) }
    var renaming by remember { mutableStateOf<JSONObject?>(null) }
    var unlocking by remember { mutableStateOf<JSONObject?>(null) }
    var draft by remember { mutableStateOf("") }
    var newProject by remember { mutableStateOf("") }
    var exporting by remember { mutableStateOf<String?>(null) }

    suspend fun refresh() {
        projects = OmertaClient.chatProjects().names("projects")
        val r = OmertaClient.chatList(st.project, archived)
        note = r.err(); good = false
        chats = r.list("chats").filter { it.optBoolean("archived", false) == archived }
        if (projects.isEmpty()) projects = r.names("projects")
    }

    // Export hands back a bundle, not a file. Writing it where the system
    // picker says keeps it out of app-private storage, so it survives the app
    // being uninstalled -- which is the only reason to export anything.
    val saver = rememberLauncherForActivityResult(
        ActivityResultContracts.CreateDocument("application/json")
    ) { uri: Uri? ->
        val id = exporting
        exporting = null
        if (uri == null || id == null) return@rememberLauncherForActivityResult
        scope.launch {
            val bundle = OmertaClient.chatExport(id)
            val e = bundle.err()
            if (e.isNotEmpty()) { note = e; good = false; return@launch }
            val wrote = withContext(Dispatchers.IO) {
                runCatching {
                    ctx.contentResolver.openOutputStream(uri)?.use {
                        it.write(bundle.toString().toByteArray())
                    }
                }
            }
            good = wrote.isSuccess
            note = if (good) "exported ${bundle.optInt("count")} chats"
                   else "could not write that file"
        }
    }

    val loader = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenDocument()
    ) { uri: Uri? ->
        if (uri == null) return@rememberLauncherForActivityResult
        scope.launch {
            val text = withContext(Dispatchers.IO) {
                runCatching {
                    ctx.contentResolver.openInputStream(uri)
                        ?.bufferedReader()?.use { it.readText() } ?: ""
                }
            }
            val parsed = text.mapCatching { JSONObject(it) }
            parsed.onSuccess { bundle ->
                val r = OmertaClient.chatImport(
                    JSONObject().put("bundle", bundle).put("project", st.project))
                good = r.err().isEmpty()
                note = r.err().ifEmpty { "imported ${r.optInt("imported", 0)}" }
                refresh()
            }.onFailure { note = "that is not a chat export"; good = false }
        }
    }

    LaunchedEffect(st.project, archived) { refresh() }

    LazyColumn(
        Modifier.fillMaxSize().background(Ink),
        contentPadding = PaddingValues(12.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            Section("Project", trailing = st.project) {
                if (projects.isEmpty()) Empty("none yet")
                projects.chunked(3).forEach { row ->
                    Row(Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        row.forEach { p ->
                            Chip(p, p == st.project, Modifier.weight(1f)) {
                                vm.setProject(p)
                            }
                        }
                        repeat(3 - row.size) { Spacer(Modifier.weight(1f)) }
                    }
                    Spacer(Modifier.height(6.dp))
                }
                Spacer(Modifier.height(4.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Field(newProject, { newProject = it }, "new project",
                          Modifier.weight(1f))
                    Chip("ADD", false) {
                        if (newProject.isNotBlank()) scope.launch {
                            val r = OmertaClient.newProject(newProject.trim())
                            good = r.err().isEmpty()
                            note = r.err().ifEmpty { "project ${r.optString("name")}" }
                            if (good) vm.setProject(newProject.trim())
                            newProject = ""
                            vm.refreshProjects()
                            refresh()
                        }
                    }
                }
                Spacer(Modifier.height(8.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Chip("NEW CHAT", false, Modifier.weight(1f), tint = Good) {
                        scope.launch {
                            OmertaClient.chatNew(st.project)
                            vm.clear()
                            refresh()
                        }
                    }
                    Chip(if (archived) "SHOW LIVE" else "SHOW ARCHIVED",
                         false, Modifier.weight(1f)) { archived = !archived }
                }
                Spacer(Modifier.height(8.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Chip("IMPORT A BUNDLE", false, Modifier.weight(1f)) {
                        loader.launch(arrayOf("application/json", "*/*"))
                    }
                    Chip("LOCK EVERYTHING", false, Modifier.weight(1f), tint = Blood) {
                        scope.launch {
                            OmertaClient.chatAction("", "lock_all")
                            good = false
                            note = "every private chat is locked again"
                            refresh()
                        }
                    }
                }
            }
        }

        item {
            Section(if (archived) "Archived" else "Conversations",
                    trailing = "${chats.size}") {
                if (chats.isEmpty()) Empty(
                    if (archived) "nothing archived" else "no saved conversations yet")
                chats.forEach { c ->
                    val id = c.optString("id")
                    val locked = c.optBoolean("locked", false)
                    ListRow(
                        c.optString("title").ifEmpty { id },
                        detail = "${c.optInt("messages", 0)} messages" +
                                 (c.optInt("queued", 0).takeIf { it > 0 }
                                     ?.let { " · $it queued" } ?: ""),
                        right = if (locked) "locked" else null,
                        rightColor = Amber,
                        selected = id == st.chatId,
                    ) {
                        scope.launch {
                            if (locked) { draft = ""; unlocking = c }
                            else vm.loadChat(OmertaClient.chatOpen(id))
                        }
                    }
                    Spacer(Modifier.height(6.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        Chip("RENAME", false, Modifier.weight(1f)) {
                            draft = c.optString("title"); renaming = c
                        }
                        Chip("BRANCH", false, Modifier.weight(1f)) {
                            scope.launch {
                                val r = OmertaClient.chatAction(id, "branch")
                                good = r.err().isEmpty()
                                note = r.err().ifEmpty { "branched" }
                                refresh()
                            }
                        }
                        Chip(if (archived) "RESTORE" else "ARCHIVE",
                             false, Modifier.weight(1f)) {
                            scope.launch {
                                OmertaClient.chatAction(id, "archive",
                                    JSONObject().put("archived", !archived))
                                refresh()
                            }
                        }
                    }
                    Spacer(Modifier.height(6.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        Chip("EXPORT", false, Modifier.weight(1f)) {
                            exporting = id
                            saver.launch(
                                (c.optString("title").ifEmpty { id })
                                    .replace(Regex("[^A-Za-z0-9._-]"), "_") + ".json")
                        }
                        Chip("LOCK", false, Modifier.weight(1f)) {
                            scope.launch { OmertaClient.chatAction(id, "lock"); refresh() }
                        }
                        Chip("DELETE", false, Modifier.weight(1f), tint = Blood) {
                            scope.launch {
                                val r = OmertaClient.chatAction(id, "delete")
                                good = r.err().isEmpty()
                                note = r.err().ifEmpty {
                                    "deleted ${r.optString("title", "")}"
                                }
                                refresh()
                            }
                        }
                    }
                    Spacer(Modifier.height(10.dp))
                }
                Note(note, if (good) Good else Ember)
            }
        }
    }

    renaming?.let { c ->
        AlertDialog(
            onDismissRequest = { renaming = null },
            containerColor = Panel,
            title = { Text("Rename", color = TextHi,
                           style = MaterialTheme.typography.titleMedium) },
            text = { Field(draft, { draft = it }, "title", mono = false) },
            confirmButton = {
                TextButton({
                    val id = c.optString("id")
                    val title = draft
                    renaming = null
                    scope.launch {
                        OmertaClient.chatAction(id, "rename",
                            JSONObject().put("title", title))
                        refresh()
                    }
                }) { Text("SAVE", color = Good) }
            },
            dismissButton = {
                TextButton({ renaming = null }) { Text("CANCEL", color = TextLo) }
            },
        )
    }

    unlocking?.let { c ->
        AlertDialog(
            onDismissRequest = { unlocking = null },
            containerColor = Panel,
            title = { Text("Locked chat", color = TextHi,
                           style = MaterialTheme.typography.titleMedium) },
            text = {
                Column {
                    Text("The passcode is not stored anywhere. A wrong one " +
                         "cannot be told apart from a corrupted file, because " +
                         "nothing on this device knows the right one.",
                         style = MaterialTheme.typography.bodySmall, color = TextLo)
                    Spacer(Modifier.height(8.dp))
                    Secret(draft, { draft = it }, "passcode")
                }
            },
            confirmButton = {
                TextButton({
                    val id = c.optString("id")
                    val code = draft
                    unlocking = null
                    scope.launch {
                        val r = OmertaClient.chatAction(id, "unlock",
                            JSONObject().put("passcode", code))
                        val e = r.err()
                        if (e.isEmpty()) vm.loadChat(OmertaClient.chatOpen(id))
                        else { note = e; good = false }
                        refresh()
                    }
                }) { Text("UNLOCK", color = Good) }
            },
            dismissButton = {
                TextButton({ unlocking = null }) { Text("CANCEL", color = TextLo) }
            },
        )
    }
}
