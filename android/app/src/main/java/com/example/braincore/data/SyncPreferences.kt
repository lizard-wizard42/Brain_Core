package com.example.braincore.data

import android.content.Context

/** Non-secret policy. Device tokens remain in MobileCredentials/Android Keystore. */
object SyncPreferences {
    private const val STORE = "brain_core_sync_policy"
    private const val AUTO_UPLOAD = "auto_upload"
    private const val AUTO_TRANSCRIBE = "auto_transcribe"
    private const val UNMETERED_ONLY = "unmetered_only"

    fun autoUpload(context: Context): Boolean =
        context.getSharedPreferences(STORE, Context.MODE_PRIVATE).getBoolean(AUTO_UPLOAD, true)

    fun autoTranscribe(context: Context): Boolean =
        context.getSharedPreferences(STORE, Context.MODE_PRIVATE).getBoolean(AUTO_TRANSCRIBE, true)

    fun unmeteredOnly(context: Context): Boolean =
        context.getSharedPreferences(STORE, Context.MODE_PRIVATE).getBoolean(UNMETERED_ONLY, false)

    fun setAutoUpload(context: Context, enabled: Boolean) {
        context.getSharedPreferences(STORE, Context.MODE_PRIVATE).edit().putBoolean(AUTO_UPLOAD, enabled).apply()
    }

    fun setAutoTranscribe(context: Context, enabled: Boolean) {
        context.getSharedPreferences(STORE, Context.MODE_PRIVATE).edit().putBoolean(AUTO_TRANSCRIBE, enabled).apply()
    }

    fun setUnmeteredOnly(context: Context, enabled: Boolean) {
        context.getSharedPreferences(STORE, Context.MODE_PRIVATE).edit().putBoolean(UNMETERED_ONLY, enabled).apply()
    }
}
