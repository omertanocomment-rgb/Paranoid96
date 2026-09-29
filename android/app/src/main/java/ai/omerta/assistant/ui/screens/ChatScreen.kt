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
import androidx.compose.runtime.remember
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
fun ChatScreen(vm: ChatViewModel, onSettings: () -> Unit, onBrain: () -> Unit) {
    val state by vm.ui.collectAsStateWithLifecycle()
    val listState = rememberLazyListState()
    val ctx = androidx.compose.ui.platform.LocalContext.current

    LaunchedEffect(state.messages.size, state.messages.lastOrNull()?.content) {
        if (state.messages.isNotEmpty()) {
            listState.animateScrollToItem(state.messages.size - 1)
        }
    }

    val settings by vm.settings.collectAsStateWithLifecycle()
    val needsKey = settings?.let {
        it.embedded && when (it.provider) {
            ai.omerta.assistant.data.local.Provider.ANTHROPIC -> it.anthropicApiKey.isBlank()
            ai.omerta.assistant.data.local.Provider.OPENAI -> it.openAiKey.isBlank()
            else -> false // Ollama needs no key
        }
    } ?: false
    val approval by vm.approval.collectAsStateWithLifecycle()

    // First-run onboarding — shown once.
    if (settings?.onboarded == false) {
        AlertDialog(
            onDismissRequest = { vm.markOnboarded() },
            containerColor = OmertaSurface,
            title = { Text("Welcome to Omerta AI", color = OmertaAmber, style = MaterialTheme.typography.titleMedium) },
            text = {
                Text(
                    "Your offline operator brain. Silence is golden.\n\n" +
                        "• Tap “go fully OFFLINE” to use the on-device brain — no key, no network.\n" +
                        "• Teach it by talking: “remember that …”, “when I say X, say Y”, “wrong, it's …”.\n" +
                        "• Ask “what do you know”, or open 🧠 Brain to give it a personality, load files,\n" +
                        "  back up / restore, and see the agent action log.\n" +
                        "• Prefer Claude/OpenAI? Add a key in Settings — it's encrypted on-device.",
                    color = OmertaTextPrimary, style = MaterialTheme.typography.bodyMedium,
                )
            },
            confirmButton = { TextButton(onClick = { vm.useBrain(); vm.markOnboarded() }) {
                Text("GO OFFLINE", color = OmertaAmber) } },
            dismissButton = { TextButton(onClick = { vm.markOnboarded() }) {
                Text("GOT IT", color = OmertaTextSecondary) } },
        )
    }

    approval?.let { pending ->
        val high = pending.risk == ai.omerta.assistant.data.agent.RiskLevel.HIGH
        val riskColor = when (pending.risk) {
            ai.omerta.assistant.data.agent.RiskLevel.HIGH -> ai.omerta.assistant.ui.theme.OmertaRed
            ai.omerta.assistant.data.agent.RiskLevel.MEDIUM -> OmertaAmber
            else -> ai.omerta.assistant.ui.theme.OmertaGreen
        }
        AlertDialog(
            onDismissRequest = { vm.resolveApproval(false) },
            containerColor = OmertaSurface,
            title = {
                Text("Allow this action?  [${pending.risk}]", color = riskColor,
                    style = MaterialTheme.typography.titleMedium)
            },
            text = {
                androidx.compose.foundation.layout.Column {
                    Text("${pending.name}  ${pending.input}", color = OmertaTextPrimary,
                        style = MaterialTheme.typography.bodyMedium)
                    Text(pending.reason, color = if (high) riskColor else OmertaTextSecondary,
                        style = MaterialTheme.typography.bodySmall,
                        modifier = Modifier.padding(top = 10.dp))
                }
            },
            confirmButton = { TextButton(onClick = { vm.resolveApproval(true) }) {
                Text(if (high) "ALLOW ANYWAY" else "ALLOW", color = riskColor) } },
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
                onBrain = onBrain,
                onShare = {
                    val text = vm.transcriptMarkdown()
                    if (state.messages.isNotEmpty()) {
                        val send = android.content.Intent(android.content.Intent.ACTION_SEND).apply {
                            type = "text/plain"
                            putExtra(android.content.Intent.EXTRA_TEXT, text)
                            putExtra(android.content.Intent.EXTRA_SUBJECT, "Omerta conversation")
                        }
                        ctx.startActivity(android.content.Intent.createChooser(send, "Share conversation")
                            .addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK))
                    }
                },
                onClear = vm::clearChat,
            )
        },
        bottomBar = {
            val uploadLauncher = androidx.activity.compose.rememberLauncherForActivityResult(
                androidx.activity.result.contract.ActivityResultContracts.OpenMultipleDocuments()
            ) { uris -> if (uris.isNotEmpty()) vm.importIncoming(uris) }
            InputBar(
                value = state.input,
                onValueChange = vm::updateInput,
                onSend = vm::send,
                onStop = vm::stop,
                isSending = state.isSending,
                onAttach = { uploadLauncher.launch(arrayOf("*/*")) },
            )
        },
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) {
            if (state.messages.isEmpty()) {
                val brainMode = settings?.let { it.embedded && it.provider == ai.omerta.assistant.data.local.Provider.BRAIN } ?: false
                val brainFile by vm.brain.brain.collectAsStateWithLifecycle()
                if (brainMode) {
                    BrainEmptyState(
                        name = brainFile.persona.name,
                        tagline = brainFile.persona.tagline,
                        greeting = remember(brainFile.id, brainFile.persona) { vm.brain.greeting() },
                        facts = brainFile.knowledge.size,
                        onBrain = onBrain,
                        onPick = { vm.updateInput(it); vm.send() },
                    )
                } else {
                    EmptyState(needsKey = needsKey, onSettings = onSettings,
                        onOffline = vm::useBrain,
                        onPick = { vm.updateInput(it); vm.send() })
                }
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
private fun EmptyState(needsKey: Boolean, onSettings: () -> Unit, onOffline: () -> Unit, onPick: (String) -> Unit) {
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
            Text(
                "› …or go fully OFFLINE with your own brain 🧠",
                style = MaterialTheme.typography.bodyMedium,
                color = OmertaAmber,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(bottom = 12.dp)
                    .clip(RoundedCornerShape(8.dp))
                    .background(OmertaSurface)
                    .border(1.dp, OmertaAmber, RoundedCornerShape(8.dp))
                    .clickable { onOffline() }
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

private val brainSuggestions = listOf(
    "who are you?",
    "remember that my favorite color is amber",
    "when I say good morning, say rise and grind",
    "what do you know?",
    "help",
)

@Composable
private fun BrainEmptyState(
    name: String, tagline: String, greeting: String, facts: Int,
    onBrain: () -> Unit, onPick: (String) -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text("🧠 ${name.uppercase()}", style = MaterialTheme.typography.displaySmall, color = OmertaAmber,
            textAlign = TextAlign.Center)
        Text(
            "$tagline · offline · $facts thing${if (facts == 1) "" else "s"} learned",
            style = MaterialTheme.typography.bodySmall,
            color = OmertaTextSecondary,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(top = 6.dp, bottom = 12.dp),
        )
        Text(greeting, style = MaterialTheme.typography.bodyMedium, color = OmertaTextPrimary,
            textAlign = TextAlign.Center, modifier = Modifier.padding(bottom = 20.dp))
        brainSuggestions.forEach { s ->
            Text(
                text = "› $s",
                style = MaterialTheme.typography.bodyMedium,
                color = OmertaTextPrimary,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(vertical = 4.dp)
                    .clip(RoundedCornerShape(8.dp))
                    .background(OmertaSurface)
                    .border(1.dp, OmertaBorder, RoundedCornerShape(8.dp))
                    .clickable { onPick(s) }
                    .padding(12.dp),
            )
        }
        Text(
            "› open Brain — personality · knowledge · import/export",
            style = MaterialTheme.typography.bodyMedium,
            color = OmertaAmber,
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = 10.dp)
                .clip(RoundedCornerShape(8.dp))
                .background(OmertaSurface)
                .border(1.dp, OmertaAmber, RoundedCornerShape(8.dp))
                .clickable { onBrain() }
                .padding(12.dp),
        )
    }
}
