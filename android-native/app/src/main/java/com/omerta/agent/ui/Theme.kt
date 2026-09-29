package com.omerta.agent.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

// The agent's identity: near-black, blood red, monospace. Kept as plain values
// rather than pulled from the web UI's CSS -- this app no longer renders HTML.
val Ink = Color(0xFF0B0A08)
val Panel = Color(0xFF141210)
val PanelHi = Color(0xFF1C1917)
val Border = Color(0xFF2A2724)
val Blood = Color(0xFFB2131B)
val Ember = Color(0xFFE4453C)
val Amber = Color(0xFFFFB020)
val TextHi = Color(0xFFE8DDC8)
val TextLo = Color(0xFF8A8272)
val Good = Color(0xFF4FAF6D)
val Warn = Color(0xFFD98B2B)

private val scheme = darkColorScheme(
    primary = Blood,
    onPrimary = Color.White,
    secondary = Ember,
    background = Ink,
    onBackground = TextHi,
    surface = Panel,
    onSurface = TextHi,
    surfaceVariant = PanelHi,
    onSurfaceVariant = TextLo,
    outline = Border,
    error = Ember,
)

private val mono = FontFamily.Monospace

private val type = Typography(
    bodyLarge = TextStyle(fontFamily = mono, fontSize = 14.sp, lineHeight = 21.sp),
    bodyMedium = TextStyle(fontFamily = mono, fontSize = 13.sp, lineHeight = 19.sp),
    bodySmall = TextStyle(fontFamily = mono, fontSize = 11.sp, lineHeight = 16.sp),
    titleMedium = TextStyle(fontFamily = mono, fontSize = 15.sp,
                            fontWeight = FontWeight.Bold, letterSpacing = 1.sp),
    labelLarge = TextStyle(fontFamily = mono, fontSize = 12.sp,
                           fontWeight = FontWeight.Bold, letterSpacing = 1.sp),
    labelSmall = TextStyle(fontFamily = mono, fontSize = 10.sp, letterSpacing = 0.8.sp),
)

@Composable
fun OmertaTheme(content: @Composable () -> Unit) {
    // Always dark. This is an operator console, not a document reader, and a
    // light variant would be a second design to keep honest for no one.
    @Suppress("UNUSED_EXPRESSION") isSystemInDarkTheme()
    MaterialTheme(colorScheme = scheme, typography = type, content = content)
}
