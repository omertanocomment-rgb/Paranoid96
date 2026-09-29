package com.omerta.agent.ui

import android.speech.RecognizerIntent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp

@Composable
fun ChatScreen(vm: ChatViewModel) {
    val st by vm.state.collectAsStateWithLifecycleCompat()
    val listState = rememberLazyListState()

    LaunchedEffect(st.messages.size, st.messages.lastOrNull()?.text?.length) {
        if (st.messages.isNotEmpty()) {
            listState.animateScrollToItem(st.messages.lastIndex)
        }
    }

    Column(Modifier.fillMaxSize().background(Ink)) {
        if (st.needsSetup) SetupBanner()
        WorkModeBar(st, vm)
        LazyColumn(
            state = listState,
            modifier = Modifier.weight(1f).fillMaxWidth(),
            contentPadding = PaddingValues(12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            items(st.messages, key = { it.id }) { m -> MessageBubble(m, vm) }
            st.pending?.let { p -> item { ApprovalCard(p, vm) } }
            if (st.queued.isNotEmpty()) {
                item { QueuedNote(st.queued) }
            }
        }
        InputBar(
            busy = st.busy,
            onSend = vm::send,
            onStop = vm::stop,
        )
    }
}

/**
 * Nothing can answer yet, and what to do about it.
 *
 * Only shown when EVERY provider reports itself unavailable, which is a
 * different situation from a broken backend and has a fix the owner can carry
 * out in a minute. A chat window that takes a message and then cannot reply to
 * it teaches somebody the app is broken when it is merely empty.
 */
@Composable
private fun SetupBanner() {
    Column(
        Modifier
            .fillMaxWidth()
            .background(Blood.copy(alpha = 0.16f))
            .padding(horizontal = 12.dp, vertical = 9.dp),
    ) {
        Text("NOTHING CAN ANSWER YET",
             style = MaterialTheme.typography.labelSmall, color = Ember)
        Spacer(Modifier.height(3.dp))
        Text("Open SETTINGS and either paste an API key, or get an on-device "
             + "model under WEIGHTS. Both work; the second needs no network "
             + "and no account.",
             style = MaterialTheme.typography.labelSmall, color = TextLo)
    }
}

/**
 * How the agent is working right now.
 *
 * These are not personalities. PLAN and RESEARCH genuinely withhold the tools
 * that change things, so a mode is a statement about what it is ALLOWED to
 * do, and the blurb underneath is the backend's own description of that --
 * not a label written here that could drift from what the mode actually does.
 */
@Composable
private fun WorkModeBar(st: ChatState, vm: ChatViewModel) {
    if (st.workModes.isEmpty()) return
    Column(Modifier.fillMaxWidth().background(Panel).padding(
        horizontal = 10.dp, vertical = 8.dp)) {
        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            st.workModes.forEach { m ->
                Chip(m.uppercase(), m == st.workMode) { vm.setWorkMode(m) }
            }
        }
        if (st.workBlurb.isNotEmpty()) {
            Spacer(Modifier.height(6.dp))
            Text(st.workBlurb, style = MaterialTheme.typography.labelSmall,
                 color = TextLo)
        }
    }
}

/** Messages typed while it was working. They are sent in order, not dropped. */
@Composable
private fun QueuedNote(queued: List<String>) {
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(7.dp))
            .background(PanelHi)
            .border(1.dp, Amber.copy(alpha = 0.5f), RoundedCornerShape(7.dp))
            .padding(10.dp),
    ) {
        Text("QUEUED (${queued.size})", style = MaterialTheme.typography.labelSmall,
             color = Amber)
        queued.forEach {
            Spacer(Modifier.height(4.dp))
            Text(it, style = MaterialTheme.typography.bodySmall, color = TextLo)
        }
    }
}

