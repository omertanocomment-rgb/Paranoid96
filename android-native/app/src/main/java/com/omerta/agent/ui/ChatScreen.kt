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
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
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
        LazyColumn(
            state = listState,
            modifier = Modifier.weight(1f).fillMaxWidth(),
            contentPadding = PaddingValues(12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            items(st.messages, key = { it.id }) { m -> MessageBubble(m) }
            st.pending?.let { p -> item { ApprovalCard(p, vm) } }
        }
        InputBar(
            busy = st.busy,
            onSend = vm::send,
        )
    }
}

@Composable
private fun MessageBubble(m: Message) {
    val mine = m.role == Role.YOU
    val system = m.role == Role.SYSTEM
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
            }
            Spacer(Modifier.height(4.dp))
            Text(
                renderMarkdown(m.text),
                style = MaterialTheme.typography.bodyMedium,
                color = TextHi,
            )
        }
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
private fun InputBar(busy: Boolean, onSend: (String) -> Unit) {
    var text by remember { mutableStateOf("") }
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
                Text("what do you want built?",
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
        Box(
            Modifier
                .clip(RoundedCornerShape(6.dp))
                .background(if (busy) Border else Blood)
                .clickableNoRipple {
                    if (!busy && text.isNotBlank()) { onSend(text); text = "" }
                }
                .padding(horizontal = 16.dp, vertical = 13.dp),
        ) {
            Text(if (busy) "…" else "▶",
                 style = MaterialTheme.typography.labelLarge,
                 color = if (busy) TextLo else androidx.compose.ui.graphics.Color.White)
        }
    }
}
