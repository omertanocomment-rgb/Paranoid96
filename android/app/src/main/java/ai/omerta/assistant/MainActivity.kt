package ai.omerta.assistant

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.compose.runtime.LaunchedEffect
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
import ai.omerta.assistant.ui.screens.BrainScreen
import ai.omerta.assistant.ui.screens.ChatScreen
import ai.omerta.assistant.ui.screens.SettingsScreen
import ai.omerta.assistant.ui.theme.OmertaBlack
import ai.omerta.assistant.ui.theme.OmertaTheme
import ai.omerta.assistant.viewmodel.ChatViewModel

class MainActivity : ComponentActivity() {
    private var vmRef: ChatViewModel? = null
    private var pendingIntent: Intent? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        if (savedInstanceState == null) pendingIntent = intent
        setContent {
            OmertaTheme {
                Surface(modifier = Modifier.fillMaxSize(), color = OmertaBlack) {
                    val nav = rememberNavController()
                    // Single VM shared across destinations (Activity scope).
                    val vm: ChatViewModel = viewModel()
                    LaunchedEffect(vm) {
                        vmRef = vm
                        pendingIntent?.let { deliver(vm, it) }
                        pendingIntent = null
                    }
                    NavHost(navController = nav, startDestination = "chat") {
                        composable("chat") {
                            ChatScreen(vm = vm, onSettings = { nav.navigate("settings") },
                                onBrain = { nav.navigate("brain") })
                        }
                        composable("settings") {
                            SettingsScreen(vm = vm, onBack = { nav.popBackStack() })
                        }
                        composable("brain") {
                            BrainScreen(vm = vm, onBack = { nav.popBackStack() })
                        }
                    }
                }
            }
        }
    }

    override fun onResume() {
        super.onResume()
        vmRef?.scanBrainInbox()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        vmRef?.let { deliver(it, intent) } ?: run { pendingIntent = intent }
    }

    /** "Upload" path: files opened/shared into the app go straight into the brain. */
    private fun deliver(vm: ChatViewModel, intent: Intent) {
        when (intent.action) {
            Intent.ACTION_VIEW -> intent.data?.let { vm.importIncoming(listOf(it)) }
            Intent.ACTION_SEND -> {
                @Suppress("DEPRECATION")
                val stream = intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM)
                if (stream != null) vm.importIncoming(listOf(stream))
                else intent.getStringExtra(Intent.EXTRA_TEXT)?.let {
                    vm.teachShared(intent.getStringExtra(Intent.EXTRA_SUBJECT).orEmpty(), it)
                }
            }
            Intent.ACTION_SEND_MULTIPLE -> {
                @Suppress("DEPRECATION")
                val uris = intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM).orEmpty()
                if (uris.isNotEmpty()) vm.importIncoming(uris)
            }
        }
    }
}
