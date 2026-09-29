package com.omerta.agent.ui

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
import kotlinx.coroutines.launch
import org.json.JSONObject

@Composable
fun SettingsScreen(vm: ChatViewModel) {
    val st by vm.state.collectAsStateWithLifecycleCompat()
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var status by remember { mutableStateOf<JSONObject?>(null) }
    var models by remember { mutableStateOf<JSONObject?>(null) }
    var engine by remember { mutableStateOf<JSONObject?>(null) }
    var settings by remember { mutableStateOf<JSONObject?>(null) }
    var themes by remember { mutableStateOf<JSONObject?>(null) }
    var keyName by remember { mutableStateOf("ANTHROPIC_API_KEY") }
    var keyValue by remember { mutableStateOf("") }
    var saved by remember { mutableStateOf("") }
    var engineNote by remember { mutableStateOf("") }
    var filter by remember { mutableStateOf("") }
    var projectOnly by remember { mutableStateOf(false) }
    var secrets by remember { mutableStateOf<JSONObject?>(null) }
    var preflight by remember { mutableStateOf<JSONObject?>(null) }

    suspend fun refresh() {
        status = OmertaClient.status()
        models = OmertaClient.models()
        engine = OmertaClient.localai()
        settings = OmertaClient.settings()
        themes = OmertaClient.themes()
        preflight = OmertaClient.enginePreflight()
        secrets = OmertaClient.secretStatus(st.project)
    }

    LaunchedEffect(Unit) { refresh() }

    LazyColumn(
        Modifier.fillMaxSize().background(Ink),
        contentPadding = PaddingValues(14.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        item {
            Section("Find a setting") {
                Field(filter, { filter = it }, "type part of a name")
                if (filter.isNotEmpty()) {
                    Note("showing settings matching \"$filter\" — clear the box "
                         + "to see everything again", Amber)
                }
            }
        }

        item {
            Section("Model", trailing = st.provider) {
                val providers = status?.optJSONObject("providers")
                if (providers == null) Empty("checking…")
                else {
                    Chip("auto (best available)", st.provider == "auto",
                         Modifier.fillMaxWidth()) { vm.setProvider("auto") }
                    Spacer(Modifier.height(6.dp))
                    providers.keys().forEach { id ->
                        val p = providers.optJSONObject(id) ?: return@forEach
                        val ready = p.optBoolean("ready", false)
                        ListRow(
                            id,
                            // The backend works out WHY a provider is
                            // unavailable; showing only "unavailable" throws
                            // that away and leaves three different problems
                            // looking identical.
                            detail = if (!ready) p.optString("why", "") else null,
                            right = if (ready) "●" else "○",
                            rightColor = if (ready) Good else TextLo,
                            selected = st.provider == id,
                        ) { vm.setProvider(id) }
                        Spacer(Modifier.height(6.dp))
                    }
                }
            }
        }

        item {
            Section("Network", trailing = st.mode) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf("auto", "offline", "online").forEach { m ->
                        Chip(m.uppercase(), st.mode == m, Modifier.weight(1f)) {
                            vm.setMode(m)
                        }
                    }
                }
                Spacer(Modifier.height(6.dp))
                Text("OFFLINE excludes every provider that would leave this " +
                     "device, whether or not a key is set.",
                     style = MaterialTheme.typography.labelSmall, color = TextLo)
            }
        }

        item {
            Section("Approvals", trailing = st.policy) {
                Text("What the agent must ask about before it acts.",
                     style = MaterialTheme.typography.bodySmall, color = TextLo)
                Spacer(Modifier.height(8.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf("always" to "ALWAYS", "low_risk" to "CHANGES",
                           "high_risk" to "DANGER").forEach { (id, label) ->
                        Chip(label, st.policy == id, Modifier.weight(1f)) {
                            vm.setPolicy(id)
                        }
                    }
                }
            }
        }

        item {
            Section("API key",
                    trailing = if (projectOnly) st.project else "shared") {
                Text("Stored on this device only, 0600. Never leaves it except " +
                     "to the provider you pick.",
                     style = MaterialTheme.typography.bodySmall, color = TextLo)
                Spacer(Modifier.height(8.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Chip("EVERY PROJECT", !projectOnly, Modifier.weight(1f)) {
                        projectOnly = false
                    }
                    Chip("${st.project.uppercase()} ONLY", projectOnly,
                         Modifier.weight(1f), tint = Amber) { projectOnly = true }
                }
                // A project with its own keys does not fall back to the shared
                // one. Said here rather than discovered later, because the
                // failure looks like "the key stopped working".
                val own = secrets?.optJSONArray("project_keys")
                if (own != null && own.length() > 0) {
                    Note("${st.project} has its own: " +
                         (0 until own.length()).joinToString(", ") {
                             own.optString(it).removeSuffix("_API_KEY")
                         } + " — it will not fall back to the shared key",
                         Amber)
                }
                Spacer(Modifier.height(8.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    listOf("ANTHROPIC_API_KEY", "OPENAI_API_KEY",
                           "OPENROUTER_API_KEY", "GROQ_API_KEY").forEach { k ->
                        Chip(k.removeSuffix("_API_KEY"), keyName == k,
                             Modifier.weight(1f)) { keyName = k }
                    }
                }
                Spacer(Modifier.height(8.dp))
                Secret(keyValue, { keyValue = it }, "paste key")
                Spacer(Modifier.height(8.dp))
                Chip("SAVE KEY", false, Modifier.fillMaxWidth(), tint = Good) {
                    scope.launch {
                        val r = OmertaClient.putSecret(
                            keyName, keyValue,
                            if (projectOnly) st.project else null)
                        saved = r.err().ifEmpty {
                            if (projectOnly) "saved for ${st.project} only"
                            else "saved"
                        }
                        keyValue = ""
                        refresh()
                        vm.refreshStatus()
                    }
                }
                Note(saved, if (saved.startsWith("saved")) Good else Ember)
            }
        }

        item {
            Section("On-device engine",
                    trailing = if (engine?.optBoolean("running") == true) "running"
                               else "stopped") {
                Text("Runs on this phone. No key, no network, no other machine.",
                     style = MaterialTheme.typography.bodySmall, color = TextLo)
                Spacer(Modifier.height(8.dp))
                val running = engine?.optBoolean("running", false) == true
                val available = engine?.optBoolean("available", false) == true
                // Asked BEFORE start, because an engine that runs out of
                // memory takes the whole app down with it, and on a 32-bit
                // build the process dies with no traceback at all -- the app
                // just vanishes, which reads as a crash with no cause.
                preflight?.let { pre ->
                    val ram = pre.optLong("ram_available", 0)
                    if (ram > 0) {
                        ListRow("memory available", right = bytesLabel(ram))
                        Spacer(Modifier.height(6.dp))
                    }
                    pre.optDouble("temperature_c", -1.0).takeIf { it > 0 }?.let {
                        ListRow("device temperature",
                                right = String.format("%.0f°C", it),
                                rightColor = if (it >= 45) Warn else TextLo)
                        Spacer(Modifier.height(6.dp))
                    }
                    val blockers = pre.optJSONArray("blockers")
                    for (i in 0 until (blockers?.length() ?: 0)) {
                        Note(blockers!!.optString(i), Ember)
                    }
                    val warns = pre.optJSONArray("warnings")
                    for (i in 0 until (warns?.length() ?: 0)) {
                        Note(warns!!.optString(i), Warn)
                    }
                    Spacer(Modifier.height(4.dp))
                }
                if (!available) {
                    Note(engine?.optString("error", "")?.ifEmpty {
                        "no engine binary for this device"
                    } ?: "", Warn)
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Chip("START", running, Modifier.weight(1f), tint = Good) {
                        scope.launch {
                            val r = OmertaClient.localaiControl("start")
                            engineNote = r.err().ifEmpty { "started" }
                            refresh()
                        }
                    }
                    Chip("STOP", false, Modifier.weight(1f), tint = Blood) {
                        scope.launch {
                            val r = OmertaClient.localaiControl("stop")
                            engineNote = r.err().ifEmpty { "stopped" }
                            refresh()
                        }
                    }
                }
                engine?.optString("model", "")?.takeIf { it.isNotEmpty() }?.let {
                    Note("model: $it")
                }
                Note(engineNote, if (engineNote == "started") Good else Ember)
            }
        }

        item {
            Section("Weights", trailing = "${models?.optJSONArray("models")?.length() ?: 0}") {
                val rows = models?.list("models") ?: emptyList()
                if (rows.isEmpty()) Empty("catalogue unavailable")
                rows.forEach { m ->
                    ModelRow(m) { action ->
                        scope.launch {
                            OmertaClient.modelAction(action, m.optString("id"))
                            refresh()
                        }
                    }
                    Spacer(Modifier.height(8.dp))
                }
            }
        }

        item {
            Section("Theme", trailing = themes?.optString("active", "") ?: "") {
                val names = themes?.optJSONArray("themes")
                if (names == null || names.length() == 0) Empty("no themes")
                else for (i in 0 until names.length()) {
                    val t = names.optJSONObject(i)
                    val name = t?.optString("name") ?: names.optString(i)
                    if (name.isEmpty()) continue
                    ListRow(name,
                            detail = t?.optString("label", "")?.ifEmpty { null },
                            selected = name == themes?.optString("active")) {
                        scope.launch { OmertaClient.themeUse(name); refresh() }
                    }
                    Spacer(Modifier.height(6.dp))
                }
            }
        }

        // Every writable setting the backend exposes, rendered from its own
        // description of itself. A hard-coded list here goes stale the moment
        // a setting is added, and the one that gets forgotten is always the
        // one somebody needed.
        item {
            Section("All settings") {
                val table = settings?.optJSONObject("settings")
                if (table == null) Empty("unavailable")
                else table.keys().forEach { key ->
                    val spec = table.optJSONObject(key) ?: return@forEach
                    if (filter.isNotEmpty() &&
                        !key.contains(filter, true) &&
                        !spec.optString("label").contains(filter, true)
                    ) return@forEach
                    SettingRow(key, spec) { value ->
                        scope.launch {
                            val r = OmertaClient.setSettings(
                                JSONObject().put(key, value))
                            saved = r.err().ifEmpty {
                                r.optJSONObject("rejected")?.optString(key, "")
                                    ?.ifEmpty { "saved" } ?: "saved"
                            }
                            refresh()
                            vm.refreshStatus()
                        }
                    }
                    Spacer(Modifier.height(8.dp))
                }
                settings?.optString("data_dir", "")?.takeIf { it.isNotEmpty() }
                    ?.let { Note("data: $it") }
            }
        }

        item {
            ScheduleSection(st.project)
        }

        item {
            AuditSection()
        }

        item {
            HomeLauncherSection()
        }

        item {
            CrashSection()
        }

        item {
            PanicSection()
        }

        item {
            val b = status?.optJSONObject("build")
            Section("Build", trailing = b?.optString("version", "") ?: "") {
                val describe = b?.optString("describe") ?: "—"
                ListRow(describe, mono = true)
                Spacer(Modifier.height(6.dp))
                ListRow("channel", right = b?.optString("channel", "—"))
                Spacer(Modifier.height(6.dp))
                ListRow("built", right = b?.optString("built_at", "—"))
                Spacer(Modifier.height(8.dp))
                Chip("COPY BUILD INFO", false, Modifier.fillMaxWidth()) {
                    copy(ctx, b?.toString(2) ?: describe)
                }
            }
        }
    }
}

/**
 * One setting, rendered from the backend's own description of it.
 *
 * `choice` gets chips, `bool` gets a toggle, and everything else gets a field
 * that commits on SET rather than on every keystroke -- a settings write per
 * character is how you get a half-typed path saved.
 */
@Composable
private fun SettingRow(key: String, spec: JSONObject, onSet: (Any) -> Unit) {
    val kind = spec.optString("kind", "text")
    val value = spec.optString("value", "")
    var draft by remember(key, value) { mutableStateOf(value) }

    Column(Modifier.fillMaxWidth()) {
        Text(spec.optString("label", key),
             style = MaterialTheme.typography.bodySmall, color = TextHi)
        Spacer(Modifier.height(6.dp))
        when (kind) {
            "choice" -> {
                val choices = spec.optJSONArray("choices")
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    for (i in 0 until (choices?.length() ?: 0)) {
                        val c = choices!!.optString(i)
                        Chip(c.uppercase(), c == value, Modifier.weight(1f)) { onSet(c) }
                    }
                }
            }
            "bool" -> {
                val on = value == "1" || value.equals("true", true)
                Chip(if (on) "ON" else "OFF", on, Modifier.fillMaxWidth(),
                     tint = Good) { onSet(if (on) "0" else "1") }
            }
            else -> {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Field(draft, { draft = it }, key, Modifier.weight(1f))
                    Chip("SET", false) { onSet(draft) }
                }
            }
        }
    }
}

