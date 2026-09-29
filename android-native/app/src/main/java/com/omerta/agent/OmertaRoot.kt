package com.omerta.agent

import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
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
import androidx.compose.foundation.layout.width
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
import com.omerta.agent.ui.ChatsScreen
import com.omerta.agent.ui.CodeScreen
import com.omerta.agent.ui.GitScreen
import com.omerta.agent.ui.Intake
import com.omerta.agent.ui.LearnScreen
import com.omerta.agent.ui.ToolsScreen
import com.omerta.agent.ui.Ember
import com.omerta.agent.ui.Ink
import com.omerta.agent.ui.OmertaTheme
import com.omerta.agent.ui.Panel
import com.omerta.agent.ui.SettingsScreen
import com.omerta.agent.ui.TerminalScreen
import com.omerta.agent.ui.TextHi
import com.omerta.agent.ui.TextLo
import android.view.WindowManager
import com.omerta.agent.ui.clickableNoRipple
import com.omerta.agent.ui.collectAsStateWithLifecycleCompat
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private enum class Tab(val label: String) {
    CHAT("CHAT"), CHATS("CHATS"), CODE("CODE"), GIT("GIT"), LEARN("LEARN"),
    TOOLS("TOOLS"), TERMINAL("TERM"), SETTINGS("SETTINGS")
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
            else -> LockGate { Console() }
        }
    }
}

@Composable
private fun Console() {
    val vm: ChatViewModel = viewModel()
    var tab by remember { mutableStateOf(Tab.CHAT) }
    val st by vm.state.collectAsStateWithLifecycleCompat()

    LaunchedEffect(Unit) { vm.boot() }

    // A file named in a reply opens the editor. The tab switch happens here
    // because the chat screen has no business knowing the tab bar exists.
    val wantsFile by com.omerta.agent.ui.Intake.openPath
        .collectAsStateWithLifecycleCompat()
    LaunchedEffect(wantsFile) {
        if (wantsFile != null) tab = Tab.CODE
    }

    // Two settings the backend has always exposed and the Compose rebuild
    // never read, so turning them on did nothing at all.
    val ctx = androidx.compose.ui.platform.LocalContext.current
    var keepAwake by remember { mutableStateOf(false) }
    var haptics by remember { mutableStateOf(false) }
    var notifyApproval by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) {
        val s = OmertaClient.settings().optJSONObject("settings")
        keepAwake = truthy(s?.optJSONObject("OMERTA_KEEP_AWAKE")?.optString("value"))
        haptics = truthy(s?.optJSONObject("OMERTA_HAPTICS")?.optString("value"))
        notifyApproval =
            truthy(s?.optJSONObject("OMERTA_NOTIFY_APPROVAL")?.optString("value"))
    }
    LaunchedEffect(keepAwake) {
        val w = (ctx as? ComponentActivity)?.window ?: return@LaunchedEffect
        if (keepAwake) w.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        else w.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }
    // A phone face-down on a desk while a long turn runs is the whole reason
    // this exists: the approval prompt is useless if nobody sees it.
    LaunchedEffect(st.pending) {
        val p = st.pending
        if (p != null) {
            if (haptics) buzz(ctx)
            if (notifyApproval) BackendService.alertApproval(ctx, p.action)
        } else {
            BackendService.clearApprovalAlert(ctx)
        }
    }

    // A turn lives in the backend, not in this process. Android kills a
    // backgrounded app whenever it likes, and a turn can take a minute, so
    // the id of whatever was in flight is written down and picked back up on
    // the next launch instead of showing an empty chat while the model is
    // still writing.
    val prefs = remember {
        ctx.getSharedPreferences("omerta-ui", android.content.Context.MODE_PRIVATE)
    }
    LaunchedEffect(Unit) {
        val pending = prefs.getString("live_stream", "") ?: ""
        prefs.edit().remove("live_stream").apply()
        if (pending.isNotEmpty()) vm.resume(pending)
    }
    LaunchedEffect(st.busy) {
        val id = vm.liveStreamId()
        if (st.busy && !id.isNullOrEmpty()) {
            prefs.edit().putString("live_stream", id).apply()
        } else if (!st.busy) {
            prefs.edit().remove("live_stream").apply()
        }
    }

    Column(Modifier.fillMaxSize()) {
        Header(provider = st.provider, policy = st.policy, project = st.project)
        TabBar(tab) { tab = it }
        Box(Modifier.weight(1f)) {
            when (tab) {
                Tab.CHAT -> ChatScreen(vm)
                Tab.CHATS -> ChatsScreen(vm)
                Tab.CODE -> CodeScreen()
                Tab.GIT -> GitScreen(vm) { ask ->
                    // A git action never runs from that screen. It is put to
                    // the agent, which proposes the exact command on an
                    // approval card first.
                    Intake.offerText(ask)
                    tab = Tab.CHAT
                }
                Tab.LEARN -> LearnScreen(vm)
                Tab.TOOLS -> ToolsScreen(vm)
                Tab.TERMINAL -> TerminalScreen()
                Tab.SETTINGS -> SettingsScreen(vm)
            }
        }
    }
}