@Composable
private fun MessageBubble(m: Message, vm: ChatViewModel) {
    val mine = m.role == Role.YOU
    val system = m.role == Role.SYSTEM
    val ctx = LocalContext.current
    var copied by remember { mutableStateOf(false) }
    var open by remember { mutableStateOf(false) }
    var editing by remember { mutableStateOf(false) }
    var draft by remember { mutableStateOf(m.text) }
    Row(
        Modifier.fillMaxWidth(),
        horizontalArrangement = if (mine) Arrangement.End else Arrangement.Start,
    ) {
        Column(
            Modifier
                .fillMaxWidth(0.93f)
                .clip(RoundedCornerShape(7.dp))
                .background(
                    when {
                        system -> Blood.copy(alpha = 0.18f)
                        mine -> PanelHi
                        else -> Panel
                    }
                )
                .border(1.dp, if (system) Blood else Border, RoundedCornerShape(7.dp))
                .clickableNoRipple { open = !open }
                .padding(horizontal = 12.dp, vertical = 9.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    when (m.role) {
                        Role.YOU -> "you"; Role.AGENT -> "omerta"; Role.SYSTEM -> "system"
                    },
                    style = MaterialTheme.typography.labelSmall,
                    color = if (system) Ember else TextLo,
                )
                if (m.streaming) {
                    Spacer(Modifier.width(8.dp))
                    Text("writing…", style = MaterialTheme.typography.labelSmall,
                         color = TextLo.copy(alpha = 0.7f))
                }
                if (copied) {
                    Spacer(Modifier.width(8.dp))
                    Text("copied", style = MaterialTheme.typography.labelSmall,
                         color = Good)
                }
            }
            Spacer(Modifier.height(4.dp))
            Text(
                renderMarkdown(m.text),
                style = MaterialTheme.typography.bodyMedium,
                color = TextHi,
            )
            // What the turn cost, when the backend could work it out. The
            // tokens are estimated for providers that do not report them, so
            // the tilde stays: an estimate shown as a bill is a lie.
            m.cost?.let {
                Spacer(Modifier.height(5.dp))
                Text(it, style = MaterialTheme.typography.labelSmall,
                     color = TextLo.copy(alpha = 0.75f))
            }
            if (open) {
                Spacer(Modifier.height(9.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Chip("COPY", false, Modifier.weight(1f)) {
                        copy(ctx, m.text); copied = true; open = false
                    }
                    Chip("PIN", false, Modifier.weight(1f)) {
                        vm.pin(m.text); open = false
                    }
                    if (mine) {
                        Chip("EDIT", false, Modifier.weight(1f), tint = Amber) {
                            draft = m.text; editing = true; open = false
                        }
                    } else {
                        Chip("REDO", false, Modifier.weight(1f), tint = Amber) {
                            vm.regenerate(); open = false
                        }
                    }
                }
            }
        }
    }

    if (editing) {
        AlertDialog(
            onDismissRequest = { editing = false },
            containerColor = Panel,
            title = { Text("Say it differently", color = TextHi,
                           style = MaterialTheme.typography.titleMedium) },
            text = {
                Column {
                    Text("Everything after this message is dropped and the "
                         + "conversation runs again from here.",
                         style = MaterialTheme.typography.bodySmall, color = TextLo)
                    Spacer(Modifier.height(8.dp))
                    OutlinedTextField(draft, { draft = it },
                        textStyle = MaterialTheme.typography.bodySmall,
                        modifier = Modifier.fillMaxWidth())
                }
            },
            confirmButton = {
                TextButton({ editing = false; vm.resendFrom(m.id, draft) }) {
                    Text("SEND AGAIN", color = Good)
                }
            },
            dismissButton = {
                TextButton({ editing = false }) { Text("CANCEL", color = TextLo) }
            },
        )
    }
}

/**
 * Just enough markdown to read a reply: fenced code, inline code and bold.
 *
 * Deliberately not a full renderer. The model writes prose with the occasional
 * command in it, and a half-finished fence arriving mid-stream must not throw.
 */
private fun renderMarkdown(text: String) = buildAnnotatedString {
    val fence = Regex("```[a-zA-Z0-9_+-]*\\n?")
    var inCode = false
    var rest = text
    while (true) {
        val m = fence.find(rest) ?: break
        appendStyled(rest.substring(0, m.range.first), inCode)
        rest = rest.substring(m.range.last + 1)
        inCode = !inCode
    }
    appendStyled(rest, inCode)
}

