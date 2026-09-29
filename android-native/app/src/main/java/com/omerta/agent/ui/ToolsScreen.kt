package com.omerta.agent.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.omerta.agent.OmertaClient
import com.omerta.agent.err
import com.omerta.agent.list
import kotlinx.coroutines.launch
import org.json.JSONObject

/**
 * Everything that is not chat: the other device, the sandbox, what this has
 * cost, what it remembers, and getting it all off the phone.
 *
 * These surfaces are LOCAL-ONLY in core/dispatch -- a shell, a sandbox that
 * executes commands, adb to another handset and an encrypted archive of
 * everything you own. They are you operating your own hardware rather than the
 * agent acting, which is exactly why none of them may be driven from another
 * machine, and why none of them go through the approval gate.
 */
@Composable
fun ToolsScreen(vm: ChatViewModel) {
    val st by vm.state.collectAsStateWithLifecycleCompat()
    LazyColumn(
        Modifier.fillMaxSize().background(Ink),
        contentPadding = PaddingValues(12.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item { AdbPanel() }
        item { ScratchPanel() }
        item { MemoryPanel(st.project) }
        item { CostPanel(st.project) }
        item { AttachmentPanel(st.project) }
        item { SyncPanel() }
        item { BackupPanel() }
        item { HistoryPanel() }
        item { PluginPanel() }
    }
}

// ── adb over the network ────────────────────────────────────────────────────

@Composable
private fun AdbPanel() {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var host by remember { mutableStateOf("") }
    var port by remember { mutableStateOf("5555") }
    var cmd by remember { mutableStateOf("getprop ro.product.model") }
    var out by remember { mutableStateOf("") }
    var pub by remember { mutableStateOf("") }

    Section("Another device (adb over TCP)") {
        Text("Pair the other phone first: Developer options → Wireless " +
             "debugging. The key below is this device's; the other one has to " +
             "accept it once.",
             style = MaterialTheme.typography.bodySmall, color = TextLo)
        Spacer(Modifier.height(8.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Field(host, { host = it }, "192.168.1.50", Modifier.weight(2f))
            Field(port, { port = it }, "5555", Modifier.weight(1f))
        }
        Spacer(Modifier.height(8.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Chip("CONNECT", false, Modifier.weight(1f)) {
                scope.launch {
                    val r = OmertaClient.adb("connect", JSONObject()
                        .put("host", host.trim()).put("port", portOf(port)))
                    out = r.err().ifEmpty { r.optString("banner", "connected") }
                }
            }
            Chip("INFO", false, Modifier.weight(1f)) {
                scope.launch {
                    val r = OmertaClient.adb("info", JSONObject()
                        .put("host", host.trim()).put("port", portOf(port)))
                    out = r.err().ifEmpty { r.optString("banner", "") }
                }
            }
            Chip("MY KEY", false, Modifier.weight(1f)) {
                scope.launch {
                    val r = OmertaClient.adb("pubkey")
                    pub = r.optString("key", "")
                    out = r.err()
                }
            }
        }
        Spacer(Modifier.height(8.dp))
        Field(cmd, { cmd = it }, "shell command")
        Spacer(Modifier.height(8.dp))
        Chip("RUN ON THAT DEVICE", false, Modifier.fillMaxWidth(), tint = Amber) {
            scope.launch {
                val r = OmertaClient.adb("shell", JSONObject()
                    .put("host", host.trim()).put("port", portOf(port))
                    .put("cmd", cmd))
                out = r.err().ifEmpty { r.optString("output", "") }
            }
        }
        if (pub.isNotEmpty()) {
            Spacer(Modifier.height(8.dp))
            Mono(pub, max = 120)
            Spacer(Modifier.height(6.dp))
            Chip("COPY KEY", false, Modifier.fillMaxWidth()) { copy(ctx, pub) }
        }
        if (out.isNotEmpty()) {
            Spacer(Modifier.height(8.dp))
            Mono(out)
        }
    }
}

private fun portOf(s: String) = s.trim().toIntOrNull() ?: 5555

// ── the scratch sandbox ─────────────────────────────────────────────────────

@Composable
private fun ScratchPanel() {
    val scope = rememberCoroutineScope()
    var boxes by remember { mutableStateOf<List<JSONObject>>(emptyList()) }
    var picked by remember { mutableStateOf<String?>(null) }
    var name by remember { mutableStateOf("") }
    var cmd by remember { mutableStateOf("") }
    var out by remember { mutableStateOf("") }
    var changes by remember { mutableStateOf("") }

    suspend fun refresh() {
        val r = OmertaClient.scratchList()
        boxes = r.list("sandboxes")
        if (picked != null && boxes.none { it.optString("id") == picked }) picked = null
    }

    LaunchedEffect(Unit) { refresh() }

    Section("Sandbox", trailing = "${boxes.size}") {
        Text("A copy of the project that can be built and run for real. " +
             "Nothing reaches the real tree until you accept it.",
             style = MaterialTheme.typography.bodySmall, color = TextLo)
        Spacer(Modifier.height(8.dp))
        Field(name, { name = it }, "name a new sandbox")
        Spacer(Modifier.height(8.dp))
        Chip("CREATE", false, Modifier.fillMaxWidth(), tint = Good) {
            scope.launch {
                val r = OmertaClient.scratchNew(name.ifBlank { "scratch" })
                out = r.err().ifEmpty {
                    "copied ${r.optInt("files")} files (" +
                        bytesLabel(r.optLong("bytes", 0)) + ")"
                }
                name = ""
                refresh()
            }
        }
        Spacer(Modifier.height(10.dp))
        if (boxes.isEmpty()) Empty("no sandboxes")
        boxes.forEach { b ->
            val id = b.optString("id")
            ListRow(
                b.optString("name").ifEmpty { id },
                detail = b.optString("path"),
                right = if (b.optBoolean("exists", true)) null else "files gone",
                rightColor = Ember,
                selected = picked == id,
                mono = true,
            ) { picked = if (picked == id) null else id }
            Spacer(Modifier.height(6.dp))
        }
        picked?.let { id ->
            Spacer(Modifier.height(4.dp))
            Field(cmd, { cmd = it }, "command to run inside it")
            Spacer(Modifier.height(8.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Chip("RUN", false, Modifier.weight(1f), tint = Amber) {
                    scope.launch {
                        val r = OmertaClient.scratchRun(id, cmd)
                        out = describeRun(r)
                    }
                }
                Chip("CHANGES", false, Modifier.weight(1f)) {
                    scope.launch {
                        val r = OmertaClient.scratchChanges(id)
                        changes = r.err().ifEmpty {
                            if (r.optBoolean("clean", false)) "nothing changed"
                            else "+${r.optJSONArray("added")?.length() ?: 0} " +
                                 "~${r.optJSONArray("modified")?.length() ?: 0} " +
                                 "-${r.optJSONArray("removed")?.length() ?: 0}"
                        }
                    }
                }
            }
            Spacer(Modifier.height(6.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Chip("ACCEPT INTO PROJECT", false, Modifier.weight(1f), tint = Good) {
                    scope.launch {
                        val r = OmertaClient.scratchAccept(id)
                        out = r.err().ifEmpty { "accepted" }
                        refresh()
                    }
                }
                Chip("DISCARD", false, Modifier.weight(1f), tint = Blood) {
                    scope.launch {
                        val r = OmertaClient.scratchDiscard(id)
                        out = r.err().ifEmpty { "discarded" }
                        picked = null
                        refresh()
                    }
                }
            }
            if (changes.isNotEmpty()) Note(changes, Amber)
        }
        if (out.isNotEmpty()) {
            Spacer(Modifier.height(8.dp))
            Mono(out)
        }
    }
}

/**
 * What a sandbox command actually did.
 *
 * A run can come back needing confirmation or refused by policy, and both of
 * those have an empty stdout. Printing stdout alone shows nothing at all and
 * reads as a command that ran and said nothing -- so the status leads.
 */
private fun describeRun(r: JSONObject): String {
    val e = r.err()
    if (e.isNotEmpty()) return e
    val body = (r.optString("stdout", "") + r.optString("stderr", "")).trim()
    return when (r.optString("status")) {
        "ran" -> "exit ${r.optInt("returncode", 0)}\n$body"
        "needs_confirmation" ->
            "held for approval (${r.optString("tier", "?")}) — answer it in CHAT"
        "denied_by_policy" ->
            "refused by policy: ${r.optString("reason", r.optString("tier", ""))}"
        else -> r.optString("status", "?") + (if (body.isEmpty()) "" else "\n$body")
    }
}

// ── memory ──────────────────────────────────────────────────────────────────

@Composable
private fun MemoryPanel(project: String) {
    val scope = rememberCoroutineScope()
    var q by remember { mutableStateOf("") }
    var hits by remember { mutableStateOf<List<JSONObject>>(emptyList()) }
    var prefs by remember { mutableStateOf("") }
    var searched by remember { mutableStateOf(false) }

    Section("Memory", trailing = project) {
        Field(q, { q = it }, "what does it remember about…")
        Spacer(Modifier.height(8.dp))
        Chip("RECALL", false, Modifier.fillMaxWidth()) {
            scope.launch {
                val r = OmertaClient.memory(q, project)
                hits = r.list("results")
                prefs = r.optString("preferences", "")
                searched = true
            }
        }
        Spacer(Modifier.height(8.dp))
        if (searched && hits.isEmpty()) Empty("nothing recalled")
        hits.take(20).forEach { h ->
            ListRow(h.optString("content").take(280),
                    detail = h.optString("kind", "fact") + " · " +
                             h.optString("tags", ""))
            Spacer(Modifier.height(6.dp))
        }
        if (prefs.isNotEmpty()) {
            Spacer(Modifier.height(4.dp))
            Mono(prefs, max = 160)
        }
    }
}

// ── what it has cost ────────────────────────────────────────────────────────

@Composable
private fun CostPanel(project: String) {
    val scope = rememberCoroutineScope()
    var u by remember { mutableStateOf<JSONObject?>(null) }
    var days by remember { mutableStateOf(30) }

    suspend fun refresh() { u = OmertaClient.usage(days) }
    LaunchedEffect(days) { refresh() }

    Section("Cost", trailing = "${days}d") {
        val t = u?.optJSONObject("total")
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf(7, 30, 90).forEach { d ->
                Chip("${d}d", days == d, Modifier.weight(1f)) { days = d }
            }
        }
        Spacer(Modifier.height(10.dp))
        if (t == null) Empty("no usage recorded")
        else {
            ListRow("calls", right = "${t.optInt("calls", 0)}")
            Spacer(Modifier.height(6.dp))
            ListRow("tokens in", right = "${t.optLong("in", 0)}")
            Spacer(Modifier.height(6.dp))
            ListRow("tokens out", right = "${t.optLong("out", 0)}")
            Spacer(Modifier.height(6.dp))
            ListRow("estimated spend",
                    right = String.format("$%.4f", t.optDouble("usd", 0.0)),
                    rightColor = Amber)
        }
        // The backend says when a number is estimated rather than reported.
        // Dropping that note turns an indication into a bill.
        u?.optJSONArray("note")?.let { notes ->
            for (i in 0 until notes.length()) Note(notes.optString(i), Warn)
        }
        u?.optString("note", "")?.takeIf { it.isNotEmpty() }?.let { Note(it, Warn) }
        Spacer(Modifier.height(8.dp))
        Chip("RESET THE METER", false, Modifier.fillMaxWidth(), tint = Blood) {
            scope.launch { OmertaClient.usageReset(); refresh() }
        }
    }
}

// ── attachments ─────────────────────────────────────────────────────────────

@Composable
private fun AttachmentPanel(project: String) {
    val scope = rememberCoroutineScope()
    var rows by remember { mutableStateOf<List<JSONObject>>(emptyList()) }
    var stats by remember { mutableStateOf<JSONObject?>(null) }

    suspend fun refresh() {
        val r = OmertaClient.attachments(project)
        rows = r.list("attachments")
        stats = r.optJSONObject("stats")
    }
    LaunchedEffect(project) { refresh() }

    Section("Attachments", trailing = "${rows.size}") {
        if (rows.isEmpty()) Empty("nothing uploaded")
        rows.forEach { a ->
            ListRow(a.optString("name"),
                    detail = bytesLabel(a.optLong("bytes", 0)),
                    right = "DELETE", rightColor = Ember, mono = true) {
                scope.launch { OmertaClient.attachDelete(a.optString("id")); refresh() }
            }
            Spacer(Modifier.height(6.dp))
        }
        stats?.let {
            Note("${it.optInt("count")} files · ${bytesLabel(it.optLong("bytes", 0))} · " +
                 "${bytesLabel(it.optLong("free", 0))} free")
        }
    }
}

// ── sync ────────────────────────────────────────────────────────────────────

@Composable
private fun SyncPanel() {
    val scope = rememberCoroutineScope()
    var s by remember { mutableStateOf<JSONObject?>(null) }
    var peer by remember { mutableStateOf("") }
    var token by remember { mutableStateOf("") }
    var note by remember { mutableStateOf("") }

    suspend fun refresh() { s = OmertaClient.syncStatus() }
    LaunchedEffect(Unit) { refresh() }

    Section("Sync", trailing = s?.optString("device", "")?.take(8) ?: "") {
        Text("Pull memory and chats from another OMERTA on the same network. " +
             "The peer needs its own token; nothing is pushed without one.",
             style = MaterialTheme.typography.bodySmall, color = TextLo)
        Spacer(Modifier.height(8.dp))
        Field(peer, { peer = it }, "http://192.168.1.50:8765")
        Spacer(Modifier.height(6.dp))
        Field(token, { token = it }, "that device's token")
        Spacer(Modifier.height(8.dp))
        Chip("SYNC NOW", false, Modifier.fillMaxWidth()) {
            scope.launch {
                val r = OmertaClient.syncRun(peer.trim(), token.trim())
                note = r.err().ifEmpty { "synced" }
                refresh()
            }
        }
        val peers = s?.optJSONObject("peers")
        if (peers != null && peers.length() > 0) {
            Spacer(Modifier.height(8.dp))
            peers.keys().forEach { k ->
                ListRow(k, detail = peers.optJSONObject(k)?.toString()?.take(120))
                Spacer(Modifier.height(6.dp))
            }
        }
        Note(note, if (note == "synced") Good else Ember)
    }
}

// ── encrypted backup ────────────────────────────────────────────────────────

@Composable
private fun BackupPanel() {
    val scope = rememberCoroutineScope()
    var est by remember { mutableStateOf<JSONObject?>(null) }
    var pass by remember { mutableStateOf("") }
    var path by remember { mutableStateOf("") }
    var note by remember { mutableStateOf("") }

    LaunchedEffect(Unit) { est = OmertaClient.backup("estimate") }

    Section("Backup", trailing = est?.let { bytesLabel(it.optLong("bytes", 0)) } ?: "") {
        Text("Everything this app holds, encrypted with a passphrase you " +
             "choose. There is no recovery if it is lost — that is the point.",
             style = MaterialTheme.typography.bodySmall, color = TextLo)
        Spacer(Modifier.height(8.dp))
        est?.list("items")?.forEach { i ->
            ListRow(i.optString("name"),
                    detail = "${i.optInt("files")} files",
                    right = bytesLabel(i.optLong("bytes", 0)), mono = true)
            Spacer(Modifier.height(6.dp))
        }
        Spacer(Modifier.height(4.dp))
        Secret(pass, { pass = it }, "passphrase (8+ characters)")
        Spacer(Modifier.height(8.dp))
        Chip("CREATE BACKUP", false, Modifier.fillMaxWidth(), tint = Good) {
            scope.launch {
                val r = OmertaClient.backup("create",
                    JSONObject().put("passphrase", pass))
                note = r.err().ifEmpty { "written ${r.optString("path", "")}" }
                pass = ""
            }
        }
        Spacer(Modifier.height(10.dp))
        Field(path, { path = it }, "path to an archive")
        Spacer(Modifier.height(6.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Chip("INSPECT", false, Modifier.weight(1f)) {
                scope.launch {
                    val r = OmertaClient.backup("inspect",
                        JSONObject().put("path", path.trim()))
                    note = r.err().ifEmpty {
                        "contains " + (r.optJSONArray("contains")?.length() ?: 0) +
                            " sections, " + r.optString("algorithm", "")
                    }
                }
            }
            // A restore is offered dry first on purpose: it reports what it
            // WOULD overwrite, and a restore onto a live install that turns
            // out to be the wrong archive is not undoable.
            Chip("DRY RESTORE", false, Modifier.weight(1f), tint = Amber) {
                scope.launch {
                    val r = OmertaClient.backup("restore", JSONObject()
                        .put("path", path.trim()).put("passphrase", pass)
                        .put("dry_run", true))
                    note = r.err().ifEmpty { "would restore: ${r.optString("status")}" }
                }
            }
        }
        Note(note, if (note.startsWith("written")) Good else Ember)
    }
}

// ── what it has done ────────────────────────────────────────────────────────

@Composable
private fun HistoryPanel() {
    var rows by remember { mutableStateOf<List<JSONObject>>(emptyList()) }
    LaunchedEffect(Unit) { rows = OmertaClient.history(60).list("history") }

    Section("Audit log", trailing = "${rows.size}") {
        if (rows.isEmpty()) Empty("nothing logged yet")
        rows.take(60).forEach { h ->
            ListRow(
                h.optString("cmd").ifEmpty { h.optString("kind", "event") },
                detail = h.optString("status", "") +
                         (h.optString("note", "").takeIf { it.isNotEmpty() }
                             ?.let { " · $it" } ?: ""),
                mono = true,
            )
            Spacer(Modifier.height(6.dp))
        }
    }
}

// ── plugins and connectors ──────────────────────────────────────────────────

@Composable
private fun PluginPanel() {
    val scope = rememberCoroutineScope()
    var note by remember { mutableStateOf("") }

    Section("Plugins and connectors") {
        Text("Reload after dropping a plugin into the data directory, or " +
             "after an MCP server restarts.",
             style = MaterialTheme.typography.bodySmall, color = TextLo)
        Spacer(Modifier.height(8.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Chip("RELOAD PLUGINS", false, Modifier.weight(1f)) {
                scope.launch {
                    val r = OmertaClient.reloadPlugins()
                    note = r.err().ifEmpty {
                        "loaded ${r.optJSONArray("plugins")?.length() ?: 0}"
                    }
                }
            }
            Chip("RECONNECT", false, Modifier.weight(1f)) {
                scope.launch {
                    val r = OmertaClient.reconnectConnectors()
                    note = r.err().ifEmpty { "reconnected" }
                }
            }
        }
        Note(note, if (note.startsWith("loaded") || note == "reconnected") Good else Ember)
    }
}

// ── shared bits ─────────────────────────────────────────────────────────────

@Composable
fun Mono(text: String, max: Int = 260) {
    Box(
        Modifier
            .fillMaxWidth()
            .heightIn(max = max.dp)
            .clip(RoundedCornerShape(5.dp))
            .background(Color.Black)
            .border(1.dp, Border, RoundedCornerShape(5.dp))
            .verticalScroll(rememberScrollState())
            .padding(8.dp),
    ) {
        Text(text, style = MaterialTheme.typography.labelSmall.copy(
            fontFamily = FontFamily.Monospace), color = TextHi)
    }
}

@Composable
fun Secret(value: String, onChange: (String) -> Unit, placeholder: String) {
    androidx.compose.material3.OutlinedTextField(
        value = value,
        onValueChange = onChange,
        placeholder = {
            Text(placeholder, color = TextLo,
                 style = MaterialTheme.typography.bodySmall)
        },
        visualTransformation = PasswordVisualTransformation(),
        textStyle = MaterialTheme.typography.bodySmall,
        singleLine = true,
        modifier = Modifier.fillMaxWidth(),
    )
}

fun copy(ctx: android.content.Context, text: String) {
    val cm = ctx.getSystemService(android.content.ClipboardManager::class.java)
    cm?.setPrimaryClip(android.content.ClipData.newPlainText("omerta", text))
}
