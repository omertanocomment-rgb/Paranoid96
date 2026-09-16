package ai.omerta.assistant.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.RadioButton
import androidx.compose.material3.RadioButtonDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.Settings as AndroidSettings
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ai.omerta.assistant.data.local.EngineMode
import ai.omerta.assistant.ui.theme.OmertaAmber
import ai.omerta.assistant.ui.theme.OmertaBlack
import ai.omerta.assistant.ui.theme.OmertaBorder
import ai.omerta.assistant.ui.theme.OmertaSurface
import ai.omerta.assistant.ui.theme.OmertaTextPrimary
import ai.omerta.assistant.ui.theme.OmertaTextSecondary
import ai.omerta.assistant.viewmodel.ChatViewModel

private val MODELS = listOf(
    "claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5", "claude-opus-4-8", "claude-fable-5-1",
)
private val EFFORTS = listOf("low", "medium", "high", "xhigh", "max")

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(vm: ChatViewModel, onBack: () -> Unit) {
    val settings by vm.settings.collectAsStateWithLifecycle()
    val s = settings ?: return

    var engineMode by remember(s.engineMode) { mutableStateOf(s.engineMode) }
    var apiKey by remember(s.anthropicApiKey) { mutableStateOf(s.anthropicApiKey) }
    var url by remember(s.backendUrl) { mutableStateOf(s.backendUrl) }
    var token by remember(s.appToken) { mutableStateOf(s.appToken) }
    var model by remember(s.model) { mutableStateOf(s.model) }
    var effort by remember(s.effort) { mutableStateOf(s.effort) }
    var system by remember(s.systemPrompt) { mutableStateOf(s.systemPrompt) }
    var streaming by remember(s.streaming) { mutableStateOf(s.streaming) }
    var maxTokens by remember(s.maxTokens) { mutableStateOf(s.maxTokens.toString()) }
    var webSearch by remember(s.webSearch) { mutableStateOf(s.webSearch) }
    var codeExec by remember(s.codeExecution) { mutableStateOf(s.codeExecution) }
    var mcpName by remember(s.mcpName) { mutableStateOf(s.mcpName) }
    var mcpUrl by remember(s.mcpUrl) { mutableStateOf(s.mcpUrl) }
    var agentMode by remember(s.agentMode) { mutableStateOf(s.agentMode) }
    var autoApprove by remember(s.autoApprove) { mutableStateOf(s.autoApprove) }

    val embedded = engineMode == EngineMode.EMBEDDED
    val context = LocalContext.current

    val fieldColors = OutlinedTextFieldDefaults.colors(
        focusedContainerColor = OmertaSurface,
        unfocusedContainerColor = OmertaSurface,
        focusedBorderColor = OmertaAmber,
        unfocusedBorderColor = OmertaBorder,
        cursorColor = OmertaAmber,
        focusedTextColor = OmertaTextPrimary,
        unfocusedTextColor = OmertaTextPrimary,
        focusedLabelColor = OmertaAmber,
        unfocusedLabelColor = OmertaTextSecondary,
    )

    Scaffold(
        containerColor = OmertaBlack,
        topBar = {
            TopAppBar(
                title = { Text("SETTINGS", style = MaterialTheme.typography.titleMedium, color = OmertaAmber) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back", tint = OmertaTextPrimary)
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = OmertaBlack),
            )
        },
    ) { padding ->
        Column(
            modifier = Modifier.fillMaxSize().padding(padding)
                .verticalScroll(rememberScrollState())
                .navigationBarsPadding().imePadding()
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            SectionLabel("ENGINE")
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                ModeButton("EMBEDDED", "in-app · no server", embedded, Modifier.weight(1f)) {
                    engineMode = EngineMode.EMBEDDED
                }
                ModeButton("REMOTE", "via engine", !embedded, Modifier.weight(1f)) {
                    engineMode = EngineMode.REMOTE
                }
            }

            if (embedded) {
                OutlinedTextField(
                    value = apiKey, onValueChange = { apiKey = it },
                    label = { Text("Anthropic API key") }, singleLine = true,
                    visualTransformation = PasswordVisualTransformation(),
                    modifier = Modifier.fillMaxWidth(), colors = fieldColors,
                    textStyle = MaterialTheme.typography.bodySmall,
                )
                Hint("Calls Claude directly. Key stored on device (extractable from the APK).")
            } else {
                OutlinedTextField(
                    value = url, onValueChange = { url = it },
                    label = { Text("Backend / engine URL") }, singleLine = true,
                    modifier = Modifier.fillMaxWidth(), colors = fieldColors,
                    textStyle = MaterialTheme.typography.bodyMedium,
                )
                OutlinedTextField(
                    value = token, onValueChange = { token = it },
                    label = { Text("App token (x-omerta-key)") }, singleLine = true,
                    visualTransformation = PasswordVisualTransformation(),
                    modifier = Modifier.fillMaxWidth(), colors = fieldColors,
                    textStyle = MaterialTheme.typography.bodyMedium,
                )
            }

            SectionLabel("MODEL")
            MODELS.forEach { m ->
                Row(
                    Modifier.fillMaxWidth().selectable(selected = model == m, onClick = { model = m })
                        .padding(vertical = 2.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    RadioButton(selected = model == m, onClick = { model = m },
                        colors = RadioButtonDefaults.colors(selectedColor = OmertaAmber, unselectedColor = OmertaTextSecondary))
                    Text(m, style = MaterialTheme.typography.bodyMedium, color = OmertaTextPrimary)
                }
            }

            SectionLabel("EFFORT")
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                EFFORTS.forEach { e ->
                    OutlinedButton(
                        onClick = { effort = e },
                        colors = ButtonDefaults.outlinedButtonColors(
                            containerColor = if (effort == e) OmertaAmber else OmertaSurface,
                            contentColor = if (effort == e) OmertaBlack else OmertaTextSecondary,
                        ),
                        modifier = Modifier.weight(1f),
                        contentPadding = androidx.compose.foundation.layout.PaddingValues(2.dp),
                    ) { Text(e, style = MaterialTheme.typography.labelSmall) }
                }
            }

            SectionLabel("SKILLS & TOOLS")
            ToggleRow("Web search", "let Claude search the web", webSearch,
                enabled = embedded) { webSearch = it }
            ToggleRow("Code execution", "run code in Anthropic's sandbox", codeExec,
                enabled = embedded) { codeExec = it }
            if (!embedded) Hint("Skills/tools apply in EMBEDDED mode (direct API).")

            SectionLabel("CONNECTORS (MCP)")
            OutlinedTextField(
                value = mcpName, onValueChange = { mcpName = it },
                label = { Text("Connector name") }, singleLine = true,
                modifier = Modifier.fillMaxWidth(), colors = fieldColors,
                textStyle = MaterialTheme.typography.bodySmall,
            )
            OutlinedTextField(
                value = mcpUrl, onValueChange = { mcpUrl = it },
                label = { Text("MCP server URL (https://…)") }, singleLine = true,
                modifier = Modifier.fillMaxWidth(), colors = fieldColors,
                textStyle = MaterialTheme.typography.bodySmall,
            )
            Hint("Remote MCP connector. Leave blank to disable. EMBEDDED mode.")

            SectionLabel("GENERATION")
            OutlinedTextField(
                value = maxTokens, onValueChange = { maxTokens = it.filter { c -> c.isDigit() } },
                label = { Text("Max output tokens") }, singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                modifier = Modifier.fillMaxWidth(), colors = fieldColors,
                textStyle = MaterialTheme.typography.bodyMedium,
            )
            ToggleRow("Stream responses", "show text as it generates", streaming, true) { streaming = it }

            SectionLabel("AGENT (AUTONOMOUS)")
            ToggleRow("Agent mode", "let Claude run device tools in a loop", agentMode,
                enabled = embedded) { agentMode = it }
            ToggleRow("Auto-approve tools", "skip the per-action prompt (risky)", autoApprove,
                enabled = embedded && agentMode) { autoApprove = it }
            OutlinedButton(
                onClick = {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                        runCatching {
                            context.startActivity(
                                Intent(AndroidSettings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION,
                                    Uri.parse("package:" + context.packageName))
                                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                        }.onFailure {
                            context.startActivity(
                                Intent(AndroidSettings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION)
                                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                        }
                    }
                },
                colors = ButtonDefaults.outlinedButtonColors(
                    containerColor = OmertaSurface, contentColor = OmertaAmber),
                modifier = Modifier.fillMaxWidth(),
            ) {
                val granted = Build.VERSION.SDK_INT >= Build.VERSION_CODES.R &&
                    Environment.isExternalStorageManager()
                Text(if (granted) "All-files access: GRANTED" else "Grant all-files access →",
                    style = MaterialTheme.typography.labelMedium)
            }
            Hint("Agent tools (list/read/write files, fetch URL) are permission-gated per action " +
                "unless auto-approve is on. Owned-device / authorized use only.")

            SectionLabel("HISTORY")
            Hint("Unlimited — the full conversation is sent each turn (bounded only by the " +
                "model's context window). Uses your API key, so there is no app-imposed message limit.")

            SectionLabel("SYSTEM PROMPT")
            OutlinedTextField(
                value = system, onValueChange = { system = it },
                modifier = Modifier.fillMaxWidth(), colors = fieldColors, minLines = 4,
                textStyle = MaterialTheme.typography.bodySmall,
            )

            Button(
                onClick = {
                    vm.saveSettings(
                        engineMode = engineMode, anthropicApiKey = apiKey,
                        backendUrl = url, appToken = token, model = model,
                        systemPrompt = system, effort = effort, streaming = streaming,
                        maxTokens = maxTokens.toIntOrNull()?.coerceIn(256, 64000) ?: 8192,
                        webSearch = webSearch, codeExecution = codeExec,
                        mcpName = mcpName, mcpUrl = mcpUrl,
                        agentMode = agentMode, autoApprove = autoApprove,
                    )
                    onBack()
                },
                colors = ButtonDefaults.buttonColors(containerColor = OmertaAmber, contentColor = OmertaBlack),
                modifier = Modifier.fillMaxWidth().padding(top = 8.dp, bottom = 24.dp),
            ) { Text("SAVE & RECONNECT", style = MaterialTheme.typography.labelLarge) }
        }
    }
}

