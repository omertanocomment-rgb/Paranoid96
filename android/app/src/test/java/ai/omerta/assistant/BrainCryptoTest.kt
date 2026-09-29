package ai.omerta.assistant

import ai.omerta.assistant.data.brain.BrainCrypto
import ai.omerta.assistant.data.brain.BrainEngine
import ai.omerta.assistant.data.brain.TextKit
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class BrainCryptoTest {
    @Test fun encryptedRoundTripsWithPassword() {
        val brain = BrainEngine.blank("x", "X")
        val plain = brain.encode()
        val blob = BrainCrypto.encrypt(plain, "hunter2")
        assertTrue(BrainCrypto.isEncrypted(blob))
        assertTrue(!blob.contains("omerta-brain/1") || blob.startsWith("omerta-enc/1"))
        assertEquals(plain, BrainCrypto.decrypt(blob, "hunter2"))
    }

    @Test fun wrongPasswordFails() {
        val blob = BrainCrypto.encrypt("secret data", "correct")
        var threw = false
        try { BrainCrypto.decrypt(blob, "wrong") } catch (e: Exception) { threw = true }
        assertTrue("wrong password must fail", threw)
    }

    @Test fun differentPasswordsDifferentCiphertext() {
        assertNotEquals(BrainCrypto.encrypt("x", "a"), BrainCrypto.encrypt("x", "b"))
    }

    @Test fun fuzzySimilarityCatchesParaphrase() {
        val a = TextKit.fuzzySimilarity("router admin password", "the router admin password is bluefish42")
        val b = TextKit.fuzzySimilarity("router admin password", "the cat sat on the mat")
        assertTrue("related > unrelated ($a vs $b)", a > b && a > 0.28)
    }
}
