package com.omerta.agent.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp

/**
 * The console's shared parts.
 *
 * Every screen is built from these so the app reads as one thing rather than
 * six. They are flat panels with a hairline border and no ripple: a Material
 * ripple on top of this palette looks like a different application.
 */

@Composable
fun Section(
    title: String,
    trailing: String? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(7.dp))
            .background(Panel)
            .border(1.dp, Border, RoundedCornerShape(7.dp))
            .padding(12.dp),
    ) {
        Row(Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically) {
            Text(title.uppercase(), style = MaterialTheme.typography.labelLarge,
                 color = Ember)
            trailing?.let {
                Text(it, style = MaterialTheme.typography.labelSmall, color = TextLo)
            }
        }
        Spacer(Modifier.height(10.dp))
        content()
    }
}

@Composable
fun Chip(
    label: String,
    on: Boolean = false,
    modifier: Modifier = Modifier,
    tint: Color = Blood,
    onClick: () -> Unit,
) {
    Box(
        modifier
            .clip(RoundedCornerShape(5.dp))
            .background(if (on) tint.copy(alpha = 0.22f) else PanelHi)
            .border(1.dp, if (on) tint else Border, RoundedCornerShape(5.dp))
            .clickableNoRipple(onClick)
            .padding(horizontal = 12.dp, vertical = 9.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(label, style = MaterialTheme.typography.labelSmall,
             color = if (on) tint else TextHi)
    }
}

/** A tappable row: a label, an optional detail line, an optional right mark. */
@Composable
fun ListRow(
    title: String,
    detail: String? = null,
    right: String? = null,
    rightColor: Color = TextLo,
    selected: Boolean = false,
    mono: Boolean = false,
    onClick: (() -> Unit)? = null,
) {
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(5.dp))
            .background(if (selected) Blood.copy(alpha = 0.18f) else PanelHi)
            .border(1.dp, if (selected) Blood else Border, RoundedCornerShape(5.dp))
            .let { if (onClick != null) it.clickableNoRipple(onClick) else it }
            .padding(10.dp),
    ) {
        Row(Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically) {
            Text(
                title,
                style = if (mono) MaterialTheme.typography.bodySmall.copy(
                    fontFamily = FontFamily.Monospace)
                else MaterialTheme.typography.bodySmall,
                color = TextHi,
                modifier = Modifier.weight(1f, fill = false),
            )
            right?.let {
                Spacer(Modifier.height(0.dp))
                Text(it, style = MaterialTheme.typography.labelSmall, color = rightColor)
            }
        }
        if (!detail.isNullOrEmpty()) {
            Spacer(Modifier.height(3.dp))
            Text(detail, style = MaterialTheme.typography.labelSmall, color = TextLo)
        }
    }
}

/** A single-line field styled like the rest of the console. */
@Composable
fun Field(
    value: String,
    onChange: (String) -> Unit,
    placeholder: String,
    modifier: Modifier = Modifier,
    mono: Boolean = true,
    singleLine: Boolean = true,
) {
    Box(
        modifier
            .clip(RoundedCornerShape(5.dp))
            .background(Ink)
            .border(1.dp, Border, RoundedCornerShape(5.dp))
            .padding(horizontal = 10.dp, vertical = 10.dp),
    ) {
        if (value.isEmpty()) {
            Text(placeholder, style = MaterialTheme.typography.bodySmall, color = TextLo)
        }
        BasicTextField(
            value = value,
            onValueChange = onChange,
            singleLine = singleLine,
            textStyle = MaterialTheme.typography.bodySmall.copy(
                color = TextHi,
                fontFamily = if (mono) FontFamily.Monospace else FontFamily.Default),
            cursorBrush = SolidColor(Ember),
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

/** What the backend said, when it is worth showing verbatim. */
@Composable
fun Note(text: String, color: Color = TextLo) {
    if (text.isEmpty()) return
    Spacer(Modifier.height(6.dp))
    Text(text, style = MaterialTheme.typography.labelSmall, color = color)
}

@Composable
fun Empty(text: String) {
    Text(text, style = MaterialTheme.typography.bodySmall, color = TextLo,
         modifier = Modifier.padding(vertical = 6.dp))
}

fun bytesLabel(n: Long): String = when {
    n >= 1_073_741_824 -> String.format("%.2f GB", n / 1_073_741_824.0)
    n >= 1_048_576 -> String.format("%.1f MB", n / 1_048_576.0)
    n >= 1024 -> String.format("%.0f KB", n / 1024.0)
    else -> "$n B"
}