@Composable
private fun ToggleRow(title: String, subtitle: String, checked: Boolean,
                      enabled: Boolean, onChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.bodyMedium,
                color = if (enabled) OmertaTextPrimary else OmertaTextSecondary)
            Text(subtitle, style = MaterialTheme.typography.labelSmall, color = OmertaTextSecondary)
        }
        Switch(checked = checked, onCheckedChange = onChange, enabled = enabled,
            colors = SwitchDefaults.colors(
                checkedThumbColor = OmertaBlack, checkedTrackColor = OmertaAmber,
                uncheckedThumbColor = OmertaTextSecondary, uncheckedTrackColor = OmertaSurface))
    }
}

@Composable
private fun ModeButton(
    title: String, subtitle: String, selected: Boolean,
    modifier: Modifier = Modifier, onClick: () -> Unit,
) {
    OutlinedButton(
        onClick = onClick,
        colors = ButtonDefaults.outlinedButtonColors(
            containerColor = if (selected) OmertaAmber else OmertaSurface,
            contentColor = if (selected) OmertaBlack else OmertaTextSecondary,
        ),
        modifier = modifier,
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(title, style = MaterialTheme.typography.labelLarge)
            Text(subtitle, style = MaterialTheme.typography.labelSmall)
        }
    }
}

@Composable
private fun Hint(text: String) {
    Text(text, style = MaterialTheme.typography.labelSmall, color = OmertaTextSecondary)
}

@Composable
private fun SectionLabel(text: String) {
    Text(text, style = MaterialTheme.typography.labelMedium, color = OmertaAmber,
        modifier = Modifier.padding(top = 6.dp))
}
