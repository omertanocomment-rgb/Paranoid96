package ai.omerta.assistant.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ai.omerta.assistant.ui.components.InputBar
import ai.omerta.assistant.ui.components.MessageBubble
import ai.omerta.assistant.ui.components.OmertaTopBar
import ai.omerta.assistant.ui.theme.OmertaAmber
import ai.omerta.assistant.ui.theme.OmertaBlack
import ai.omerta.assistant.ui.theme.OmertaBorder
import ai.omerta.assistant.ui.theme.OmertaSurface
import ai.omerta.assistant.ui.theme.OmertaTextPrimary
import ai.omerta.assistant.ui.theme.OmertaTextSecondary
import ai.omerta.assistant.viewmodel.ChatViewModel

private val suggestions = listOf(
    "Draft a Termux setup script for a fresh Android dev box",
    "Explain adb reverse for wiring an app to a localhost backend",
    "Write a GitHub Actions job that runs gradle assembleRelease",
    "Checklist for auditing an APK before release",
)

@Composable
fun ChatScreen(vm: ChatViewModel, onSettings: () -> Unit) {
    val state by vm.ui.collectAsStateWithLifecycle()
    val listState = rememberLazyListState()

    LaunchedEffect(state.messages.size, state.messages.lastOrNull()?.content) {
        if (state.messages.isNotEmpty()) {
            listState.animateScrollToItem(state.messages.size - 1)
        }
    }

    val settings by vm.settings.collectAsStateWithLifecycle()
    val needsKey = settings?.let { it.embedded && it.anthropicApiKey.isBlank() } ?: false
    val approval by vm.approval.collectAsStateWithLifecycle()

    approval?.let { pending ->
        AlertDialog(
            onDismissRequest = { vm.resolveApproval(false) },
            containerColor = OmertaSurface,
            title = { Text("Allow tool?", color = OmertaAmber, style = MaterialTheme.typography.titleMedium) },
            text = {
                Text("Agent wants to run:\n\n${pending.name}\n${pending.input}",
                    color = OmertaTextPrimary, style = MaterialTheme.typography.bodyMedium)
            },
            confirmButton = { TextButton(onClick = { vm.resolveApproval(true) }) {
                Text("ALLOW", color = OmertaAmber) } },
            dismissButton = { TextButton(onClick = { vm.resolveApproval(false) }) {
                Text("DENY", color = OmertaTextSecondary) } },
        )
    }

    Scaffold(
        containerColor = OmertaBlack,
        // Top bar keeps its own status-bar inset; the input bar handles nav-bar + IME.
        contentWindowInsets = WindowInsets(0, 0, 0, 0),
        topBar = {
            OmertaTopBar(
                connection = state.connection,
                serverModel = state.serverModel,
                onSettings = onSettings,
                onClear = vm::clearChat,
            )
        },
        bottomBar = {
            InputBar(
                value = state.input,
                onValueChange = vm::updateInput,
                onSend = vm::send,
                onStop = vm::stop,
                isSending = state.isSending,
            )
        },
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) {
            if (state.messages.isEmpty()) {
                EmptyState(needsKey = needsKey, onSettings = onSettings,
                    onPick = { vm.updateInput(it); vm.send() })
            } else {
                LazyColumn(
                    state = listState,
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(vertical = 8.dp),
                ) {
                    items(state.messages, key = { it.id }) { MessageBubble(it) }
                }
            }
            state.lastUsage?.let {
                Text(
                    text = it,
                    style = MaterialTheme.typography.labelSmall,
                    color = OmertaTextSecondary,
                    modifier = Modifier.align(Alignment.BottomEnd).padding(12.dp),
                )
            }
        }
    }
}

@Composable
private fun EmptyState(needsKey: Boolean, onSettings: () -> Unit, onPick: (String) -> Unit) {
    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text("OMERTA AI", style = MaterialTheme.typography.displaySmall, color = OmertaAmber)
        Text(
            "operator-grade assistant · Claude built in",
            style = MaterialTheme.typography.bodySmall,
            color = OmertaTextSecondary,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(top = 6.dp, bottom = 28.dp),
        )
        if (needsKey) {
            Text(
                "› Add your Anthropic API key to start",
                style = MaterialTheme.typography.bodyMedium,
                color = OmertaAmber,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(bottom = 12.dp)
                    .clip(RoundedCornerShape(8.dp))
                    .background(OmertaSurface)
                    .border(1.dp, OmertaAmber, RoundedCornerShape(8.dp))
                    .clickable { onSettings() }
                    .padding(14.dp),
            )
        }
        suggestions.forEach { s ->
            Text(
                text = "› $s",
                style = MaterialTheme.typography.bodyMedium,
                color = OmertaTextPrimary,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(vertical = 5.dp)
                    .clip(RoundedCornerShape(8.dp))
                    .background(OmertaSurface)
                    .border(1.dp, OmertaBorder, RoundedCornerShape(8.dp))
                    .clickable { onPick(s) }
                    .padding(14.dp),
            )
        }
    }
}
