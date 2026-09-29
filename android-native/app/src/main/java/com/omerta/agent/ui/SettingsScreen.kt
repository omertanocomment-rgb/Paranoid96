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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.omerta.agent.OmertaClient
import kotlinx.coroutines.launch
import org.json.JSONObject

@Composable
fun SettingsScreen(vm: ChatViewModel) {
    val st by vm.state.collectAsStateWithLifecycleCompat()
    val scope = rememberCoroutineScope()
    var status by remember { mutableStateOf<JSONObject?>(null) }
    var models by remember { mutableStateOf<JSONObject?>(null) }
    var keyName by remember { mutableStateOf("ANTHROPIC_API_KEY") }
    var keyValue by remember { mutableStateOf("") }
    var saved by remember { mutableStateOf("") }

    suspend fun refresh() {
        status = OmertaClient.status()
        models = OmertaClient.models()
    }

    LaunchedEffect(Unit) { refresh() }

    LazyColumn(
        Modifier.fillMaxSize().background(Ink),
        contentPadding = PaddingValues(14.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        item {
            Section("Model") {
                val providers = status?.optJSONObject("providers")
                if (providers == null) {
                    Text("checking…", style = MaterialTheme.typography.bodySmall,
                         color = TextLo)
                } else {
                    Chip("auto (best available)", st.provider == "auto") {
                        vm.setProvider("auto")
                    }
                    Spacer(Modifier.height(6.dp))
                    providers.keys().forEach { id ->
                        val p = providers.optJSONObject(id) ?: return@forEach
                        val ready = p.optBoolean("ready", false)
                        val why = p.optString("why", "")
                        ProviderRow(
                            id = id,
                            ready = ready,
                            why = why,
                            selected = st.provider == id,
                            onSelect = { vm.setProvider(id) },
                        )
                        Spacer(Modifier.height(6.dp))
                    }
                }
            }
        }

        item {
            Section("Network") {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf("auto", "offline", "online").forEach { m ->
                        Chip(m.uppercase(), st.mode == m, Modifier.weight(1f)) {
                            vm.setMode(m)
                        }
                    }
                }
            }
        }

        item {
            Section("Approvals") {
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
                        Chip(k.removeSuffix("_API_KEY"), keyName == k) { keyName = k }
                    }
                }
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = keyValue,
                    onValueChange = { keyValue = it },
                    placeholder = { Text("paste key", color = TextLo,
                                         style = MaterialTheme.typography.bodySmall) },
                    visualTransformation = PasswordVisualTransformation(),
                    textStyle = MaterialTheme.typography.bodySmall,
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(8.dp))
                Chip("SAVE KEY", false, Modifier.fillMaxWidth()) {
                    scope.launch {
                        val r = OmertaClient.putSecret(keyName, keyValue)
                        saved = if (r.has("error")) r.optString("error") else "saved"
                        keyValue = ""
                        refresh()
                        vm.refreshStatus()
                    }
                }
                if (saved.isNotEmpty()) {
                    Spacer(Modifier.height(6.dp))
                    Text(saved, style = MaterialTheme.typography.bodySmall,
                         color = if (saved == "saved") Good else Ember)
                }
            }
        }

        item {
            Section("On-device model") {
                Text("Runs on this phone. No key, no network, no other machine.",
                     style = MaterialTheme.typography.bodySmall, color = TextLo)
                Spacer(Modifier.height(8.dp))
                val rows = models?.optJSONArray("models")
                if (rows == null || rows.length() == 0) {
                    Text("catalogue unavailable",
                         style = MaterialTheme.typography.bodySmall, color = TextLo)
                } else {
                    for (i in 0 until rows.length()) {
                        val m = rows.optJSONObject(i) ?: continue
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
        }

        item {
            Section("Build") {
                val b = status?.optJSONObject("build")
                Text(b?.optString("describe") ?: "—",
                     style = MaterialTheme.typography.bodySmall, color = TextLo)
            }
        }
    }
}

@Composable
private fun Section(title: String, content: @Composable ColumnScopeAlias.() -> Unit) {
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(7.dp))
            .background(Panel)
            .border(1.dp, Border, RoundedCornerShape(7.dp))
            .padding(12.dp),
    ) {
        Text(title.uppercase(), style = MaterialTheme.typography.labelLarge, color = Ember)
        Spacer(Modifier.height(10.dp))
        content(ColumnScopeAlias)
    }
}

/** Lets a Section body call Column helpers without importing ColumnScope. */
object ColumnScopeAlias

@Composable
private fun Chip(
    label: String,
    on: Boolean,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    Box(
        modifier
            .clip(RoundedCornerShape(5.dp))
            .background(if (on) Blood.copy(alpha = 0.22f) else PanelHi)
            .border(1.dp, if (on) Blood else Border, RoundedCornerShape(5.dp))
            .clickableNoRipple(onClick)
            .padding(horizontal = 12.dp, vertical = 9.dp),
    ) {
        Text(label, style = MaterialTheme.typography.labelSmall,
             color = if (on) Ember else TextHi)
    }
}

@Composable
private fun ProviderRow(
    id: String,
    ready: Boolean,
    why: String,
    selected: Boolean,
    onSelect: () -> Unit,
) {
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(5.dp))
            .background(if (selected) Blood.copy(alpha = 0.18f) else PanelHi)
            .border(1.dp, if (selected) Blood else Border, RoundedCornerShape(5.dp))
            .clickableNoRipple(onSelect)
            .padding(10.dp),
    ) {
        Row(Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween) {
            Text(id, style = MaterialTheme.typography.bodySmall, color = TextHi)
            Text(if (ready) "●" else "○",
                 style = MaterialTheme.typography.bodySmall,
                 color = if (ready) Good else TextLo)
        }
        // The backend works out WHY a provider is unavailable; showing only
        // "unavailable" throws that away and leaves three different problems
        // looking identical.
        if (!ready && why.isNotEmpty()) {
            Spacer(Modifier.height(3.dp))
            Text(why, style = MaterialTheme.typography.labelSmall, color = TextLo)
        }
    }
}

@Composable
private fun ModelRow(m: JSONObject, onAction: (String) -> Unit) {
    val installed = m.optBoolean("installed", false)
    val fits = m.optBoolean("fits", true)
    val job = m.optJSONObject("job")
    val gb = m.optLong("bytes", 0L) / 1_073_741_824.0
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(5.dp))
            .background(PanelHi)
            .border(1.dp, Border, RoundedCornerShape(5.dp))
            .padding(10.dp),
    ) {
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
            fits -> Chip("GET", false) { onAction("download") }
        }
    }
}
