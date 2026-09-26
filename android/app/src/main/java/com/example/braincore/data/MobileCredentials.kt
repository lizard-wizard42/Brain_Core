package com.example.braincore.data

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** The scoped device credential never enters the APK, Git, or Android backup. */
object MobileCredentials {
    private const val ALIAS = "brain_core_mobile_device_v1"
    private const val PREFS = "brain_core_mobile_credential"
    private const val OWNER_PREFS = "brain_core_recording_owner"
    private const val TOKEN = "token_ciphertext"
    private const val DEVICE_ID = "device_id"
    private const val USER_ID = "user_id"

    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val existing = store.getKey(ALIAS, null) as? SecretKey
        if (existing != null) return existing
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build())
        }.generateKey()
    }

    fun save(context: Context, deviceId: String, token: String, userId: String) {
        require(userId.isNotBlank())
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key())
        val encrypted = cipher.doFinal(token.toByteArray(Charsets.UTF_8))
        val value = Base64.encodeToString(cipher.iv + encrypted, Base64.NO_WRAP)
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString(TOKEN, value).putString(DEVICE_ID, deviceId).putString(USER_ID, userId).apply()
        // Keep the recording owner after unlinking so offline capture remains attached
        // to the previous account instead of being silently claimed by the next one.
        context.getSharedPreferences(OWNER_PREFS, Context.MODE_PRIVATE).edit()
            .putString(USER_ID, userId).apply()
    }

    fun get(context: Context): String? {
        val value = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString(TOKEN, null) ?: return null
        return try {
            val payload = Base64.decode(value, Base64.NO_WRAP)
            if (payload.size < 29) return null
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, payload.copyOfRange(0, 12)))
            String(cipher.doFinal(payload.copyOfRange(12, payload.size)), Charsets.UTF_8)
        } catch (_: Exception) { null }
    }

    fun deviceId(context: Context): String? =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(DEVICE_ID, null)

    fun userId(context: Context): String? =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(USER_ID, null)

    fun recordingOwnerUserId(context: Context): String? = userId(context)
        ?: context.getSharedPreferences(OWNER_PREFS, Context.MODE_PRIVATE).getString(USER_ID, null)

    fun bindExistingUserId(context: Context, expectedToken: String, userId: String): Boolean {
        if (userId.isBlank() || get(context) != expectedToken) return false
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(USER_ID, userId).apply()
        context.getSharedPreferences(OWNER_PREFS, Context.MODE_PRIVATE).edit().putString(USER_ID, userId).apply()
        return true
    }

    fun clear(context: Context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().apply()
    }
}
