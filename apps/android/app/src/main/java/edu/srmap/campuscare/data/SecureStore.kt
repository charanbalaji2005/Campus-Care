package edu.srmap.campuscare.data

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Small encrypted key-value store. Values are encrypted with AES-256-GCM using a key that lives in
 * the Android Keystore (non-exportable), then saved in private SharedPreferences. Used for the
 * session token and cached profile; excluded from backups (see data_extraction_rules.xml).
 */
interface KeyValueStore {
    fun put(name: String, value: String?)
    fun get(name: String): String?
    fun clear()
}

class SecureStore(context: Context) : KeyValueStore {
    private val prefs = context.getSharedPreferences("cc_secure", Context.MODE_PRIVATE)

    private fun key(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getEntry(ALIAS, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        gen.init(
            KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return gen.generateKey()
    }

    override fun put(name: String, value: String?) {
        if (value == null) {
            prefs.edit().remove(name).apply()
            return
        }
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, key())
        val encrypted = cipher.doFinal(value.toByteArray(Charsets.UTF_8))
        val packed = cipher.iv + encrypted
        prefs.edit().putString(name, Base64.encodeToString(packed, Base64.NO_WRAP)).apply()
    }

    override fun get(name: String): String? {
        val stored = prefs.getString(name, null) ?: return null
        return runCatching {
            val packed = Base64.decode(stored, Base64.NO_WRAP)
            val iv = packed.copyOfRange(0, 12)
            val body = packed.copyOfRange(12, packed.size)
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, iv))
            String(cipher.doFinal(body), Charsets.UTF_8)
        }.getOrElse {
            // Key invalidated (e.g. device restored) — forget the value rather than crash.
            prefs.edit().remove(name).apply()
            null
        }
    }

    override fun clear() = prefs.edit().clear().apply()

    private companion object {
        const val ALIAS = "campuscare_session_key"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
    }
}
