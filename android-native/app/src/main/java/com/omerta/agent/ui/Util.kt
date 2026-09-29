package com.omerta.agent.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.runtime.Composable
import androidx.compose.runtime.State
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import kotlinx.coroutines.flow.StateFlow

/**
 * Collect a StateFlow into Compose.
 *
 * Named so it can be swapped for lifecycle-aware collection without touching
 * every call site. The screens here are all in one Activity that is either
 * visible or stopped, so the difference is not observable yet.
 */
@Composable
fun <T> StateFlow<T>.collectAsStateWithLifecycleCompat(): State<T> = collectAsState()

/**
 * A tap with no ripple.
 *
 * The console's controls are flat panels with a border; a Material ripple on
 * top of them looks like a different application.
 */
fun Modifier.clickableNoRipple(onClick: () -> Unit): Modifier = composed {
    val source = remember { MutableInteractionSource() }
    clickable(interactionSource = source, indication = null, onClick = onClick)
}
