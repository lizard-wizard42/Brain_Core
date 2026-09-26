package com.example.braincore

import android.content.Context
import android.content.ContextWrapper
import android.database.sqlite.SQLiteDatabase
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.example.braincore.data.BrainCoreDatabase
import com.example.braincore.data.model.Session
import com.example.braincore.data.model.Turn
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class ParticipantDatabaseTest {
    private fun isolatedDatabase(): Pair<BrainCoreDatabase, File> {
        val base = InstrumentationRegistry.getInstrumentation().targetContext
        val file = File(base.cacheDir, "participant-${UUID.randomUUID()}.db")
        val context = object : ContextWrapper(base) {
            override fun getDatabasePath(name: String): File = file
        }
        return BrainCoreDatabase(context) to file
    }

    @Test fun migrationPreservesLegacySpeech() {
        val (helper, file) = isolatedDatabase()
        val legacy = File(file.parentFile, "legacy-${UUID.randomUUID()}.db")
        val sqlite = SQLiteDatabase.openOrCreateDatabase(legacy, null)
        try {
            sqlite.execSQL("CREATE TABLE turns (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, speaker TEXT NOT NULL, text TEXT NOT NULL, timestamp INTEGER NOT NULL)")
            sqlite.execSQL("INSERT INTO turns VALUES ('turn-1', 'session-1', 'other', 'fala antiga', 123)")
            helper.onUpgrade(sqlite, 5, 6)
            sqlite.rawQuery("SELECT text, remote_segment_id FROM turns WHERE id = 'turn-1'", null).use {
                assertTrue(it.moveToFirst())
                assertEquals("fala antiga", it.getString(0))
                assertTrue(it.isNull(1))
            }
            sqlite.rawQuery("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_turns_remote_segment'", null).use {
                assertTrue(it.moveToFirst())
            }
        } finally {
            sqlite.close()
            helper.close()
            legacy.delete()
            file.delete()
        }
    }

    @Test fun remoteReconciliationRemovesStaleTurnsAndPreservesCache() {
        val (db, file) = isolatedDatabase()
        val sessionId = UUID.randomUUID().toString()
        try {
            db.insertSession(Session(id = sessionId, ownerUserId = "owner-a"))
            db.insertTurn(Turn(id = "legacy", sessionId = sessionId, speaker = "other", text = "fala", timestamp = 123))
            db.insertTurn(Turn(id = "stale", sessionId = sessionId, speaker = "other", text = "obsoleta", timestamp = 124))
            val remote = Turn(sessionId = sessionId, speaker = "other", text = "fala", timestamp = 123, remoteSegmentId = 42)
            db.updateTranscript(sessionId, "ready", "fala", listOf(remote))
            assertEquals(1, db.getTurnsForSession(sessionId).size)
            assertEquals("legacy", db.getTurnsForSession(sessionId).first().id)
            db.saveParticipantData(sessionId, 42, "owner-a", JSONObject().put("suggestions", "cache"))
            db.saveParticipantData(sessionId, 42, "owner-b", JSONObject().put("suggestions", "foreign"))
            assertTrue(db.getTurnsForSession(sessionId).first().participantData!!.contains("cache"))
            db.insertTurn(Turn(id = "legacy", sessionId = sessionId, speaker = "other", text = "fala revisada", timestamp = 123, remoteSegmentId = 42))
            assertNotNull(db.getTurnsForSession(sessionId).first().participantData)
            db.updateTranscript(sessionId, "ready", "nova", listOf(remote.copy(text = "nova")))
            assertEquals(1, db.getTurnsForSession(sessionId).size)
            assertEquals("legacy", db.getTurnsForSession(sessionId).first().id)
        } finally {
            db.close()
            file.delete()
        }
    }
}
