package ai.omerta.assistant.ui.theme

import androidx.compose.material3.Typography
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import ai.omerta.assistant.R

// JetBrains Mono for ALL UI typography, per the OMERTA house style.
val JetBrainsMono = FontFamily(
    Font(R.font.jetbrains_mono_regular, FontWeight.Normal),
    Font(R.font.jetbrains_mono_medium, FontWeight.Medium),
    Font(R.font.jetbrains_mono_semibold, FontWeight.SemiBold),
    Font(R.font.jetbrains_mono_bold, FontWeight.Bold),
)

private fun mono(
    size: Int,
    weight: FontWeight = FontWeight.Normal,
    lineHeight: Int = size + 6,
    spacing: Double = 0.0,
) = TextStyle(
    fontFamily = JetBrainsMono,
    fontWeight = weight,
    fontSize = size.sp,
    lineHeight = lineHeight.sp,
    letterSpacing = spacing.sp,
)

val OmertaTypography = Typography(
    displaySmall = mono(28, FontWeight.Bold),
    headlineMedium = mono(22, FontWeight.SemiBold),
    headlineSmall = mono(18, FontWeight.SemiBold),
    titleLarge = mono(18, FontWeight.Medium),
    titleMedium = mono(15, FontWeight.Medium),
    titleSmall = mono(13, FontWeight.Medium, spacing = 0.5),
    bodyLarge = mono(15, FontWeight.Normal, lineHeight = 23),
    bodyMedium = mono(14, FontWeight.Normal, lineHeight = 21),
    bodySmall = mono(12, FontWeight.Normal),
    labelLarge = mono(14, FontWeight.Medium),
    labelMedium = mono(12, FontWeight.Medium, spacing = 0.5),
    labelSmall = mono(11, FontWeight.Medium, spacing = 0.5),
)
