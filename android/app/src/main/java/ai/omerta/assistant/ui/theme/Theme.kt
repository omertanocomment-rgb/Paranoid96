package ai.omerta.assistant.ui.theme

import android.app.Activity
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat

private val OmertaColorScheme = darkColorScheme(
    primary = OmertaAmber,
    onPrimary = OmertaBlack,
    secondary = OmertaAmberDim,
    onSecondary = OmertaBlack,
    background = OmertaBlack,
    onBackground = OmertaTextPrimary,
    surface = OmertaSurface,
    onSurface = OmertaTextPrimary,
    surfaceVariant = OmertaSurfaceHigh,
    onSurfaceVariant = OmertaTextSecondary,
    outline = OmertaBorder,
    error = OmertaRed,
    onError = OmertaBlack,
)

@Composable
fun OmertaTheme(
    // The app is always dark by design; the param exists for future themes.
    darkTheme: Boolean = true,
    content: @Composable () -> Unit,
) {
    val view = LocalView.current
    if (!view.isInEditMode) {
        SideEffect {
            val window = (view.context as Activity).window
            window.statusBarColor = OmertaBlack.toArgb()
            window.navigationBarColor = OmertaBlack.toArgb()
            WindowCompat.getInsetsController(window, view).isAppearanceLightStatusBars = false
        }
    }
    MaterialTheme(
        colorScheme = OmertaColorScheme,
        typography = OmertaTypography,
        content = content,
    )
}
