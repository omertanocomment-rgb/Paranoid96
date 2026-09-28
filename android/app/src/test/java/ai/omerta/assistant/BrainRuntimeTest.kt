package ai.omerta.assistant

import android.app.Application
import android.net.Uri
import androidx.test.core.app.ApplicationProvider
import ai.omerta.assistant.data.brain.BrainEngine
import ai.omerta.assistant.data.brain.BrainRuntime
import ai.omerta.assistant.data.local.BrainLlmMode
import ai.omerta.assistant.data.local.OmertaSettings
import ai.omerta.assistant.data.local.Provider
import ai.omerta.assistant.data.model.WireMessage
import ai.omerta.assistant.data.remote.StreamEvent
import ai.omerta.assistant.data.repository.ChatRepository
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File

/** Exercises the Android side of the brain: assets, storage, import/export, inbox, chat routing. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
class BrainRuntimeTest {

    private val ctx: Application = ApplicationProvider.getApplicationContext()

    @Before fun fresh() = BrainRuntime.resetForTests()

    private fun settings(provider: String = Provider.BRAIN) = OmertaSettings(
        engineMode = "embedded", anthropicApiKey = "", backendUrl = "http://127.0.0.1:9", appToken = "",
        model = "claude-opus-5", systemPrompt = "", effort = "high", streaming = true, maxTokens = 1024,
        webSearch = false, codeExecution = false, mcpName = "", mcpUrl = "", agentMode = false,
        autoApprove = false, provider = provider, openAiKey = "", ollamaUrl = "http://127.0.0.1:9",
        brainLlmMode = BrainLlmMode.ASSIST,
    )

    private fun text(events: List<StreamEvent>) =
        events.filterIsInstance<StreamEvent.Delta>().joinToString("") { it.text }

    @Test fun fullOfflineLifecycle() = runBlocking {
        val rt = BrainRuntime.get(ctx)
        // Seeded from assets on first run.
        assertEquals("omerta", rt.brain.value.id)
        assertTrue(rt.brain.value.knowledge.size > 20)

        val repo = ChatRepository(rt)
        assertTrue(repo.health(settings()).isSuccess)

        // Teach + recall through the same path the chat screen uses.
        text(repo.stream(settings(), listOf(WireMessage("user", "remember that my locker code is 4471"))).toList())
        val recall = text(repo.stream(settings(), listOf(WireMessage("user", "what is my locker code?"))).toList())
        assertTrue(recall, recall.contains("4471"))

        // Persisted to disk.
        val onDisk = File(ctx.filesDir, "brains/omerta.brain").readText()
        assertTrue(onDisk.contains("4471"))

        // Export → import as a new brain (keepBoth) → switch.
        val out = File(ctx.cacheDir, "export.brain")
        rt.export(Uri.fromFile(out))
        assertTrue(out.readText().contains("omerta-brain/1"))

        val luna = BrainEngine.blank("luna", "Luna").copy(persona = BrainEngine.blank("luna", "Luna").persona.copy(tone = "playful"))
        val lunaFile = File(ctx.cacheDir, "luna.brain").apply { writeText(luna.encode()) }
        val r = rt.import(Uri.fromFile(lunaFile))
        assertEquals(1, r.brains)
        assertEquals("luna", rt.brain.value.id)

        // Documents teach the active brain.
        val doc = File(ctx.cacheDir, "notes.md").apply { writeText("The spare key is under the blue flowerpot.\n\nBins go out on Thursday.") }
        val d = rt.import(Uri.fromFile(doc))
        assertEquals(1, d.documents)
        val a = text(repo.stream(settings(), listOf(WireMessage("user", "where is the spare key"))).toList())
        assertTrue(a, a.contains("flowerpot"))

        // Inbox auto-import (adb push path).
        val inbox = ctx.getExternalFilesDir("inbox")!!.apply { mkdirs() }
        File(inbox, "sensei.brain").writeText(BrainEngine.blank("sensei", "Sensei").encode())
        val notes = rt.scanInbox()
        assertTrue(notes.toString(), notes.single().contains("Sensei"))
        assertEquals("sensei", rt.brain.value.id)
        assertTrue(File(inbox, "imported/sensei.brain").exists())

        assertEquals(setOf("omerta", "luna", "sensei"), rt.store.list().map { it.id }.toSet())
        rt.switchTo("omerta")
    }

    @Test fun onlineFailureFallsBackToBrain() = runBlocking {
        val rt = BrainRuntime.get(ctx)
        rt.switchTo(rt.store.loadActive().id)
        val repo = ChatRepository(rt)
        // Ollama at a dead port → the brain answers instead of an error.
        val ev = repo.stream(settings(Provider.OLLAMA), listOf(WireMessage("user", "who are you?"))).toList()
        val t = text(ev)
        assertTrue(t, t.contains("brain answering"))
        assertTrue(ev.last() is StreamEvent.Done)
        assertTrue(ev.none { it is StreamEvent.Failure })
    }
}
