package com.example.braincore

import com.example.braincore.data.ServerSettings
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ServerSettingsTest {
    @Test fun acceptsUserConfiguredHttpsOrigin() {
        assertEquals(
            "https://brain.example.org",
            ServerSettings.normalize("https://BRAIN.example.org/")
        )
        assertEquals(
            "https://brain.example.org",
            ServerSettings.normalize("https://brain.example.org:443")
        )
    }

    @Test fun rejectsLookalikeHostsAndUnsafeUrls() {
        listOf(
            "http://brain.example.org",
            "https://brain.example.org@evil.example",
            "https://brain.example.org:8443",
            "https://brain.example.org/admin",
            "https://brain.example.org?next=evil",
            "https://-brain.example.org",
            "file:///etc/passwd"
        ).forEach { assertNull(it, ServerSettings.normalize(it)) }
    }
}
