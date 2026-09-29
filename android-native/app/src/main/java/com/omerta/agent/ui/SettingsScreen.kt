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

    suspend fun refresh() {
        status = OmertaClient.status()
        models = OmertaClient.models()
        engine = OmertaClient.localai()
        settings = OmertaClient.settings()
        themes = OmertaClient.themes()
    }

    LaunchedEffect(Unit) { refresh() }

    LazyColumn(
        Modifier.fillMaxSize().background(Ink),
        contentPadding = PaddingValues(14.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
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
            Section("API key") {
                Text("Stored on this device only, 0600. Never leaves it except " +
                     "to the provider you pick.",
                     style = MaterialTheme.typography.bodySmall, color = TextLo)
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
                        val r = OmertaClient.putSecret(keyName, keyValue)
                        saved = r.err().ifEmpty { "saved" }
                        keyValue = ""
                        refresh()
                        vm.refreshStatus()
                    }
                }
                Note(saved, if (saved == "saved") Good else Ember)
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
            HomeLauncherSection()
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