@Composable
private fun ModelRow(m: JSONObject, onAction: (String) -> Unit) {
    val installed = m.optBoolean("installed", false)
    val fits = m.optBoolean("fits", true)
    val job = m.optJSONObject("job")
    val gb = m.optLong("bytes", 0L) / 1_073_741_824.0
    Column(Modifier.fillMaxWidth()) {
        Row(Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween) {
            Text(m.optString("label"), style = MaterialTheme.typography.bodySmall,
                 color = if (fits) TextHi else TextLo)
            Text(String.format("%.2f GB", gb),
                 style = MaterialTheme.typography.labelSmall, color = TextLo)
        }
        if (m.optBoolean("suggested", false)) {
            Text("start here", style = MaterialTheme.typography.labelSmall, color = Good)
        }
        if (!fits) {
            Spacer(Modifier.height(4.dp))
            Text("too large for this device — it is 32-bit, so a process cannot " +
                 "address these weights plus their cache",
                 style = MaterialTheme.typography.labelSmall, color = Warn)
        }
        Spacer(Modifier.height(8.dp))
        when {
            job != null && job.optString("state") == "downloading" -> {
                val got = job.optLong("got", 0L)
                val total = job.optLong("total", 1L).coerceAtLeast(1L)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("${got * 100 / total}%",
                         style = MaterialTheme.typography.labelSmall, color = Amber)
                    Chip("STOP", false) { onAction("cancel") }
                }
            }
            installed -> Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("installed", style = MaterialTheme.typography.labelSmall,
                     color = Good)
                Chip("REMOVE", false) { onAction("remove") }
            }
            fits -> Chip("GET", false, Modifier.fillMaxWidth()) { onAction("download") }
        }
    }
}


