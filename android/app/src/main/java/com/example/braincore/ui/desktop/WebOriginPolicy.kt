package com.example.braincore.ui.desktop

import java.net.URI

/** Compare the complete web origin. A matching hostname on another port is a different site. */
internal fun sameWebOrigin(configured: String, candidate: String): Boolean = try {
    val expected = URI(configured)
    val actual = URI(candidate)
    fun port(uri: URI): Int = when {
        uri.port >= 0 -> uri.port
        uri.scheme.equals("https", ignoreCase = true) -> 443
        uri.scheme.equals("http", ignoreCase = true) -> 80
        else -> -1
    }
    expected.scheme.equals(actual.scheme, ignoreCase = true) &&
        expected.host != null && expected.host.equals(actual.host, ignoreCase = true) &&
        port(expected) == port(actual) &&
        actual.userInfo == null
} catch (_: Exception) { false }

internal fun mayCaptureWebAudio(configured: String, requestOrigin: String, androidPermissionGranted: Boolean): Boolean =
    androidPermissionGranted && sameWebOrigin(configured, requestOrigin) &&
        URI(requestOrigin).scheme.equals("https", ignoreCase = true)
