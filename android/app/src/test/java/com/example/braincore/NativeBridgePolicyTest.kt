package com.example.braincore

import com.example.braincore.ui.desktop.BrainCoreNativeBridge
import com.example.braincore.ui.desktop.sameWebOrigin
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class NativeBridgePolicyTest {
    private val configuredOrigin = "https://example-pc.ts.net"

    @Test
    fun bridgeJsObjectNameIsConsistent() {
        assertEquals("brainCoreNativeBridge", BrainCoreNativeBridge.JS_OBJECT_NAME)
    }

    @Test
    fun rejectsMismatchedOrUntrustedOrigins() {
        assertTrue(sameWebOrigin(configuredOrigin, "https://example-pc.ts.net"))
        assertFalse(sameWebOrigin(configuredOrigin, "https://attacker.ts.net"))
        assertFalse(sameWebOrigin(configuredOrigin, "http://example-pc.ts.net"))
        assertFalse(sameWebOrigin(configuredOrigin, "https://example-pc.ts.net:8080"))
    }
}
