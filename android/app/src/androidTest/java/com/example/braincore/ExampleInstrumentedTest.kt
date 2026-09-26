package com.example.braincore

import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.example.braincore.data.BrainCoreDatabase

import org.junit.Test
import org.junit.runner.RunWith

import org.junit.Assert.*

@RunWith(AndroidJUnit4::class)
class DatabaseMigrationTest {
    @Test
    fun existingDatabaseOpensWithSyncColumns() {
        val appContext = InstrumentationRegistry.getInstrumentation().targetContext
        assertTrue(appContext.packageName.startsWith("com.example.braincore"))
        val database = BrainCoreDatabase.getInstance(appContext).readableDatabase
        assertEquals(3, database.version)
        database.rawQuery("PRAGMA table_info(recording_chunks)", null).use { cursor ->
            val names = mutableSetOf<String>()
            while (cursor.moveToNext()) names.add(cursor.getString(1))
            assertTrue(names.contains("sync_state"))
        }
        database.rawQuery("PRAGMA table_info(sessions)", null).use { cursor ->
            val names = mutableSetOf<String>()
            while (cursor.moveToNext()) names.add(cursor.getString(1))
            assertTrue(names.contains("completion_sent"))
            assertTrue(names.contains("transcript_state"))
        }
    }
}
