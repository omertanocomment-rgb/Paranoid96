package ai.omerta.assistant.ui.screens

import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ai.omerta.assistant.data.brain.BrainEngine
import ai.omerta.assistant.data.brain.PromptFormat
import ai.omerta.assistant.data.local.BrainLlmMode
import ai.omerta.assistant.data.local.Provider
import ai.omerta.assistant.ui.theme.OmertaAmber
import ai.omerta.assistant.ui.theme.OmertaBlack
import ai.omerta.assistant.ui.theme.OmertaBorder
import ai.omerta.assistant.ui.theme.OmertaGreen
import ai.omerta.assistant.ui.theme.OmertaSurface
import ai.omerta.assistant.ui.theme.OmertaTextPrimary
import ai.omerta.assistant.ui.theme.OmertaTextSecondary
import ai.omerta.assistant.viewmodel.ChatViewModel
import kotlinx.coroutines.launch

private val VERBOSITY = listOf("short", "medium", "long")

/**
 * The Brain: build, teach, and carry your own offline AI.
 * Personality · knowledge · trained replies · rules · import/export · on-device model.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BrainScreen(vm: ChatViewModel, onBack: () -> Unit) {
    val rt = vm.brain
    val brain by rt.brain.collectAsStateWithLifecycle()
    val status by rt.status.collectAsStateWithLifecycle()
    val settings by vm.settings.collectAsStateWithLifecycle()
    val s = settings ?: return
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    fun toast(msg: String) = Toast.makeText(context, msg, Toast.LENGTH_LONG).show()

    val fieldColors = OutlinedTextFieldDefaults.colors(
        focusedContainerColor = OmertaSurface, unfocusedContainerColor = OmertaSurface,
        focusedBorderColor = OmertaAmber, unfocusedBorderColor = OmertaBorder, cursorColor = OmertaAmber,
        focusedTextColor = OmertaTextPrimary, unfocusedTextColor = OmertaTextPrimary,
        focusedLabelColor = OmertaAmber, unfocusedLabelColor = OmertaTextSecondary,
    )

    // ---- launchers
    val importLauncher = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        if (uris.isEmpty()) return@rememberLauncherForActivityResult
        scope.launch {
            var b = 0; var d = 0; var c = 0
            for (u in uris) runCatching { rt.import(u) }
                .onSuccess { b += it.brains; d += it.documents; c += it.chunks }
                .onFailure { toast("import failed: ${it.message}") }
            if (b + d > 0) toast("Imported $b brain(s), $d document(s) → $c knowledge chunk(s)")
        }
    }
    val exportLauncher = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/json")) { uri ->
        if (uri != null) scope.launch {
            runCatching { rt.export(uri) }.onSuccess { toast("Brain exported") }.onFailure { toast("export failed: ${it.message}") }
        }
    }
    var modelProgress by remember { mutableStateOf<Float?>(null) }
    var modelsRefresh by remember { mutableIntStateOf(0) }
    val modelLauncher = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) scope.launch {
            modelProgress = 0f
            runCatching {
                rt.importModel(uri) { done, total -> modelProgress = if (total > 0) done.toFloat() / total else -1f }
            }.onSuccess { f ->
                vm.saveBrainSettings(model = f.name); toast("Model installed: ${f.name}")
            }.onFailure { toast("model import failed: ${it.message}") }
            modelProgress = null; modelsRefresh++
        }
    }

    Scaffold(
        containerColor = OmertaBlack,
        topBar = {
            TopAppBar(
                title = { Text("BRAIN", style = MaterialTheme.typography.titleMedium, color = OmertaAmber) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back", tint = OmertaTextPrimary)
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = OmertaBlack),
            )
        },
    ) { padding ->
        Column(
            modifier = Modifier.fillMaxSize().padding(padding)
                .verticalScroll(rememberScrollState())
                .navigationBarsPadding().imePadding()
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            // ------------------------------------------------ header
            Column(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(OmertaSurface)
                    .border(1.dp, OmertaAmber, RoundedCornerShape(10.dp)).padding(14.dp),
            ) {
                Text("🧠 ${brain.persona.name}", style = MaterialTheme.typography.titleLarge, color = OmertaAmber)
                Text("${brain.name} · v${brain.version}${if (brain.author.isNotBlank()) " · by ${brain.author}" else ""}",
                    style = MaterialTheme.typography.labelSmall, color = OmertaTextSecondary)
                Text(
                    "${brain.knowledge.size} facts · ${brain.reflexes.size} trained replies · ${brain.lessons.size} rules · " +
                        "${brain.profile.size} about you · ${brain.stats.messages} msgs · ${brain.stats.corrections} corrections",
                    style = MaterialTheme.typography.bodySmall, color = OmertaTextPrimary, modifier = Modifier.padding(top = 6.dp),
                )
                val isBrainMode = s.embedded && s.provider == Provider.BRAIN
                Row(Modifier.padding(top = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Chip(if (isBrainMode) "● OFFLINE ACTIVE" else "USE OFFLINE", isBrainMode) { vm.useBrain() }
                }
            }

            // ------------------------------------------------ library
            Section("BRAINS ON THIS DEVICE")
            var libRefresh by remember { mutableIntStateOf(0) }
            val library = remember(libRefresh, brain.id) { rt.store.list() }
            library.forEach { b ->
                Row(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp))
                        .background(if (b.id == brain.id) OmertaAmber.copy(alpha = 0.12f) else OmertaSurface)
                        .clickable { scope.launch { rt.switchTo(b.id); libRefresh++ } }
                        .padding(10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(if (b.id == brain.id) "●" else "○", color = OmertaAmber, modifier = Modifier.padding(end = 8.dp))
                    Column(Modifier.weight(1f)) {
                        Text(b.name, style = MaterialTheme.typography.bodyMedium, color = OmertaTextPrimary)
                        Text("${b.persona.name} · ${b.persona.tone} · ${b.knowledge.size} facts",
                            style = MaterialTheme.typography.labelSmall, color = OmertaTextSecondary)
                    }
                }
            }
            var newName by remember { mutableStateOf("") }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(newName, { newName = it }, label = { Text("New brain name") }, singleLine = true,
                    modifier = Modifier.weight(1f), colors = fieldColors, textStyle = MaterialTheme.typography.bodySmall)
                Button(onClick = {
                    val n = newName.trim().ifBlank { "New Brain" }
                    scope.launch { rt.createBrain(n); newName = ""; libRefresh++; toast("Created $n") }
                }, colors = amberButton()) { Text("CREATE", style = MaterialTheme.typography.labelMedium) }
            }

            // ------------------------------------------------ import / export
            Section("UPLOAD · IMPORT · EXPORT")
            Hint("Import a .brain file (from a PC, a friend, or a backup) to install it — or pick .txt / .md / " +
                ".csv / .html / .zip documents to teach the active brain everything inside them.")
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = { importLauncher.launch(arrayOf("*/*")) }, colors = amberButton(),
                    modifier = Modifier.weight(1f)) { Text("IMPORT / UPLOAD", style = MaterialTheme.typography.labelMedium) }
                OutlinedButton(onClick = { exportLauncher.launch("${brain.id}.brain") }, colors = ghostButton(),
                    modifier = Modifier.weight(1f)) { Text("EXPORT .brain", style = MaterialTheme.typography.labelMedium) }
            }

            // ------------------------------------------------ teach
            Section("TEACH")
            Hint("Or just talk to it in chat: \"remember that…\", \"when I say X, say Y\", \"Q: … | A: …\", " +
                "\"always…\", \"wrong, it's…\", \"forget…\".")
            var teachMode by remember { mutableStateOf("fact") }
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                listOf("fact" to "FACT", "reply" to "TRAINED REPLY", "rule" to "RULE", "doc" to "PASTE TEXT").forEach { (k, l) ->
                    Chip(l, teachMode == k, Modifier.weight(1f)) { teachMode = k }
                }
            }
            var a by remember { mutableStateOf("") }
            var bText by remember { mutableStateOf("") }
            when (teachMode) {
                "fact" -> {
                    OutlinedTextField(a, { a = it }, label = { Text("Topic (optional)") }, singleLine = true,
                        modifier = Modifier.fillMaxWidth(), colors = fieldColors, textStyle = MaterialTheme.typography.bodySmall)
                    OutlinedTextField(bText, { bText = it }, label = { Text("Fact — e.g. My dog is called Rex") },
                        modifier = Modifier.fillMaxWidth(), colors = fieldColors, minLines = 2, textStyle = MaterialTheme.typography.bodySmall)
                }
                "reply" -> {
                    OutlinedTextField(a, { a = it }, label = { Text("When I say… (end with * for prefix)") }, singleLine = true,
                        modifier = Modifier.fillMaxWidth(), colors = fieldColors, textStyle = MaterialTheme.typography.bodySmall)
                    OutlinedTextField(bText, { bText = it }, label = { Text("…you say ({name} {me} {time} {date})") },
                        modifier = Modifier.fillMaxWidth(), colors = fieldColors, minLines = 2, textStyle = MaterialTheme.typography.bodySmall)
                }
                "rule" -> OutlinedTextField(bText, { bText = it }, label = { Text("Rule — e.g. Always answer in one paragraph") },
                    modifier = Modifier.fillMaxWidth(), colors = fieldColors, minLines = 2, textStyle = MaterialTheme.typography.bodySmall)
                else -> {
                    OutlinedTextField(a, { a = it }, label = { Text("Title / source") }, singleLine = true,
                        modifier = Modifier.fillMaxWidth(), colors = fieldColors, textStyle = MaterialTheme.typography.bodySmall)
                    OutlinedTextField(bText, { bText = it }, label = { Text("Paste notes, an article, a manual…") },
                        modifier = Modifier.fillMaxWidth(), colors = fieldColors, minLines = 5, textStyle = MaterialTheme.typography.bodySmall)
                }
            }
            Button(onClick = {
                val x = a.trim(); val y = bText.trim()
                if (y.isEmpty() || (teachMode == "reply" && x.isEmpty())) { toast("fill it in first"); return@Button }
                scope.launch {
                    val msg = rt.edit { e ->
                        when (teachMode) {
                            "fact" -> { e.addFact(y, topic = x); "Learned." }
                            "reply" -> { e.addReflex(x, y); "Trained." }
                            "rule" -> { e.addLesson(y); "Rule added." }
                            else -> "Learned ${e.learnDocument(y, x.ifBlank { "pasted" }, topic = x)} chunk(s)."
                        }
                    }
                    a = ""; bText = ""; toast(msg)
                }
            }, colors = amberButton(), modifier = Modifier.fillMaxWidth()) { Text("TEACH", style = MaterialTheme.typography.labelLarge) }

            // ------------------------------------------------ personality
            PersonalityEditor(vm, fieldColors) { toast(it) }

            // ------------------------------------------------ memory browser
            Section("WHAT IT KNOWS")
            var query by remember { mutableStateOf("") }
            var showAll by remember { mutableStateOf(false) }
            OutlinedTextField(query, { query = it }, label = { Text("Search memory") }, singleLine = true,
                modifier = Modifier.fillMaxWidth(), colors = fieldColors, textStyle = MaterialTheme.typography.bodySmall)
            val q = query.trim().lowercase()
            val kn = brain.knowledge.asReversed().filter { q.isEmpty() || it.text.lowercase().contains(q) || it.topic.lowercase().contains(q) }
            val shown = if (showAll) kn else kn.take(25)
            val visibleProfile = brain.profile.filterKeys { !it.startsWith("_") }
            if (visibleProfile.isNotEmpty()) {
                SubLabel("ABOUT YOU")
                visibleProfile.forEach { (k, v) ->
                    MemRow("${k.replace('_', ' ')}: $v") { scope.launch { rt.edit { it.setProfile(k, null) } } }
                }
            }
            if (brain.lessons.isNotEmpty()) {
                SubLabel("RULES")
                brain.lessons.forEach { l -> MemRow(l.text) { scope.launch { rt.edit { it.removeLesson(l.id) } } } }
            }
            if (brain.reflexes.isNotEmpty()) {
                SubLabel("TRAINED REPLIES")
                brain.reflexes.filter { r -> q.isEmpty() || r.patterns.any { it.lowercase().contains(q) } || r.replies.any { it.lowercase().contains(q) } }
                    .forEach { r -> MemRow("\"${r.patterns.joinToString(" / ")}\" → ${r.replies.joinToString(" | ")}") {
                        scope.launch { rt.edit { it.removeReflex(r.id) } } } }
            }
            SubLabel("FACTS & DOCUMENTS (${kn.size})")
            if (kn.isEmpty()) Hint("Nothing yet.")
            shown.forEach { k ->
                MemRow((if (k.topic.isNotBlank()) "[${k.topic}] " else "") + k.text.take(220) +
                    if (k.source != "taught") "  · ${k.source}" else "") {
                    scope.launch { rt.edit { it.removeKnowledge(k.id) } }
                }
            }
            if (kn.size > shown.size) TextButton(onClick = { showAll = true }) {
                Text("show all ${kn.size}", color = OmertaAmber, style = MaterialTheme.typography.labelMedium)
            }

            // ------------------------------------------------ on-device model
            Section("ON-DEVICE LLM (OPTIONAL)")
            Hint("The brain works with no model at all. For free-form conversation, drop in a MediaPipe " +
                "model file (e.g. Gemma 3 1B IT int4 .task ≈ 550 MB, from Kaggle or huggingface.co/litert-community). " +
                "It runs 100% on the phone and speaks as your brain, grounded in what you taught it.")
            val models = remember(modelsRefresh) { rt.store.models() }
            val activeModel = rt.modelFile(s)?.name
            if (models.isEmpty()) Hint("No model installed — brain-only mode.")
            models.forEach { f ->
                Row(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp))
                        .background(if (f.name == activeModel) OmertaAmber.copy(alpha = 0.12f) else OmertaSurface)
                        .clickable { vm.saveBrainSettings(model = f.name) }.padding(10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(if (f.name == activeModel) "●" else "○", color = OmertaAmber, modifier = Modifier.padding(end = 8.dp))
                    Text("${f.name}  ·  ${f.length() / (1024 * 1024)} MB", style = MaterialTheme.typography.bodySmall,
                        color = OmertaTextPrimary, modifier = Modifier.weight(1f))
                    TextButton(onClick = { rt.deleteModel(f.name); modelsRefresh++ }) {
                        Text("delete", style = MaterialTheme.typography.labelSmall, color = OmertaTextSecondary)
                    }
                }
            }
            modelProgress?.let { p ->
                if (p < 0f) LinearProgressIndicator(Modifier.fillMaxWidth(), color = OmertaAmber)
                else LinearProgressIndicator(progress = { p }, modifier = Modifier.fillMaxWidth(), color = OmertaAmber)
                Hint("copying model into app storage…")
            }
            OutlinedButton(onClick = { modelLauncher.launch(arrayOf("*/*")) }, colors = ghostButton(),
                modifier = Modifier.fillMaxWidth(), enabled = modelProgress == null) {
                Text("ADD MODEL FILE (.task / .bin)", style = MaterialTheme.typography.labelMedium)
            }
            if (status.isNotBlank()) Text(status, style = MaterialTheme.typography.labelSmall,
                color = if (status.startsWith("on-device")) OmertaGreen else OmertaTextSecondary)
            SubLabel("WHEN THE MODEL SPEAKS")
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Chip("OFF", s.brainLlmMode == BrainLlmMode.OFF, Modifier.weight(1f)) { vm.saveBrainSettings(llmMode = BrainLlmMode.OFF) }
                Chip("ASSIST", s.brainLlmMode == BrainLlmMode.ASSIST, Modifier.weight(1f)) { vm.saveBrainSettings(llmMode = BrainLlmMode.ASSIST) }
                Chip("ALWAYS", s.brainLlmMode == BrainLlmMode.ALWAYS, Modifier.weight(1f)) { vm.saveBrainSettings(llmMode = BrainLlmMode.ALWAYS) }
            }
            Hint("ASSIST: brain answers what it knows, model covers the rest. ALWAYS: model voices every reply.")
            SubLabel("PROMPT FORMAT")
            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                PromptFormat.ALL.forEach { f -> Chip(f, s.brainPromptFormat == f, Modifier.weight(1f)) { vm.saveBrainSettings(promptFormat = f) } }
            }
            ToggleLine("GPU acceleration", "faster on most phones; turn off if it crashes", s.brainGpu) {
                vm.saveBrainSettings(gpu = it); rt.llm.unload()
            }
            var temp by remember(s.brainTemperature) { mutableStateOf(s.brainTemperature) }
            Text("Creativity (temperature): ${"%.2f".format(temp)}", style = MaterialTheme.typography.bodySmall, color = OmertaTextPrimary)
            Slider(temp, { temp = it }, valueRange = 0f..1.5f, onValueChangeFinished = { vm.saveBrainSettings(temperature = temp) },
                colors = SliderDefaults.colors(thumbColor = OmertaAmber, activeTrackColor = OmertaAmber))

            // ------------------------------------------------ everywhere
            Section("EVERYWHERE")
            ToggleLine("Offline fallback", "no signal? the brain answers instead of an error", s.offlineFallback) {
                vm.saveBrainSettings(offlineFallback = it)
            }
            ToggleLine("Personality everywhere", "Claude / OpenAI / Ollama speak as this brain and use its knowledge",
                s.personaEverywhere) { vm.saveBrainSettings(personaEverywhere = it) }
            ToggleLine("Learn my style", "the brain mirrors how you talk (tone, length, emoji) over time",
                s.adaptivePersona) { vm.saveBrainSettings(adaptivePersona = it) }

            // ------------------------------------------------ danger
            Section("DANGER ZONE")
            var confirm by remember { mutableStateOf<String?>(null) }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = { confirm = "reset" }, colors = ghostButton(), modifier = Modifier.weight(1f)) {
                    Text("RESET TO DEFAULT", style = MaterialTheme.typography.labelSmall)
                }
                OutlinedButton(onClick = { confirm = "delete" }, colors = ghostButton(), modifier = Modifier.weight(1f)) {
                    Text("DELETE BRAIN", style = MaterialTheme.typography.labelSmall)
                }
            }
            Hint("Export first if you want a backup.")
            confirm?.let { what ->
                AlertDialog(
                    onDismissRequest = { confirm = null }, containerColor = OmertaSurface,
                    title = { Text(if (what == "reset") "Reset ${brain.name}?" else "Delete ${brain.name}?", color = OmertaAmber) },
                    text = { Text("Everything it learned will be gone.", color = OmertaTextPrimary) },
                    confirmButton = { TextButton(onClick = {
                        scope.launch { if (what == "reset") rt.resetActive() else rt.deleteActive(); libRefresh++ }
                        confirm = null
                    }) { Text("YES", color = OmertaAmber) } },
                    dismissButton = { TextButton(onClick = { confirm = null }) { Text("CANCEL", color = OmertaTextSecondary) } },
                )
            }
            Text(" ", modifier = Modifier.padding(bottom = 24.dp))
        }
    }
}

