package ai.omerta.assistant.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
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

    var url by remember(s.backendUrl) { mutableStateOf(s.backendUrl) }
    var token by remember(s.appToken) { mutableStateOf(s.appToken) }
    var model by remember(s.model) { mutableStateOf(s.model) }
    var effort by remember(s.effort) { mutableStateOf(s.effort) }
    var system by remember(s.systemPrompt) { mutableStateOf(s.systemPrompt) }
    var streaming by remember(s.streaming) { mutableStateOf(s.streaming) }

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
                .verticalScroll(rememberScrollState()).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            SectionLabel("BACKEND")
            OutlinedTextField(
                value = url, onValueChange = { url = it },
                label = { Text("Backend URL") }, singleLine = true,
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
                        contentPadding = androidx.compose.foundation.layout.PaddingValues(4.dp),
                    ) { Text(e, style = MaterialTheme.typography.labelSmall) }
                }
            }

            SectionLabel("BEHAVIOR")
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text("Stream responses", style = MaterialTheme.typography.bodyMedium,
                    color = OmertaTextPrimary, modifier = Modifier.weight(1f))
                Switch(checked = streaming, onCheckedChange = { streaming = it },
                    colors = SwitchDefaults.colors(
                        checkedThumbColor = OmertaBlack, checkedTrackColor = OmertaAmber,
                        uncheckedThumbColor = OmertaTextSecondary, uncheckedTrackColor = OmertaSurface))
            }

            SectionLabel("SYSTEM PROMPT")
            OutlinedTextField(
                value = system, onValueChange = { system = it },
                modifier = Modifier.fillMaxWidth(), colors = fieldColors, minLines = 4,
                textStyle = MaterialTheme.typography.bodySmall,
            )

            Button(
                onClick = {
                    vm.saveSettings(url, token, model, system, effort, streaming)
                    onBack()
                },
                colors = ButtonDefaults.buttonColors(containerColor = OmertaAmber, contentColor = OmertaBlack),
                modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
            ) { Text("SAVE & RECONNECT", style = MaterialTheme.typography.labelLarge) }
        }
    }
}

@Composable
private fun SectionLabel(text: String) {
    Text(text, style = MaterialTheme.typography.labelMedium, color = OmertaAmber,
        modifier = Modifier.padding(top = 6.dp))
}
