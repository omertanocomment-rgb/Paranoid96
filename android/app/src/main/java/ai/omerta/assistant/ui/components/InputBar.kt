package ai.omerta.assistant.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import ai.omerta.assistant.ui.theme.OmertaAmber
import ai.omerta.assistant.ui.theme.OmertaBlack
import ai.omerta.assistant.ui.theme.OmertaBorder
import ai.omerta.assistant.ui.theme.OmertaSurface
import ai.omerta.assistant.ui.theme.OmertaTextPrimary
import ai.omerta.assistant.ui.theme.OmertaTextSecondary

@Composable
fun InputBar(
    value: String,
    onValueChange: (String) -> Unit,
    onSend: () -> Unit,
    onStop: () -> Unit,
    isSending: Boolean,
) {
    Surface(color = OmertaBlack, modifier = Modifier.navigationBarsPadding().imePadding()) {
        Row(
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 8.dp),
            verticalAlignment = Alignment.Bottom,
        ) {
            OutlinedTextField(
                value = value,
                onValueChange = onValueChange,
                modifier = Modifier.weight(1f),
                placeholder = { Text("message omerta…", color = OmertaTextSecondary,
                    style = MaterialTheme.typography.bodyMedium) },
                textStyle = MaterialTheme.typography.bodyMedium,
                maxLines = 6,
                colors = OutlinedTextFieldDefaults.colors(
                    focusedContainerColor = OmertaSurface,
                    unfocusedContainerColor = OmertaSurface,
                    focusedBorderColor = OmertaAmber,
                    unfocusedBorderColor = OmertaBorder,
                    cursorColor = OmertaAmber,
                    focusedTextColor = OmertaTextPrimary,
                    unfocusedTextColor = OmertaTextPrimary,
                ),
            )
            val enabled = isSending || value.isNotBlank()
            IconButton(
                onClick = { if (isSending) onStop() else onSend() },
                enabled = enabled,
                modifier = Modifier
                    .padding(start = 8.dp)
                    .size(48.dp)
                    .clip(CircleShape)
                    .background(if (enabled) OmertaAmber else OmertaBorder),
            ) {
                if (isSending) {
                    Icon(Icons.Filled.Stop, contentDescription = "Stop", tint = OmertaBlack)
                } else {
                    Icon(Icons.AutoMirrored.Filled.Send, contentDescription = "Send",
                        tint = if (enabled) OmertaBlack else OmertaTextSecondary)
                }
            }
        }
    }
}
