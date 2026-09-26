package com.example.braincore

import com.example.braincore.ui.desktop.mayCaptureWebAudio
import com.example.braincore.ui.desktop.sameWebOrigin
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class WebOriginPolicyTest {
    private val trusted = "https://example-pc.ts.net/"

    @Test fun comparesCompleteOrigin() {
        assertTrue(sameWebOrigin(trusted, "$trusted/settings"))
        assertFalse(sameWebOrigin(trusted, "https://example-pc.ts.net.evil.test/"))
        assertFalse(sameWebOrigin(trusted, "https://example-pc.ts.net:8443/"))
        assertFalse(sameWebOrigin(trusted, "http://example-pc.ts.net/"))
    }

    @Test fun grantsAudioOnlyForTrustedSecureOriginWithAndroidPermission() {
        assertTrue(mayCaptureWebAudio(trusted, "https://example-pc.ts.net", true))
        assertFalse(mayCaptureWebAudio(trusted, "https://other.example", true))
        assertFalse(mayCaptureWebAudio(trusted, "https://example-pc.ts.net", false))
        assertFalse(mayCaptureWebAudio("http://lan.example", "http://lan.example", true))
    }
}
