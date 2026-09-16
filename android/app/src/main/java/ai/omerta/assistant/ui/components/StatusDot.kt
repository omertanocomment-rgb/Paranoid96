package ai.omerta.assistant.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import ai.omerta.assistant.ui.theme.OmertaAmber
import ai.omerta.assistant.ui.theme.OmertaGreen
import ai.omerta.assistant.ui.theme.OmertaRed
import ai.omerta.assistant.ui.theme.OmertaTextSecondary
import ai.omerta.assistant.viewmodel.ConnectionState

@Composable
fun StatusDot(state: ConnectionState, modifier: Modifier = Modifier) {
    val (color, label) = when (state) {
        ConnectionState.ONLINE -> OmertaGreen to "ONLINE"
        ConnectionState.OFFLINE -> OmertaRed to "OFFLINE"
        ConnectionState.CHECKING -> OmertaAmber to "LINKING"
        ConnectionState.UNKNOWN -> OmertaTextSecondary to "IDLE"
    }
    Row(verticalAlignment = Alignment.CenterVertically, modifier = modifier) {
        androidx.compose.foundation.layout.Box(
            Modifier.size(8.dp).clip(CircleShape).background(color)
        )
        Text(
            text = label,
            style = MaterialTheme.typography.labelSmall,
            color = OmertaTextSecondary,
            modifier = Modifier.padding(start = 6.dp),
        )
    }
}
