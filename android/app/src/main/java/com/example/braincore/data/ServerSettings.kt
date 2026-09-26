package com.example.braincore.data

import android.content.Context
import java.net.URI

/** Stores the user-configured HTTPS origin. Authentication remains in HttpOnly web cookies. */
object ServerSettings {
    private const val PREFS = "brain_core_server"
    private const val KEY_ORIGIN = "tailnet_origin"
    private val hostPattern = Regex("^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$")

    fun get(context: Context): String =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_ORIGIN, "").orEmpty()

    fun normalize(input: String): String? {
        val uri = try { URI(input.trim()) } catch (_: Exception) { return null }
        val host = uri.host?.lowercase() ?: return null
        if (!uri.scheme.equals("https", ignoreCase = true) || !hostPattern.matches(host)) return null
        if (uri.port != -1 && uri.port != 443) return null
        if (uri.userInfo != null || uri.rawQuery != null || uri.rawFragment != null) return null
        if (uri.rawPath != null && uri.rawPath != "" && uri.rawPath != "/") return null
        return "https://$host"
    }

    fun save(context: Context, input: String): String? {
        val origin = normalize(input) ?: return null
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit().putString(KEY_ORIGIN, origin).apply()
        return origin
    }
}
