package ai.omerta.assistant.data.local

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * At-rest encryption for secrets (API keys, tokens) using a hardware-backed key in the
 * Android Keystore (AES-256-GCM). The key never leaves the secure element; only
 * `enc:v1:<base64(iv|ciphertext)>` is persisted. Secrets are decrypted only in memory
 * when a request is made.
 *
 * Degrades safely: if the Keystore is unavailable (e.g. Robolectric, a broken vendor
 * implementation), values are stored as-is so the app still works — encryption is a
 * hardening layer, never a crash risk. Legacy plaintext values are read transparently and
 * re-encrypted the next time they are saved.
 */
object KeyVault {
    private const val ANDROID_KEYSTORE = "AndroidKeyStore"
    private const val ALIAS = "omerta_secret_key"
    private const val PREFIX = "enc:v1:"
    private const val IV_LEN = 12
    private const val TAG_BITS = 128

    private fun key(): SecretKey? = runCatching {
        val ks = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
        (ks.getEntry(ALIAS, null) as? KeyStore.SecretKeyEntry)?.secretKey ?: run {
            val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE)
            gen.init(
                KeyGenParameterSpec.Builder(
                    ALIAS,
                    KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
                )
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setKeySize(256)
                    .build(),
            )
            gen.generateKey()
        }
    }.getOrNull()

    /** Encrypts a secret for storage. Returns the value unchanged if the Keystore is unusable. */
    fun encrypt(plain: String): String {
        if (plain.isEmpty() || plain.startsWith(PREFIX)) return plain
        val k = key() ?: return plain
        return runCatching {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, k) }
            val iv = cipher.iv
            val ct = cipher.doFinal(plain.toByteArray(Charsets.UTF_8))
            PREFIX + Base64.encodeToString(iv + ct, Base64.NO_WRAP)
        }.getOrDefault(plain)
    }

    /** Decrypts a stored secret. Plaintext (legacy) values pass through unchanged. */
    fun decrypt(stored: String): String {
        if (!stored.startsWith(PREFIX)) return stored
        val k = key() ?: return ""
        return runCatching {
            val blob = Base64.decode(stored.removePrefix(PREFIX), Base64.NO_WRAP)
            val iv = blob.copyOfRange(0, IV_LEN)
            val ct = blob.copyOfRange(IV_LEN, blob.size)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
                .apply { init(Cipher.DECRYPT_MODE, k, GCMParameterSpec(TAG_BITS, iv)) }
            String(cipher.doFinal(ct), Charsets.UTF_8)
        }.getOrDefault("")
    }

    fun isEncrypted(value: String): Boolean = value.startsWith(PREFIX)
}
