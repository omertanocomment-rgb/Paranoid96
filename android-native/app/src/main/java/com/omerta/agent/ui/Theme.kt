package com.omerta.agent.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import com.omerta.agent.R

// THE ONE KNOB. A sibling app changes these four values and its icon tint
// (scripts/gen_omerta_icon.py --tint NAME) and nothing else: the mark, the
// layout, the type and the structure of this palette are the house identity
// and are not redesigned per app. See CLAUDE.md.
//
// The owner's palette: red on black, from res/values/colors.xml.
//
// Ink, Panel, Blood and Ember are those four tokens exactly -- the Compose
// rebuild invented a warmer bone-and-ember scheme of mine instead, and the
// app stopped looking like the thing it is named after. Everything else here
// is derived from them so the two never drift apart again: change colors.xml
// and change these four, and the rest follows.
val Ink = Color(0xFF0A0506)        // omerta_bg
val Panel = Color(0xFF140B0D)      // omerta_panel
val Blood = Color(0xFFC81E28)      // omerta_red
val Ember = Color(0xFFFF2D3C)      // omerta_red_bright

val PanelHi = Color(0xFF1C1014)    // one step up from Panel
val Border = Color(0xFF2E1A1E)     // a hairline with red in it, not grey
val Amber = Color(0xFFE0A02A)
val TextHi = Color(0xFFE9E2E2)     // near-white, the plate's bone
val TextLo = Color(0xFF8C7A7D)     // muted, still warm
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

/**
 * The blackletter on the plate, for the name and nothing else.
 *
 * UnifrakturMaguntia, bundled under the OFL (see assets/FONT-LICENSE.txt), so
 * the banner renders with no network access. Used ONLY for the wordmark: it is
 * unreadable at body size and on a status line, and an interface set in
 * blackletter is a poster, not a console.
 */
val Display = FontFamily(Font(R.font.unifraktur_maguntia))

private val type = Typography(
    bodyLarge = TextStyle(fontFamily = mono, fontSize = 14.sp, lineHeight = 21.sp),
    bodyMedium = TextStyle(fontFamily = mono, fontSize = 13.sp, lineHeight = 19.sp),
    bodySmall = TextStyle(fontFamily = mono, fontSize = 11.sp, lineHeight = 16.sp),
    titleMedium = TextStyle(fontFamily = mono, fontSize = 15.sp,
                            fontWeight = FontWeight.Bold, letterSpacing = 1.sp),
    labelLarge = TextStyle(fontFamily = mono, fontSize = 12.sp,
                           fontWeight = FontWeight.Bold, letterSpacing = 1.sp),
    labelSmall = TextStyle(fontFamily = mono, fontSize = 10.sp, letterSpacing = 0.8.sp),
    // The wordmark. Blackletter, larger, no letter-spacing -- the face already
    // has its own rhythm and tracking it out just breaks the ligatures.
    headlineSmall = TextStyle(fontFamily = Display, fontSize = 26.sp,
                              letterSpacing = 0.sp),
)

@Composable
fun OmertaTheme(content: @Composable () -> Unit) {
    // Always dark. This is an operator console, not a document reader, and a
    // light variant would be a second design to keep honest for no one.
    @Suppress("UNUSED_EXPRESSION") isSystemInDarkTheme()
    MaterialTheme(colorScheme = scheme, typography = type, content = content)
}