private fun androidx.compose.ui.text.AnnotatedString.Builder.appendStyled(
    chunk: String, code: Boolean,
) {
    if (chunk.isEmpty()) return
    if (code) {
        withStyle(SpanStyle(fontFamily = FontFamily.Monospace, color = Ember)) {
            append(chunk)
        }
        return
    }
    // inline `code` and **bold**, one pass, leaving anything unmatched as text
    val tokens = Regex("`([^`\\n]+)`|\\*\\*([^*]+)\\*\\*")
    var i = 0
    for (m in tokens.findAll(chunk)) {
        append(chunk.substring(i, m.range.first))
        val inline = m.groupValues[1]
        if (inline.isNotEmpty()) {
            withStyle(SpanStyle(fontFamily = FontFamily.Monospace, color = Ember)) {
                append(inline)
            }
        } else {
            withStyle(SpanStyle(fontWeight = androidx.compose.ui.text.font.FontWeight.Bold)) {
                append(m.groupValues[2])
            }
        }
        i = m.range.last + 1
    }
    append(chunk.substring(i))
}

@Composable
private fun ApprovalCard(p: Pending, vm: ChatViewModel) {
    var editing by remember { mutableStateOf(false) }
    var denying by remember { mutableStateOf(false) }
    var draft by remember { mutableStateOf(p.action) }
    var note by remember { mutableStateOf("") }

    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(7.dp))
            .background(Panel)
            .border(1.dp, if (p.danger) Blood else Amber, RoundedCornerShape(7.dp))
            .padding(12.dp),
    ) {
        Text(
            if (p.danger) "⚠ DESTRUCTIVE — APPROVE?" else "APPROVAL NEEDED",
            style = MaterialTheme.typography.labelLarge,
            color = if (p.danger) Ember else Amber,
        )
        Spacer(Modifier.height(8.dp))
        Text(
            p.action,
            style = MaterialTheme.typography.bodySmall,
            color = TextHi,
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(4.dp))
                .background(Ink)
                .padding(8.dp),
        )
        p.tier?.let {
            Spacer(Modifier.height(6.dp))
            Text("tier: $it", style = MaterialTheme.typography.labelSmall, color = TextLo)
        }
        Spacer(Modifier.height(10.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            ActionButton("RUN", Good, Modifier.weight(1f)) { vm.approve() }
            ActionButton("EDIT", Amber, Modifier.weight(1f)) { draft = p.action; editing = true }
            ActionButton("REFUSE", Blood, Modifier.weight(1f)) { note = ""; denying = true }
        }
    }

    if (editing) {
        AlertDialog(
            onDismissRequest = { editing = false },
            containerColor = Panel,
            title = { Text("Rewrite the command", color = TextHi,
                           style = MaterialTheme.typography.titleMedium) },
            text = {
                OutlinedTextField(draft, { draft = it },
                    textStyle = MaterialTheme.typography.bodySmall,
                    modifier = Modifier.fillMaxWidth())
            },
            confirmButton = {
                TextButton({ editing = false; vm.edit(draft) }) {
                    Text("RUN IT", color = Good)
                }
            },
            dismissButton = {
                TextButton({ editing = false }) { Text("CANCEL", color = TextLo) }
            },
        )
    }

    if (denying) {
        AlertDialog(
            onDismissRequest = { denying = false },
            containerColor = Panel,
            title = { Text("Why not?", color = TextHi,
                           style = MaterialTheme.typography.titleMedium) },
            text = {
                Column {
                    Text("Optional. The agent records it so it does not propose " +
                         "the same thing again.",
                         style = MaterialTheme.typography.bodySmall, color = TextLo)
                    Spacer(Modifier.height(8.dp))
                    OutlinedTextField(note, { note = it },
                        textStyle = MaterialTheme.typography.bodySmall,
                        modifier = Modifier.fillMaxWidth())
                }
            },
            confirmButton = {
                TextButton({ denying = false; vm.deny(note) }) {
                    Text("REFUSE", color = Ember)
                }
            },
            dismissButton = {
                TextButton({ denying = false }) { Text("CANCEL", color = TextLo) }
            },
        )
    }
}