/**
 * Use OMERTA as the phone's home screen.
 *
 * The alias ships DISABLED and deliberately so: enabling a HOME activity makes
 * every press of the home button show a chooser, which is a hostile thing to
 * do to somebody who has just installed an app. Android's own default-launcher
 * setting turns it back off, and so does this.
 */
@Composable
private fun HomeLauncherSection() {
    val ctx = LocalContext.current
    val alias = remember {
        android.content.ComponentName(ctx.packageName, "com.omerta.agent.HomeLauncher")
    }
    var on by remember {
        mutableStateOf(
            ctx.packageManager.getComponentEnabledSetting(alias) ==
                android.content.pm.PackageManager.COMPONENT_ENABLED_STATE_ENABLED
        )
    }
    Section("Home screen", trailing = if (on) "offered" else "off") {
        Text("Offer OMERTA as this phone's launcher. Android still asks which " +
             "one to use, and its default-app setting overrides this.",
             style = MaterialTheme.typography.bodySmall, color = TextLo)
        Spacer(Modifier.height(8.dp))
        Chip(if (on) "STOP OFFERING" else "OFFER AS LAUNCHER", on,
             Modifier.fillMaxWidth(), tint = Amber) {
            val next = !on
            runCatching {
                ctx.packageManager.setComponentEnabledSetting(
                    alias,
                    if (next)
                        android.content.pm.PackageManager.COMPONENT_ENABLED_STATE_ENABLED
                    else
                        android.content.pm.PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
                    android.content.pm.PackageManager.DONT_KILL_APP,
                )
                on = next
            }
        }
    }
}