@Composable
private fun PersonalityEditor(
    vm: ChatViewModel,
    fieldColors: androidx.compose.material3.TextFieldColors,
    toast: (String) -> Unit,
) {
    val rt = vm.brain
    val brain by rt.brain.collectAsStateWithLifecycle()
    val p = brain.persona
    val scope = rememberCoroutineScope()
    val key = brain.id + brain.updated
    var name by remember(key) { mutableStateOf(p.name) }
    var tagline by remember(key) { mutableStateOf(p.tagline) }
    var greeting by remember(key) { mutableStateOf(p.greeting) }
    var desc by remember(key) { mutableStateOf(p.description) }
    var traits by remember(key) { mutableStateOf(p.traits.joinToString(", ")) }
    var tone by remember(key) { mutableStateOf(p.tone) }
    var verbosity by remember(key) { mutableStateOf(p.verbosity) }
    var style by remember(key) { mutableStateOf(p.speakingStyle.joinToString("\n")) }
    var catch by remember(key) { mutableStateOf(p.catchphrases.joinToString("\n")) }
    var fallbacks by remember(key) { mutableStateOf(p.fallbacks.joinToString("\n")) }
    var signoff by remember(key) { mutableStateOf(p.signoff) }
    var emoji by remember(key) { mutableStateOf(p.emoji) }
    var flair by remember(key) { mutableStateOf(p.flair.toFloat()) }
    var sys by remember(key) { mutableStateOf(p.systemPrompt) }
    var brainName by remember(key) { mutableStateOf(brain.name) }

    Section("PERSONALITY")
    @Composable
    fun field(v: String, set: (String) -> Unit, label: String, lines: Int = 1) = OutlinedTextField(
        v, set, label = { Text(label) }, singleLine = lines == 1, minLines = lines,
        modifier = Modifier.fillMaxWidth(), colors = fieldColors, textStyle = MaterialTheme.typography.bodySmall,
    )
    field(brainName, { brainName = it }, "Brain file name")
    field(name, { name = it }, "Its name")
    field(tagline, { tagline = it }, "Tagline (\"your offline operator brain\")")
    field(greeting, { greeting = it }, "Greeting", 2)
    field(desc, { desc = it }, "Who it is — character description", 3)
    field(traits, { traits = it }, "Traits (comma separated)")
    SubLabel("TONE")
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        BrainEngine.TONES.chunked(4).forEach { row ->
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                row.forEach { t -> Chip(t, tone == t, Modifier.weight(1f)) { tone = t } }
                repeat(4 - row.size) { Text("", Modifier.weight(1f)) }
            }
        }
    }
    SubLabel("ANSWER LENGTH")
    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        VERBOSITY.forEach { v -> Chip(v, verbosity == v, Modifier.weight(1f)) { verbosity = v } }
    }
    field(style, { style = it }, "Speaking style rules (one per line)", 2)
    field(catch, { catch = it }, "Catchphrases (one per line)", 2)
    field(fallbacks, { fallbacks = it }, "When it doesn't know (one per line)", 2)
    field(signoff, { signoff = it }, "Goodbye line")
    ToggleLine("Emoji", "sprinkle emoji into replies", emoji) { emoji = it }
    Text("Flair (how often catchphrases appear): ${(flair * 100).toInt()}%", style = MaterialTheme.typography.bodySmall,
        color = OmertaTextPrimary)
    Slider(flair, { flair = it }, valueRange = 0f..1f,
        colors = SliderDefaults.colors(thumbColor = OmertaAmber, activeTrackColor = OmertaAmber))
    field(sys, { sys = it }, "Custom LLM system prompt (optional, overrides generated)", 3)
    Button(onClick = {
        fun lines(x: String) = x.split('\n').map { it.trim() }.filter { it.isNotEmpty() }
        scope.launch {
            rt.edit { e ->
                e.rename(brainName.trim().ifBlank { e.brain.name })
                e.updatePersona(p.copy(
                    name = name.trim().ifBlank { p.name }, tagline = tagline.trim(), greeting = greeting.trim(),
                    description = desc.trim(), traits = traits.split(',').map { it.trim() }.filter { it.isNotEmpty() },
                    tone = tone, verbosity = verbosity, speakingStyle = lines(style), catchphrases = lines(catch),
                    fallbacks = lines(fallbacks), signoff = signoff.trim(), emoji = emoji,
                    flair = flair.toDouble(), systemPrompt = sys.trim(),
                ))
            }
            toast("Personality saved")
        }
    }, colors = amberButton(), modifier = Modifier.fillMaxWidth()) { Text("SAVE PERSONALITY", style = MaterialTheme.typography.labelLarge) }
}

