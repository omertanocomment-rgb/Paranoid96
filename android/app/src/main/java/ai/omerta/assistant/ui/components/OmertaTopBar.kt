package ai.omerta.assistant.ui.components

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.draw.clip
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.DeleteOutline
import androidx.compose.material.icons.filled.Psychology
import androidx.compose.material.icons.filled.IosShare
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.CenterAlignedTopAppBar
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
import ai.omerta.assistant.R
import ai.omerta.assistant.ui.theme.OmertaAmber
import ai.omerta.assistant.ui.theme.OmertaBlack
import ai.omerta.assistant.ui.theme.OmertaBorder
import ai.omerta.assistant.ui.theme.OmertaGreen
import ai.omerta.assistant.ui.theme.OmertaSurface
import ai.omerta.assistant.ui.theme.OmertaTextSecondary
import ai.omerta.assistant.ui.theme.OmertaTextPrimary
import ai.omerta.assistant.viewmodel.ConnectionState

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun OmertaTopBar(
    connection: ConnectionState,
    serverModel: String?,
    online: Boolean,
    onToggleMode: () -> Unit,
    onSettings: () -> Unit,
    onBrain: () -> Unit,
    onShare: () -> Unit,
    onClear: () -> Unit,
) {
    CenterAlignedTopAppBar(
        colors = TopAppBarDefaults.centerAlignedTopAppBarColors(
            containerColor = OmertaBlack,
            titleContentColor = OmertaTextPrimary,
        ),
        title = {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Image(
                        painter = painterResource(R.drawable.omerta_logo),
                        contentDescription = null,
                        colorFilter = ColorFilter.tint(OmertaAmber),
                        modifier = Modifier.size(22.dp).padding(end = 6.dp),
                    )
                    Text("OMERTA AI", style = MaterialTheme.typography.titleMedium, color = OmertaAmber)
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    StatusDot(connection)
                    Text(
                        text = if (online) "● ONLINE" else "○ OFFLINE",
                        style = MaterialTheme.typography.labelSmall,
                        color = if (online) OmertaGreen else OmertaTextSecondary,
                        modifier = Modifier
                            .padding(start = 8.dp)
                            .clip(RoundedCornerShape(6.dp))
                            .background(OmertaSurface)
                            .border(1.dp, if (online) OmertaGreen else OmertaBorder, RoundedCornerShape(6.dp))
                            .clickable { onToggleMode() }
                            .padding(horizontal = 6.dp, vertical = 1.dp),
                    )
                }
            }
        },
        navigationIcon = {
            IconButton(onClick = onClear) {
                Icon(Icons.Filled.DeleteOutline, contentDescription = "Clear", tint = OmertaTextPrimary)
            }
        },
        actions = {
            IconButton(onClick = onShare) {
                Icon(Icons.Filled.IosShare, contentDescription = "Share transcript", tint = OmertaTextPrimary)
            }
            IconButton(onClick = onBrain) {
                Icon(Icons.Filled.Psychology, contentDescription = "Brain", tint = OmertaAmber)
            }
            IconButton(onClick = onSettings) {
                Icon(Icons.Filled.Settings, contentDescription = "Settings", tint = OmertaTextPrimary)
            }
        },
    )
}