@Composable
private fun ActionButton(
    label: String,
    tint: androidx.compose.ui.graphics.Color,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    Box(
        modifier
            .clip(RoundedCornerShape(5.dp))
            .background(tint.copy(alpha = 0.14f))
            .border(1.dp, tint.copy(alpha = 0.55f), RoundedCornerShape(5.dp))
            .clickableNoRipple(onClick)
            .padding(vertical = 10.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(label, style = MaterialTheme.typography.labelLarge, color = tint)
    }
}

@Composable
private fun InputBar(busy: Boolean, onSend: (String) -> Unit, onStop: () -> Unit) {
    var text by remember { mutableStateOf("") }
    val ctx = LocalContext.current

    // Something shared from another app lands in the box, not in the model.
    // A share is the START of a sentence -- "summarise this", "what is wrong
    // with this" -- and sending it straight off throws away the part the
    // person was about to type.
    val shared by Intake.text.collectAsStateWithLifecycleCompat()
    LaunchedEffect(shared) {
        val s = Intake.takeText()
        if (!s.isNullOrBlank()) {
            text = if (text.isBlank()) s else text.trimEnd() + "\n\n" + s
        }
    }

    fun speechIntent(): android.content.Intent {
        val i = android.content.Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL,
                   RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
        i.putExtra(RecognizerIntent.EXTRA_PROMPT, "Speak")
        return i
    }

    val dictation = rememberLauncherForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result: androidx.activity.result.ActivityResult ->
        val heard = result.data?.getStringArrayListExtra(
            RecognizerIntent.EXTRA_RESULTS)?.firstOrNull()
        if (!heard.isNullOrBlank()) {
            text = if (text.isBlank()) heard else text.trimEnd() + " " + heard
        }
    }

    // The widget's SPEAK button. The recogniser opens here, in the app, in
    // the foreground -- never from the home screen.
    val askedToSpeak by Intake.dictate.collectAsStateWithLifecycleCompat()
    LaunchedEffect(askedToSpeak) {
        if (askedToSpeak > 0) runCatching { dictation.launch(speechIntent()) }
    }

    Row(
        Modifier
            .fillMaxWidth()
            .background(Panel)
            .navigationBarsPadding()
            .imePadding()
            .padding(10.dp),
        verticalAlignment = Alignment.Bottom,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Box(
            Modifier
                .weight(1f)
                .clip(RoundedCornerShape(6.dp))
                .background(Ink)
                .border(1.dp, Border, RoundedCornerShape(6.dp))
                .padding(horizontal = 10.dp, vertical = 11.dp),
        ) {
            if (text.isEmpty()) {
                Text(if (busy) "type ahead — it will be sent next"
                     else "what do you want built?",
                     style = MaterialTheme.typography.bodyMedium, color = TextLo)
            }
            BasicTextField(
                value = text,
                onValueChange = { text = it },
                textStyle = MaterialTheme.typography.bodyMedium.copy(color = TextHi),
                cursorBrush = SolidColor(Ember),
                modifier = Modifier.fillMaxWidth(),
            )
        }
        // Dictation goes through the system recogniser, which means the
        // microphone is opened by that app and not by this one: a permission
        // in the manifest is permission to ask, not a licence to listen.
        Box(
            Modifier
                .clip(RoundedCornerShape(6.dp))
                .background(PanelHi)
                .border(1.dp, Border, RoundedCornerShape(6.dp))
                .clickableNoRipple {
                    runCatching { dictation.launch(speechIntent()) }.onFailure {
                        android.widget.Toast.makeText(
                            ctx, "no speech recogniser on this device",
                            android.widget.Toast.LENGTH_SHORT).show()
                    }
                }
                .padding(horizontal = 12.dp, vertical = 13.dp),
        ) {
            Text("🎙", style = MaterialTheme.typography.labelLarge, color = TextHi)
        }
        Spacer(Modifier.width(6.dp))
        if (busy) {
            Box(
                Modifier
                    .clip(RoundedCornerShape(6.dp))
                    .background(PanelHi)
                    .border(1.dp, Ember, RoundedCornerShape(6.dp))
                    .clickableNoRipple(onStop)
                    .padding(horizontal = 14.dp, vertical = 13.dp),
            ) {
                Text("STOP", style = MaterialTheme.typography.labelLarge, color = Ember)
            }
            Spacer(Modifier.width(6.dp))
        }
        Box(
            Modifier
                .clip(RoundedCornerShape(6.dp))
                .background(Blood)
                .clickableNoRipple {
                    if (text.isNotBlank()) { onSend(text); text = "" }
                }
                .padding(horizontal = 16.dp, vertical = 13.dp),
        ) {
            Text(if (busy) "＋" else "▶",
                 style = MaterialTheme.typography.labelLarge,
                 color = androidx.compose.ui.graphics.Color.White)
        }
    }
}
