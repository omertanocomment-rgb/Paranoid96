package com.omerta.agent.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import com.omerta.agent.OmertaClient
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * A real shell, rendered as a widget rather than a web page.
 *
 * Output is read by offset, the same exactly-once poll the backend has always
 * used for the terminal -- a slow or dropped read loses nothing and repeats
 * nothing.
 */
@Composable
fun TerminalScreen() {
    var sessionId by remember { mutableStateOf<String?>(null) }
    var output by remember { mutableStateOf("") }
    var offset by remember { mutableStateOf(0) }
    var line by remember { mutableStateOf("") }
    var note by remember { mutableStateOf("opening a shell…") }
    var mode by remember { mutableStateOf("") }
    val scroll = rememberScrollState()
    val scope = rememberCoroutineScope()

    LaunchedEffect(Unit) {
        val r = OmertaClient.termOpen()
        val err = r.optString("error", "")
        if (err.isNotEmpty() || r.optString("id", "").isEmpty()) {
            note = if (err.isNotEmpty()) err else "could not open a shell"
            return@LaunchedEffect
        }
        sessionId = r.optString("id")
        mode = r.optString("mode", "")
        note = ""
    }

    LaunchedEffect(sessionId) {
        val id = sessionId ?: return@LaunchedEffect
        while (true) {
            val r = OmertaClient.termRead(id, offset)
            val chunk = r.optString("data", "")
            if (chunk.isNotEmpty()) {
                output += chunk
                // A terminal that keeps everything forever eventually stalls
                // the layout; the backend keeps the real scrollback.
                if (output.length > 120_000) output = output.takeLast(90_000)
            }
            offset = r.optInt("offset", offset)
            if (!r.optBoolean("alive", true)) {
                note = "the shell exited"
                break
            }
            delay(250)
        }
    }

    LaunchedEffect(output.length) { scroll.animateScrollTo(scroll.maxValue) }

    Column(Modifier.fillMaxSize().background(Ink)) {
        if (note.isNotEmpty()) {
            Text(note, style = MaterialTheme.typography.bodySmall, color = Amber,
                 modifier = Modifier.padding(12.dp))
        }
        if (mode.isNotEmpty()) {
            Text("mode: $mode", style = MaterialTheme.typography.labelSmall,
                 color = TextLo, modifier = Modifier.padding(horizontal = 12.dp))
        }
        Box(
            Modifier
                .weight(1f)
                .fillMaxWidth()
                .padding(10.dp)
                .clip(RoundedCornerShape(6.dp))
                .background(androidx.compose.ui.graphics.Color.Black)
                .border(1.dp, Border, RoundedCornerShape(6.dp))
                .verticalScroll(scroll)
                .padding(10.dp),
        ) {
            Text(
                output.ifEmpty { " " },
                style = MaterialTheme.typography.bodySmall.copy(
                    fontFamily = FontFamily.Monospace),
                color = TextHi,
            )
        }
        Row(
            Modifier
                .fillMaxWidth()
                .background(Panel)
                .navigationBarsPadding()
                .imePadding()
                .padding(10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Box(
                Modifier
                    .weight(1f)
                    .clip(RoundedCornerShape(6.dp))
                    .background(Ink)
                    .border(1.dp, Border, RoundedCornerShape(6.dp))
                    .padding(horizontal = 10.dp, vertical = 10.dp),
            ) {
                if (line.isEmpty()) {
                    Text("$ ", style = MaterialTheme.typography.bodySmall, color = TextLo)
                }
                BasicTextField(
                    value = line,
                    onValueChange = { line = it },
                    singleLine = true,
                    textStyle = MaterialTheme.typography.bodySmall.copy(
                        color = TextHi, fontFamily = FontFamily.Monospace),
                    cursorBrush = SolidColor(Ember),
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                    keyboardActions = KeyboardActions(onSend = {
                        val id = sessionId
                        if (id != null) {
                            scope.launch { OmertaClient.termWrite(id, line + "\n") }
                            line = ""
                        }
                    }),
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            TermKey("^C") {
                sessionId?.let { id -> scope.launch { OmertaClient.termSignal(id, "INT") } }
            }
            TermKey("↵") {
                val id = sessionId
                if (id != null) {
                    scope.launch { OmertaClient.termWrite(id, line + "\n") }
                    line = ""
                }
            }
        }
    }
}

@Composable
private fun TermKey(label: String, onClick: () -> Unit) {
    Box(
        Modifier
            .clip(RoundedCornerShape(5.dp))
            .background(PanelHi)
            .border(1.dp, Border, RoundedCornerShape(5.dp))
            .clickableNoRipple(onClick)
            .padding(horizontal = 12.dp, vertical = 11.dp),
    ) {
        Text(label, style = MaterialTheme.typography.labelLarge, color = TextHi)
    }
}