@Composable
private fun Header(provider: String, policy: String, project: String) {
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
            if (project.isNotEmpty()) Pill(project)
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
    Row(
        Modifier
            .fillMaxWidth()
            .background(Ink)
            .horizontalScroll(rememberScrollState()),
    ) {
        Tab.entries.forEach { t ->
            val on = t == current
            Column(
                Modifier
                    .clickableNoRipple { onPick(t) }
                    .padding(horizontal = 14.dp, vertical = 11.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text(t.label, style = MaterialTheme.typography.labelSmall,
                     color = if (on) Ember else TextLo)
                Spacer(Modifier.height(7.dp))
                Box(
                    Modifier
                        .width(44.dp)
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


private fun truthy(v: String?) =
    v == "1" || v.equals("true", ignoreCase = true) || v.equals("yes", ignoreCase = true)

/** One short pulse. Deliberately not a pattern: this is a notice, not an alarm. */
private fun buzz(ctx: android.content.Context) {
    val vib = if (android.os.Build.VERSION.SDK_INT >= 31) {
        (ctx.getSystemService(android.os.VibratorManager::class.java))?.defaultVibrator
    } else {
        @Suppress("DEPRECATION")
        ctx.getSystemService(android.os.Vibrator::class.java)
    }
    runCatching {
        if (android.os.Build.VERSION.SDK_INT >= 26) {
            vib?.vibrate(android.os.VibrationEffect.createOneShot(
                40, android.os.VibrationEffect.DEFAULT_AMPLITUDE))
        } else {
            @Suppress("DEPRECATION")
            vib?.vibrate(40)
        }
    }
}


/**
 * The device passcode, in front of the app.
 *
 * Deliberately the SYSTEM credential (PIN, pattern, password or the biometric
 * bound to it) rather than a passcode of OMERTA's own. A second secret kept by
 * this app would be one more thing to forget, stored somewhere on the same
 * device, protecting data that the device lock already protects at rest -- and
 * it would be weaker than the thing it sits in front of.
 *
 * If the device has no lock set, this passes straight through and says so. An
 * app lock on an unlocked phone is theatre, and refusing to open would lock
 * the owner out of their own data to no one's benefit.
 */
@Composable
private fun LockGate(content: @Composable () -> Unit) {
    val ctx = androidx.compose.ui.platform.LocalContext.current
    var want by remember { mutableStateOf<Boolean?>(null) }
    var unlocked by remember { mutableStateOf(false) }
    var refused by remember { mutableStateOf(false) }

    val km = remember {
        ctx.getSystemService(android.app.KeyguardManager::class.java)
    }
    val secure = remember {
        android.os.Build.VERSION.SDK_INT < 23 || km?.isDeviceSecure == true
    }

    val prompt = androidx.activity.compose.rememberLauncherForActivityResult(
        androidx.activity.result.contract.ActivityResultContracts
            .StartActivityForResult()
    ) { result ->
        if (result.resultCode == android.app.Activity.RESULT_OK) {
            unlocked = true
            refused = false
        } else {
            refused = true
        }
    }

    fun ask() {
        val i = km?.createConfirmDeviceCredentialIntent(
            "OMERTA", "Unlock to open the agent")
        if (i == null) unlocked = true else runCatching { prompt.launch(i) }
            .onFailure { unlocked = true }
    }

    LaunchedEffect(Unit) {
        val s = OmertaClient.settings().optJSONObject("settings")
        val on = truthy(s?.optJSONObject("OMERTA_APP_LOCK")?.optString("value"))
        want = on && secure
        if (on && !secure) unlocked = true
        if (want == true) ask()
    }

    when {
        want == null -> Splash("OMERTA AI", "checking…")
        want == false || unlocked -> content()
        else -> Column(
            Modifier.fillMaxSize().padding(28.dp),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text("LOCKED", style = MaterialTheme.typography.titleMedium, color = Ember)
            Spacer(Modifier.height(12.dp))
            Text(if (refused) "Not unlocked. Nothing is readable until it is."
                 else "Confirm with this device's passcode.",
                 style = MaterialTheme.typography.bodySmall, color = TextLo,
                 textAlign = TextAlign.Center)
            Spacer(Modifier.height(20.dp))
            Box(
                Modifier
                    .clip(RoundedCornerShape(6.dp))
                    .background(Panel)
                    .border(1.dp, Amber, RoundedCornerShape(6.dp))
                    .clickableNoRipple { refused = false; ask() }
                    .padding(horizontal = 18.dp, vertical = 13.dp),
            ) {
                Text("UNLOCK", style = MaterialTheme.typography.labelLarge,
                     color = Amber)
            }
        }
    }
}