@Composable
private fun MemRow(text: String, onDelete: () -> Unit) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(text, style = MaterialTheme.typography.bodySmall, color = OmertaTextPrimary, modifier = Modifier.weight(1f))
        TextButton(onClick = onDelete) { Text("forget", style = MaterialTheme.typography.labelSmall, color = OmertaTextSecondary) }
    }
}

@Composable
private fun Chip(label: String, selected: Boolean, modifier: Modifier = Modifier, onClick: () -> Unit) {
    OutlinedButton(
        onClick = onClick,
        colors = ButtonDefaults.outlinedButtonColors(
            containerColor = if (selected) OmertaAmber else OmertaSurface,
            contentColor = if (selected) OmertaBlack else OmertaTextSecondary,
        ),
        modifier = modifier,
        contentPadding = PaddingValues(horizontal = 4.dp, vertical = 2.dp),
    ) { Text(label, style = MaterialTheme.typography.labelSmall, maxLines = 1) }
}

@Composable
private fun ToggleLine(title: String, subtitle: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.bodyMedium, color = OmertaTextPrimary)
            Text(subtitle, style = MaterialTheme.typography.labelSmall, color = OmertaTextSecondary)
        }
        Switch(checked = checked, onCheckedChange = onChange,
            colors = SwitchDefaults.colors(
                checkedThumbColor = OmertaBlack, checkedTrackColor = OmertaAmber,
                uncheckedThumbColor = OmertaTextSecondary, uncheckedTrackColor = OmertaSurface))
    }
}

@Composable
private fun amberButton() = ButtonDefaults.buttonColors(containerColor = OmertaAmber, contentColor = OmertaBlack)

@Composable
private fun ghostButton() = ButtonDefaults.outlinedButtonColors(containerColor = OmertaSurface, contentColor = OmertaAmber)

@Composable
private fun Hint(text: String) = Text(text, style = MaterialTheme.typography.labelSmall, color = OmertaTextSecondary)

@Composable
private fun SubLabel(text: String) = Text(text, style = MaterialTheme.typography.labelSmall, color = OmertaAmber,
    modifier = Modifier.padding(top = 4.dp))

@Composable
private fun Section(text: String) = Text(text, style = MaterialTheme.typography.labelMedium, color = OmertaAmber,
    modifier = Modifier.padding(top = 8.dp))
