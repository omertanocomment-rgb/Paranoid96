package com.omerta.agent

import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.omerta.agent.ui.Amber
import com.omerta.agent.ui.Blood
import com.omerta.agent.ui.Border
import com.omerta.agent.ui.ChatScreen
import com.omerta.agent.ui.ChatViewModel
import com.omerta.agent.ui.Ember
import com.omerta.agent.ui.Ink
import com.omerta.agent.ui.OmertaTheme
import com.omerta.agent.ui.Panel
import com.omerta.agent.ui.SettingsScreen
import com.omerta.agent.ui.TerminalScreen
import com.omerta.agent.ui.TextHi
import com.omerta.agent.ui.TextLo
import com.omerta.agent.ui.clickableNoRipple
import com.omerta.agent.ui.collectAsStateWithLifecycleCompat
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private enum class Tab(val label: String) {
    CHAT("CHAT"), TERMINAL("TERMINAL"), SETTINGS("SETTINGS")
}

object OmertaRoot {
    @JvmStatic
    fun install(activity: ComponentActivity) {
        activity.setContent { OmertaTheme { Root() } }
    }
}

@Composable
private fun Root() {
    var ready by remember { mutableStateOf(OmertaPython.isReady()) }
    var failure by remember { mutableStateOf<String?>(null) }
    var files by remember { mutableStateOf(0) }
    var unpacking by remember { mutableStateOf(false) }
    var seconds by remember { mutableStateOf(0) }

    // Wait on the interpreter, not on a socket: there is no port to poll.
    LaunchedEffect(Unit) {
        while (!ready) {
            if (OmertaPython.isReady()) { ready = true; break }
            val err = OmertaPython.lastError()
            if (err != null) { failure = err; break }
            files = OmertaAssets.written()
            unpacking = OmertaAssets.extracting()
            delay(500)
            seconds += 1
        }
    }

    Surface(Modifier.fillMaxSize(), color = Ink) {
        when {
            failure != null -> FailureScreen(failure!!)
            !ready -> Splash(
                title = "OMERTA AI",
                detail = if (unpacking)
                    "unpacking Python… $files files\n(one-time step, it does not repeat)"
                else "starting agent… ${seconds / 2}s",
            )
            else -> Console()
        }
    }
}

@Composable
private fun Console() {
    val vm: ChatViewModel = viewModel()
    var tab by remember { mutableStateOf(Tab.CHAT) }
    val st by vm.state.collectAsStateWithLifecycleCompat()

    LaunchedEffect(Unit) { vm.boot() }

    Column(Modifier.fillMaxSize()) {
        Header(provider = st.provider, policy = st.policy)
        TabBar(tab) { tab = it }
        Box(Modifier.weight(1f)) {
            when (tab) {
                Tab.CHAT -> ChatScreen(vm)
                Tab.TERMINAL -> TerminalScreen()
                Tab.SETTINGS -> SettingsScreen(vm)
            }
        }
    }
}

