package ai.omerta.assistant

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.ui.Modifier
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import ai.omerta.assistant.ui.screens.ChatScreen
import ai.omerta.assistant.ui.screens.SettingsScreen
import ai.omerta.assistant.ui.theme.OmertaBlack
import ai.omerta.assistant.ui.theme.OmertaTheme
import ai.omerta.assistant.viewmodel.ChatViewModel

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        setContent {
            OmertaTheme {
                Surface(modifier = Modifier.fillMaxSize(), color = OmertaBlack) {
                    val nav = rememberNavController()
                    // Single VM shared across destinations (Activity scope).
                    val vm: ChatViewModel = viewModel()
                    NavHost(navController = nav, startDestination = "chat") {
                        composable("chat") {
                            ChatScreen(vm = vm, onSettings = { nav.navigate("settings") })
                        }
                        composable("settings") {
                            SettingsScreen(vm = vm, onBack = { nav.popBackStack() })
                        }
                    }
                }
            }
        }
    }
}
