package com.example.braincore
import com.example.braincore.data.model.SpeakerDisplay as S
import org.junit.Assert.*
import org.junit.Test
class SpeakerDisplayTest {
    @Test fun probableOwnerSurvivesUnknownLegacySpeaker() {
        val value = S.fromServer("unknown", "speaker_3", true, null, false)
        assertEquals("Eu (provável)", S.name(value)); assertTrue(S.isOwner(value))
    }
    @Test fun manualCorrectionWinsOverProbableOwner() {
        val value = S.withDecision("me_probable", "correct", "Alex", false)
        assertEquals("Alex", S.name(value)); assertFalse(S.isOwner(value))
        assertEquals("Eu", S.name(S.withDecision("unknown", "confirm", "Minha voz", true)))
    }
    @Test fun groupLabelWinsAndUnknownRemainsUnknown() {
        assertEquals("named:Alex", S.fromServer("unknown", "speaker_1", true, "Alex", false))
        assertEquals("Pessoa 2", S.name(S.fromServer(null, "speaker_1", false, null, false)))
        assertEquals("unknown", S.fromServer("null", "null", false, null, false))
    }
    @Test fun undoAndIgnoreDoNotBecomeConfirmations() {
        assertEquals("me_probable", S.withDecision("me_probable", "undo", null, false))
        assertEquals("unknown", S.withDecision("me_probable", "ignore", null, false))
    }
}