@Composable
private fun Header(provider: String, policy: String) {
    Row(
        Modifier
            .fillMaxWidth()
            .background(Ink)
            .statusBarsPadding()
            .padding(horizontal = 14.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Column {
            Text("OMERTA AI", style = MaterialTheme.typography.titleMedium, color = Ember)
            Text("SILENCE IS THE ONLY UNBREAKABLE CODE",
                 style = MaterialTheme.typography.labelSmall, color = TextLo)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            if (policy.isNotEmpty()) Pill(policyLabel(policy))
            Pill(provider)
        }
    }
}

private fun policyLabel(p: String) = when (p) {
    "always" -> "ASKS FIRST"
    "low_risk" -> "CHANGES"
    "high_risk" -> "DANGER ONLY"
    else -> p.uppercase()
}

@Composable
private fun Pill(text: String) {
    Box(
        Modifier
            .clip(RoundedCornerShape(20.dp))
            .background(Panel)
            .border(1.dp, Border, RoundedCornerShape(20.dp))
            .padding(horizontal = 10.dp, vertical = 5.dp),
    ) {
        Text(text, style = MaterialTheme.typography.labelSmall, color = TextLo)
    }
}

@Composable
private fun TabBar(current: Tab, onPick: (Tab) -> Unit) {
    Row(Modifier.fillMaxWidth().background(Ink)) {
        Tab.entries.forEach { t ->
            val on = t == current
            Column(
                Modifier
                    .weight(1f)
                    .clickableNoRipple { onPick(t) }
                    .padding(vertical = 11.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text(t.label, style = MaterialTheme.typography.labelSmall,
                     color = if (on) Ember else TextLo)
                Spacer(Modifier.height(7.dp))
                Box(
                    Modifier
                        .fillMaxWidth()
                        .height(2.dp)
                        .background(if (on) Blood else Border.copy(alpha = 0.4f)),
                )
            }
        }
    }
}

/**
 * A launch failure the owner of the phone can actually report.
 *
 * The reason is on screen, and the button re-runs the launch and collects the
 * device, ABI, payload state and full Python traceback. A failure that only
 * exists in logcat is a failure nobody can send me.
 */
@Composable
private fun FailureScreen(reason: String) {
    val ctx = androidx.compose.ui.platform.LocalContext.current
    var report by remember { mutableStateOf<String?>(null) }
    var working by remember { mutableStateOf(false) }
    val scope = androidx.compose.runtime.rememberCoroutineScope()

    Column(
        Modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text("Backend didn't start", style = MaterialTheme.typography.titleMedium,
             color = Ember)
        Spacer(Modifier.height(12.dp))
        Text(reason, style = MaterialTheme.typography.bodySmall, color = TextLo,
             textAlign = TextAlign.Center)
        Spacer(Modifier.height(22.dp))
        Box(
            Modifier
                .clip(RoundedCornerShape(6.dp))
                .background(Panel)
                .border(1.dp, Amber, RoundedCornerShape(6.dp))
                .clickableNoRipple {
                    if (!working) {
                        working = true
                        scope.launch {
                            val r = kotlinx.coroutines.withContext(
                                kotlinx.coroutines.Dispatchers.IO) {
                                OmertaPython.diagnostics(ctx)
                            }
                            report = r
                            working = false
                        }
                    }
                }
                .padding(horizontal = 18.dp, vertical = 13.dp),
        ) {
            Text(if (working) "COLLECTING…" else "RETRY & SHOW DIAGNOSTICS",
                 style = MaterialTheme.typography.labelLarge, color = Amber)
        }
        report?.let { text ->
            Spacer(Modifier.height(16.dp))
            Box(
                Modifier
                    .fillMaxWidth()
                    .weight(1f, fill = false)
                    .clip(RoundedCornerShape(6.dp))
                    .background(androidx.compose.ui.graphics.Color.Black)
                    .border(1.dp, Border, RoundedCornerShape(6.dp))
                    .verticalScroll(androidx.compose.foundation.rememberScrollState())
                    .padding(10.dp),
            ) {
                Text(text, style = MaterialTheme.typography.labelSmall, color = TextLo)
            }
            Spacer(Modifier.height(10.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                SmallAction("COPY") {
                    val cm = ctx.getSystemService(android.content.ClipboardManager::class.java)
                    cm?.setPrimaryClip(
                        android.content.ClipData.newPlainText("omerta-diagnostics", text))
                }
                SmallAction("SHARE") {
                    val send = android.content.Intent(android.content.Intent.ACTION_SEND)
                    send.type = "text/plain"
                    send.putExtra(android.content.Intent.EXTRA_TEXT, text)
                    ctx.startActivity(
                        android.content.Intent.createChooser(send, "Send diagnostics"))
                }
            }
        }
    }
}

@Composable
private fun SmallAction(label: String, onClick: () -> Unit) {
    Box(
        Modifier
            .clip(RoundedCornerShape(5.dp))
            .background(Panel)
            .border(1.dp, Border, RoundedCornerShape(5.dp))
            .clickableNoRipple(onClick)
            .padding(horizontal = 14.dp, vertical = 10.dp),
    ) {
        Text(label, style = MaterialTheme.typography.labelSmall, color = TextHi)
    }
}

@Composable
private fun Splash(title: String, detail: String) {
    Column(
        Modifier.fillMaxSize().padding(28.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(title, style = MaterialTheme.typography.titleMedium, color = Ember)
        Spacer(Modifier.height(14.dp))
        Text(detail, style = MaterialTheme.typography.bodySmall, color = TextLo,
             textAlign = TextAlign.Center)
    }
}
