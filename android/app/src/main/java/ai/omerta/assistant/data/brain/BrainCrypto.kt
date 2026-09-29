package ai.omerta.assistant.data.brain

import android.util.Base64
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.PBEKeySpec
import javax.crypto.spec.SecretKeySpec

/**
 * Password-based encryption for portable `.brain.enc` exports (AES-256-GCM, PBKDF2-HMAC-
 * SHA256). Unlike [ai.omerta.assistant.data.local.KeyVault] (device-bound), this uses a
 * password you choose, so an encrypted backup can be stored in the cloud and opened on any
 * device with the password. Self-describing text format:
 *
 *   omerta-enc/1
 *   <base64 salt>
 *   <base64 iv>
 *   <base64 ciphertext+tag>
 */
object BrainCrypto {
    private const val MAGIC = "omerta-enc/1"
    private const val ITER = 120_000
    private const val KEY_BITS = 256
    private const val TAG_BITS = 128

    fun isEncrypted(text: String): Boolean = text.trimStart().startsWith(MAGIC)

    private fun deriveKey(password: CharArray, salt: ByteArray): SecretKeySpec {
        val spec = PBEKeySpec(password, salt, ITER, KEY_BITS)
        val bytes = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).encoded
        return SecretKeySpec(bytes, "AES")
    }

    fun encrypt(plain: String, password: String): String {
        val rnd = SecureRandom()
        val salt = ByteArray(16).also { rnd.nextBytes(it) }
        val iv = ByteArray(12).also { rnd.nextBytes(it) }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            .apply { init(Cipher.ENCRYPT_MODE, deriveKey(password.toCharArray(), salt), GCMParameterSpec(TAG_BITS, iv)) }
        val ct = cipher.doFinal(plain.toByteArray(Charsets.UTF_8))
        fun b64(b: ByteArray) = Base64.encodeToString(b, Base64.NO_WRAP)
        return "$MAGIC\n${b64(salt)}\n${b64(iv)}\n${b64(ct)}\n"
    }

    /** Throws on a wrong password or tampered file (GCM tag check fails). */
    fun decrypt(blob: String, password: String): String {
        val lines = blob.trim().lines()
        require(lines.size >= 4 && lines[0].trim() == MAGIC) { "not an Omerta encrypted brain" }
        fun d(s: String) = Base64.decode(s.trim(), Base64.NO_WRAP)
        val salt = d(lines[1]); val iv = d(lines[2]); val ct = d(lines[3])
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            .apply { init(Cipher.DECRYPT_MODE, deriveKey(password.toCharArray(), salt), GCMParameterSpec(TAG_BITS, iv)) }
        return String(cipher.doFinal(ct), Charsets.UTF_8)
    }
}
