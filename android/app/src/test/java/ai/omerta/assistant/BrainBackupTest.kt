package ai.omerta.assistant

import android.app.Application
import android.net.Uri
import androidx.test.core.app.ApplicationProvider
import ai.omerta.assistant.data.brain.BrainEngine
import ai.omerta.assistant.data.brain.BrainStore
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
class BrainBackupTest {
    private val ctx: Application = ApplicationProvider.getApplicationContext()

    @Test fun backupAllThenRestoreRoundTrips() {
        val store = BrainStore(ctx)
        store.save(BrainEngine.blank("alpha", "Alpha"))
        store.save(BrainEngine.blank("beta", "Beta"))
        val before = store.list().map { it.id }.toSet()
        val zip = File(ctx.cacheDir, "backup.zip")
        val n = store.backupAll(Uri.fromFile(zip))
        assertTrue(n >= 2)

        // Wipe and restore.
        store.list().forEach { store.delete(it.id) }
        assertTrue(store.list().isEmpty())
        val restored = store.restoreAll(Uri.fromFile(zip))
        assertEquals(n, restored)
        assertTrue(store.list().map { it.id }.toSet().containsAll(before))
    }

    @Test fun corruptBrainRecoversFromBak() {
        val store = BrainStore(ctx)
        val b = BrainEngine.blank("x", "X")
        store.save(b)                       // first save (no .bak yet)
        store.save(b.copy(version = 2))     // now .bak holds v1, primary v2
        val primary = File(ctx.filesDir, "brains/x.brain")
        primary.writeText("{ corrupt ]")
        val loaded = store.load("x")
        assertTrue(loaded != null && loaded.format == "omerta-brain/1")
    }
}
