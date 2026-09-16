package ai.omerta.assistant.ui.components

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.DeleteOutline
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
import ai.omerta.assistant.ui.theme.OmertaTextPrimary
import ai.omerta.assistant.viewmodel.ConnectionState

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun OmertaTopBar(
    connection: ConnectionState,
    serverModel: String?,
    onSettings: () -> Unit,
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
                StatusDot(connection)
            }
        },
        navigationIcon = {
            IconButton(onClick = onClear) {
                Icon(Icons.Filled.DeleteOutline, contentDescription = "Clear", tint = OmertaTextPrimary)
            }
        },
        actions = {
            IconButton(onClick = onSettings) {
                Icon(Icons.Filled.Settings, contentDescription = "Settings", tint = OmertaTextPrimary)
            }
        },
    )
}