/**
 * Turns that run without you.
 *
 * Two things this deliberately does not pretend. A scheduled turn runs under
 * the SAME approval policy as a typed one -- it stops at the gate and the
 * approval waits for you, rather than being waved through for being
 * unattended. And the clock is a thread inside this app, not cron: a phone
 * that kills OMERTA kills the schedule with it, and a missed run happens at
 * the next start, late and labelled late.
 */
@Composable
private fun ScheduleSection(project: String) {
    val scope = rememberCoroutineScope()
    var jobs by remember { mutableStateOf<List<JSONObject>>(emptyList()) }
    var text by remember { mutableStateOf("") }
    var hours by remember { mutableStateOf("24") }
    var note by remember { mutableStateOf("") }

    suspend fun refresh() { jobs = OmertaClient.schedules().list("jobs") }
    LaunchedEffect(Unit) { refresh() }

    Section("Scheduled turns", trailing = "${jobs.size}") {
        Text("Runs only while OMERTA is running, and stops at the approval "
             + "gate exactly like a message you typed.",
             style = MaterialTheme.typography.bodySmall, color = TextLo)
        Spacer(Modifier.height(8.dp))
        Field(text, { text = it }, "what should it ask?")
        Spacer(Modifier.height(6.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Field(hours, { hours = it }, "every N hours", Modifier.weight(1f))
            Chip("ADD", false, tint = Good) {
                val every = ((hours.trim().toDoubleOrNull() ?: 24.0) * 3600).toInt()
                if (text.isNotBlank()) scope.launch {
                    val r = OmertaClient.scheduleAdd(text.trim(), project, every, null)
                    note = r.err().ifEmpty { "scheduled" }
                    text = ""
                    refresh()
                }
            }
        }
        Spacer(Modifier.height(10.dp))
        if (jobs.isEmpty()) Empty("nothing scheduled")
        jobs.forEach { j ->
            val id = j.optString("id")
            ListRow(
                j.optString("text").take(120),
                detail = "every ${j.optInt("every") / 3600}h · " +
                         "${j.optInt("runs")} runs" +
                         (j.optString("last_status", "").takeIf { it.isNotEmpty() }
                             ?.let { " · $it" } ?: ""),
                right = if (j.optBoolean("enabled")) "on" else "off",
                rightColor = if (j.optBoolean("enabled")) Good else TextLo,
            )
            Spacer(Modifier.height(6.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Chip(if (j.optBoolean("enabled")) "PAUSE" else "RESUME", false,
                     Modifier.weight(1f)) {
                    scope.launch {
                        OmertaClient.scheduleSet(id, !j.optBoolean("enabled"))
                        refresh()
                    }
                }
                Chip("RUN NOW", false, Modifier.weight(1f), tint = Amber) {
                    scope.launch {
                        val r = OmertaClient.scheduleRunNow(id)
                        note = r.err().ifEmpty { "fired" }
                        refresh()
                    }
                }
                Chip("DELETE", false, Modifier.weight(1f), tint = Blood) {
                    scope.launch { OmertaClient.scheduleDelete(id); refresh() }
                }
            }
            Spacer(Modifier.height(10.dp))
        }
        Note(note, if (note == "scheduled" || note == "fired") Good else Ember)
    }
}

/**
 * Proving the log was not edited.
 *
 * This is tamper EVIDENCE and says so. The chain is computed on this device
 * with a key on this device, so whatever can rewrite the log can recompute
 * the chain; what it cannot do is change the head you already wrote down
 * somewhere else. Comparing that head later is the entire value here, and
 * calling it "signed" would promise something local storage cannot give.
 */
@Composable
private fun AuditSection() {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var head by remember { mutableStateOf("") }
    var detail by remember { mutableStateOf("") }
    var bad by remember { mutableStateOf(false) }

    Section("Audit chain") {
        Text("Each entry's digest includes the one before it, so a line "
             + "cannot be changed or removed without breaking every digest "
             + "after it. Write the head down somewhere this device cannot "
             + "reach.",
             style = MaterialTheme.typography.bodySmall, color = TextLo)
        Spacer(Modifier.height(8.dp))
        Chip("SEAL AND SHOW THE HEAD", false, Modifier.fillMaxWidth()) {
            scope.launch {
                val r = OmertaClient.auditExport(false)
                bad = r.optString("warning", "").isNotEmpty() ||
                      r.err().isNotEmpty()
                head = r.optString("head", "")
                detail = r.err().ifEmpty {
                    r.optString("warning", "").ifEmpty {
                        "${r.optInt("count")} entries" +
                        (if (r.has("continuous") && !r.optBoolean("continuous", true))
                            " — BROKEN" else "") +
                        (if (r.optBoolean("continuous", false))
                            " · continuous since the last seal" else "")
                    }
                }
            }
        }
        if (head.isNotEmpty()) {
            Spacer(Modifier.height(8.dp))
            Mono(head, max = 80)
            Spacer(Modifier.height(6.dp))
            Chip("COPY HEAD", false, Modifier.fillMaxWidth()) { copy(ctx, head) }
        }
        Note(detail, if (bad) Ember else Good)
    }
}

/**
 * The last crash, on the device that had it.
 *
 * A crash that only exists in logcat is a crash nobody can send me: reading it
 * needs a cable, a laptop and adb. The trace is written to a file as it
 * happens and shown here, with the device, the ABIs and the build, so the
 * report that arrives is the one I can actually work from.
 */
@Composable
private fun CrashSection() {
    val ctx = LocalContext.current
    var text by remember { mutableStateOf<String?>(null) }
    var gone by remember { mutableStateOf(false) }

    LaunchedEffect(gone) {
        val f = java.io.File(ctx.filesDir, "last_crash.txt")
        text = if (f.isFile) runCatching { f.readText() }.getOrNull() else null
    }

    Section("Last crash", trailing = if (text == null) "none" else "saved") {
        if (text == null) {
            Empty("nothing has crashed since this was installed")
        } else {
            Mono(text!!, max = 220)
            Spacer(Modifier.height(8.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Chip("COPY", false, Modifier.weight(1f)) { copy(ctx, text!!) }
                Chip("SHARE", false, Modifier.weight(1f)) {
                    val send = android.content.Intent(
                        android.content.Intent.ACTION_SEND)
                    send.type = "text/plain"
                    send.putExtra(android.content.Intent.EXTRA_TEXT, text)
                    runCatching {
                        ctx.startActivity(android.content.Intent.createChooser(
                            send, "Send the crash report"))
                    }
                }
                Chip("CLEAR", false, Modifier.weight(1f), tint = Blood) {
                    runCatching {
                        java.io.File(ctx.filesDir, "last_crash.txt").delete()
                    }
                    gone = !gone
                }
            }
        }
    }
}

/**
 * Destroying everything.
 *
 * Not behind the approval gate, on purpose: a panic action that stops to ask
 * is a panic action that does not work. The confirmation is the phrase, typed
 * in full, at the moment.
 */
@Composable
private fun PanicSection() {
    val scope = rememberCoroutineScope()
    var est by remember { mutableStateOf<JSONObject?>(null) }
    var typed by remember { mutableStateOf("") }
    var result by remember { mutableStateOf("") }
    var bad by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) { est = OmertaClient.wipeEstimate() }
    val phrase = est?.optString("phrase", "WIPE EVERYTHING") ?: "WIPE EVERYTHING"

    Section("Panic wipe",
            trailing = est?.let { bytesLabel(it.optLong("bytes", 0)) } ?: "") {
        Text("Chats, memory, the shelf, attachments, keys, the log. It cannot "
             + "be undone and nothing is backed up first — doing that "
             + "automatically would defeat the point.",
             style = MaterialTheme.typography.bodySmall, color = Ember)
        Spacer(Modifier.height(8.dp))
        est?.list("items")?.take(12)?.forEach { i ->
            ListRow(i.optString("name"),
                    right = bytesLabel(i.optLong("bytes", 0)), mono = true)
            Spacer(Modifier.height(5.dp))
        }
        Spacer(Modifier.height(6.dp))
        Field(typed, { typed = it }, phrase)
        Spacer(Modifier.height(8.dp))
        Chip("WIPE", false, Modifier.fillMaxWidth(), tint = Blood) {
            scope.launch {
                val r = OmertaClient.wipeNow(typed)
                bad = r.err().isNotEmpty() || r.optString("status") == "partial"
                result = r.err().ifEmpty {
                    "removed ${r.optJSONArray("removed")?.length() ?: 0} items" +
                    ((r.optJSONArray("failed")?.length() ?: 0).takeIf { it > 0 }
                        ?.let { " · $it could NOT be removed" } ?: "") +
                    " — restart OMERTA"
                }
                typed = ""
            }
        }
        Note(result, if (bad) Ember else Good)
    }
}
