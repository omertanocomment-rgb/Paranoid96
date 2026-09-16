package ai.omerta.assistant.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import ai.omerta.assistant.data.model.ChatItem
import ai.omerta.assistant.data.model.Role
import ai.omerta.assistant.ui.theme.OmertaAmber
import ai.omerta.assistant.ui.theme.OmertaAssistantBubble
import ai.omerta.assistant.ui.theme.OmertaBorder
import ai.omerta.assistant.ui.theme.OmertaRed
import ai.omerta.assistant.ui.theme.OmertaTextPrimary
import ai.omerta.assistant.ui.theme.OmertaTextSecondary
import ai.omerta.assistant.ui.theme.OmertaUserBubble

@Composable
fun MessageBubble(item: ChatItem) {
    val isUser = item.role == Role.USER
    val label = when {
        item.isError -> "ERROR"
        isUser -> "OPERATOR"
        else -> "OMERTA"
    }
    val labelColor = when {
        item.isError -> OmertaRed
        isUser -> OmertaTextSecondary
        else -> OmertaAmber
    }
    val bubbleColor = if (isUser) OmertaUserBubble else OmertaAssistantBubble
    val borderColor = if (item.isError) OmertaRed else OmertaBorder

    Column(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp),
        horizontalAlignment = if (isUser) Alignment.End else Alignment.Start,
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.labelSmall,
            color = labelColor,
            modifier = Modifier.padding(bottom = 3.dp, start = 4.dp, end = 4.dp),
        )
        Row(
            horizontalArrangement = if (isUser) Arrangement.End else Arrangement.Start,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Column(
                modifier = Modifier
                    .widthIn(max = 320.dp)
                    .clip(RoundedCornerShape(10.dp))
                    .background(bubbleColor)
                    .border(1.dp, borderColor, RoundedCornerShape(10.dp))
                    .padding(horizontal = 14.dp, vertical = 10.dp),
            ) {
                val display = if (item.streaming && item.content.isEmpty()) "…" else item.content
                Text(
                    text = display,
                    style = MaterialTheme.typography.bodyMedium,
                    color = if (item.isError) OmertaRed else OmertaTextPrimary,
                )
                if (item.streaming && item.content.isNotEmpty()) {
                    Text(
                        text = "▌",
                        style = MaterialTheme.typography.bodyMedium,
                        color = OmertaAmber,
                        textAlign = TextAlign.Start,
                    )
                }
            }
        }
    }
}
