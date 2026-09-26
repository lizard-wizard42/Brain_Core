package com.example.braincore.data

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import android.media.MediaMetadataRetriever
import com.example.braincore.data.model.Note
import com.example.braincore.data.model.RecordingChunk
import com.example.braincore.data.model.Session
import com.example.braincore.data.model.Turn
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest
import java.util.UUID

data class LocalSyncStats(
    val sessions: Int,
    val notes: Int,
    val chunks: Int,
    val pendingChunks: Int,
    val conflictChunks: Int,
    val audioBytes: Long
)

data class AudioCleanupCandidate(
    val sessionId: String,
    val chunkNum: Int,
    val path: String,
    val sizeBytes: Long
)

class BrainCoreDatabase(context: Context) : SQLiteOpenHelper(context, DATABASE_NAME, null, DATABASE_VERSION) {
    private val appContext = context.applicationContext

    private val _sessionsFlow = MutableStateFlow<List<Session>>(emptyList())
    val sessionsFlow: StateFlow<List<Session>> = _sessionsFlow.asStateFlow()

    private val _notesFlow = MutableStateFlow<List<Note>>(emptyList())
    val notesFlow: StateFlow<List<Note>> = _notesFlow.asStateFlow()

    init {
        recoverInterruptedSessions()
        refreshAll()
    }

    private fun recoverInterruptedSessions() {
        // A new process cannot resume MediaRecorder, but a chunk may have been
        // finalized before the process died and before its database update.
        val db = writableDatabase
        val now = System.currentTimeMillis()
        db.beginTransaction()
        try {
            val interruptedChunks = mutableListOf<Triple<String, Int, String>>()
            db.rawQuery(
                "SELECT session_id, chunk_num, path FROM recording_chunks WHERE status = ?",
                arrayOf("recording")
            ).use { cursor ->
                while (cursor.moveToNext()) {
                    interruptedChunks.add(Triple(cursor.getString(0), cursor.getInt(1), cursor.getString(2)))
                }
            }
            for ((sessionId, chunkNum, path) in interruptedChunks) {
                val file = File(path)
                val hash = if (isPlayableAudio(file)) {
                    try { sha256(file) } catch (_: Exception) { "" }
                } else ""
                val valid = hash.isNotEmpty()
                val values = ContentValues().apply {
                    put("status", if (valid) "recorded" else "error")
                    put("ended_at", if (valid) file.lastModified().coerceAtLeast(1L) else now)
                    put("size_bytes", if (valid) file.length() else 0L)
                    put("sha256", hash)
                }
                db.update(
                    "recording_chunks", values, "session_id = ? AND chunk_num = ?",
                    arrayOf(sessionId, chunkNum.toString())
                )
            }
            val interruptedSessions = mutableListOf<Pair<String, Long>>()
            db.rawQuery(
                "SELECT id, started_at FROM sessions WHERE status = ?",
                arrayOf("recording")
            ).use { cursor ->
                while (cursor.moveToNext()) {
                    interruptedSessions.add(cursor.getString(0) to cursor.getLong(1))
                }
            }
            for ((id, startedAt) in interruptedSessions) {
                val savedCount = db.rawQuery(
                    "SELECT COUNT(*) FROM recording_chunks WHERE session_id = ? AND status = ?",
                    arrayOf(id, "recorded")
                ).use { countCursor -> countCursor.moveToFirst(); countCursor.getInt(0) }
                val lastAudioAt = db.rawQuery(
                    "SELECT MAX(ended_at) FROM recording_chunks WHERE session_id = ? AND status = ?",
                    arrayOf(id, "recorded")
                ).use { endCursor ->
                    endCursor.moveToFirst()
                    if (endCursor.isNull(0)) null else endCursor.getLong(0)
                }
                val endedAt = lastAudioAt ?: now
                val values = ContentValues().apply {
                    put("status", if (savedCount > 0) "partial" else "error")
                    put("ended_at", endedAt)
                    put("duration_seconds", ((endedAt - startedAt) / 1000).coerceAtLeast(0L).toInt())
                }
                db.update("sessions", values, "id = ?", arrayOf(id))
            }
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
    }

    private fun isPlayableAudio(file: File): Boolean {
        if (!file.isFile || file.length() == 0L) return false
        val retriever = MediaMetadataRetriever()
        return try {
            retriever.setDataSource(file.absolutePath)
            (retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 0L) > 0L
        } catch (_: Exception) {
            false
        } finally {
            retriever.release()
        }
    }

    private fun sha256(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().buffered().use { input ->
            val bytes = ByteArray(8192)
            while (true) {
                val count = input.read(bytes)
                if (count < 0) break
                digest.update(bytes, 0, count)
            }
        }
        return digest.digest().joinToString("") { "%02x".format(it.toInt() and 0xff) }
    }

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL("""
            CREATE TABLE sessions (
                id TEXT PRIMARY KEY,
                date TEXT NOT NULL,
                started_at INTEGER NOT NULL,
                ended_at INTEGER,
                duration_seconds INTEGER DEFAULT 0,
                status TEXT NOT NULL,
                owner_user_id TEXT,
                text TEXT,
                audio_file_path TEXT,
                completion_sent INTEGER NOT NULL DEFAULT 0,
                transcript_state TEXT NOT NULL DEFAULT 'pending',
                transcript_done INTEGER NOT NULL DEFAULT 0,
                transcript_total INTEGER NOT NULL DEFAULT 0
            )
        """.trimIndent())

        db.execSQL("""
            CREATE TABLE turns (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                speaker TEXT NOT NULL,
                text TEXT NOT NULL,
                timestamp INTEGER NOT NULL,
                remote_segment_id INTEGER,
                participant_data TEXT,
                participant_cached_at INTEGER,
                FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
            )
        """.trimIndent())

        db.execSQL("""
            CREATE TABLE notes (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                body TEXT NOT NULL,
                color TEXT NOT NULL,
                tags TEXT,
                reminder_date TEXT,
                created_at INTEGER NOT NULL
            )
        """.trimIndent())

        db.execSQL("CREATE INDEX idx_sessions_date ON sessions(date)")
        db.execSQL("CREATE INDEX idx_turns_session ON turns(session_id)")
        db.execSQL("CREATE UNIQUE INDEX idx_turns_remote_segment ON turns(session_id, remote_segment_id) WHERE remote_segment_id IS NOT NULL")
        createChunksTable(db)
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        if (oldVersion < 2) createChunksTable(db)
        if (oldVersion < 3) {
            if (oldVersion >= 2) db.execSQL("ALTER TABLE recording_chunks ADD COLUMN sync_state TEXT NOT NULL DEFAULT 'pending'")
            db.execSQL("ALTER TABLE sessions ADD COLUMN completion_sent INTEGER NOT NULL DEFAULT 0")
            db.execSQL("ALTER TABLE sessions ADD COLUMN transcript_state TEXT NOT NULL DEFAULT 'pending'")
        }
        if (oldVersion < 4) db.execSQL("ALTER TABLE sessions ADD COLUMN owner_user_id TEXT")
        if (oldVersion < 5) {
            db.execSQL("ALTER TABLE sessions ADD COLUMN transcript_done INTEGER NOT NULL DEFAULT 0")
            db.execSQL("ALTER TABLE sessions ADD COLUMN transcript_total INTEGER NOT NULL DEFAULT 0")
        }
        if (oldVersion < 6) {
            db.execSQL("ALTER TABLE turns ADD COLUMN remote_segment_id INTEGER")
            db.execSQL("ALTER TABLE turns ADD COLUMN participant_data TEXT")
            db.execSQL("ALTER TABLE turns ADD COLUMN participant_cached_at INTEGER")
            db.execSQL("CREATE UNIQUE INDEX idx_turns_remote_segment ON turns(session_id, remote_segment_id) WHERE remote_segment_id IS NOT NULL")
        }
    }

    private fun createChunksTable(db: SQLiteDatabase) {
        db.execSQL("""
            CREATE TABLE IF NOT EXISTS recording_chunks (
                session_id TEXT NOT NULL,
                chunk_num INTEGER NOT NULL,
                path TEXT NOT NULL,
                started_at INTEGER NOT NULL,
                ended_at INTEGER,
                size_bytes INTEGER NOT NULL DEFAULT 0,
                sha256 TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL,
                sync_state TEXT NOT NULL DEFAULT 'pending',
                PRIMARY KEY (session_id, chunk_num),
                FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
            )
        """.trimIndent())
    }

    fun insertSession(session: Session) {
        val db = writableDatabase
        val cv = ContentValues().apply {
            put("id", session.id)
            put("date", session.date)
            put("started_at", session.startedAt)
            put("ended_at", session.endedAt)
            put("duration_seconds", session.durationSeconds)
            put("status", session.status)
            put("owner_user_id", session.ownerUserId)
            put("text", session.text)
            put("audio_file_path", session.audioFilePath)
        }
        db.insertWithOnConflict("sessions", null, cv, SQLiteDatabase.CONFLICT_REPLACE)
        refreshAll()
    }

    fun updateSession(session: Session) {
        val db = writableDatabase
        val cv = ContentValues().apply {
            put("ended_at", session.endedAt)
            put("duration_seconds", session.durationSeconds)
            put("status", session.status)
            put("text", session.text)
            put("audio_file_path", session.audioFilePath)
        }
        db.update("sessions", cv, "id = ?", arrayOf(session.id))
        refreshAll()
    }

    fun insertTurn(turn: Turn) {
        val db = writableDatabase
        val cv = ContentValues().apply {
            put("id", turn.id)
            put("session_id", turn.sessionId)
            put("speaker", turn.speaker)
            put("text", turn.text)
            put("timestamp", turn.timestamp)
            if (turn.remoteSegmentId != null) put("remote_segment_id", turn.remoteSegmentId)
        }
        if (db.update("turns", cv, "id = ?", arrayOf(turn.id)) == 0) {
            db.insertWithOnConflict("turns", null, cv, SQLiteDatabase.CONFLICT_IGNORE)
        }
        refreshAll()
    }

    fun getSessionsForDate(date: String, ownerUserId: String? = MobileCredentials.recordingOwnerUserId(appContext)): List<Session> {
        val db = readableDatabase
        val sessions = mutableListOf<Session>()
        val ownerClause = if (ownerUserId == null) "owner_user_id IS NULL" else "owner_user_id = ?"
        val arguments = if (ownerUserId == null) arrayOf(date) else arrayOf(date, ownerUserId)
        val cursor = db.rawQuery(
            "SELECT id, date, started_at, ended_at, duration_seconds, status, text, audio_file_path, transcript_state, owner_user_id, transcript_done, transcript_total " +
                "FROM sessions WHERE date = ? AND $ownerClause ORDER BY started_at DESC",
            arguments
        )
        cursor.use { c ->
            while (c.moveToNext()) {
                val sessionId = c.getString(0)
                val turns = getTurnsForSession(sessionId)
                sessions.add(
                    Session(
                        id = sessionId,
                        date = c.getString(1),
                        startedAt = c.getLong(2),
                        endedAt = if (c.isNull(3)) null else c.getLong(3),
                        durationSeconds = c.getInt(4),
                        status = c.getString(5),
                        text = c.getString(6) ?: "",
                        turns = turns,
                        audioFilePath = if (c.isNull(7)) null else c.getString(7),
                        chunks = getChunksForSession(sessionId),
                        transcriptState = c.getString(8),
                        ownerUserId = if (c.isNull(9)) null else c.getString(9),
                        transcriptDone = c.getInt(10),
                        transcriptTotal = c.getInt(11)
                    )
                )
            }
        }
        return sessions
    }

    fun getTurnsForSession(sessionId: String): List<Turn> {
        val db = readableDatabase
        val turns = mutableListOf<Turn>()
        val cursor = db.rawQuery(
            "SELECT id, session_id, speaker, text, timestamp, remote_segment_id, participant_data, participant_cached_at FROM turns WHERE session_id = ? ORDER BY timestamp ASC, rowid ASC",
            arrayOf(sessionId)
        )
        cursor.use { c ->
            while (c.moveToNext()) {
                turns.add(
                    Turn(
                        id = c.getString(0),
                        sessionId = c.getString(1),
                        speaker = c.getString(2),
                        text = c.getString(3),
                        timestamp = c.getLong(4),
                        remoteSegmentId = if (c.isNull(5)) null else c.getLong(5),
                        participantData = if (c.isNull(6)) null else c.getString(6),
                        participantCachedAt = if (c.isNull(7)) null else c.getLong(7)
                    )
                )
            }
        }
        return turns
    }

    fun insertChunk(chunk: RecordingChunk) {
        val values = ContentValues().apply {
            put("session_id", chunk.sessionId)
            put("chunk_num", chunk.chunkNum)
            put("path", chunk.path)
            put("started_at", chunk.startedAt)
            put("ended_at", chunk.endedAt)
            put("size_bytes", chunk.sizeBytes)
            put("sha256", chunk.sha256)
            put("status", chunk.status)
        }
        writableDatabase.insertOrThrow("recording_chunks", null, values)
        refreshAll()
    }

    fun updateChunk(chunk: RecordingChunk) {
        val values = ContentValues().apply {
            put("ended_at", chunk.endedAt)
            put("size_bytes", chunk.sizeBytes)
            put("sha256", chunk.sha256)
            put("status", chunk.status)
        }
        writableDatabase.update(
            "recording_chunks", values, "session_id = ? AND chunk_num = ?",
            arrayOf(chunk.sessionId, chunk.chunkNum.toString())
        )
        refreshAll()
    }

    fun getChunksForSession(sessionId: String): List<RecordingChunk> {
        val chunks = mutableListOf<RecordingChunk>()
        readableDatabase.rawQuery(
            "SELECT session_id, chunk_num, path, started_at, ended_at, size_bytes, sha256, status, sync_state " +
                "FROM recording_chunks WHERE session_id = ? ORDER BY chunk_num",
            arrayOf(sessionId)
        ).use { c ->
            while (c.moveToNext()) {
                chunks.add(RecordingChunk(
                    sessionId = c.getString(0), chunkNum = c.getInt(1), path = c.getString(2),
                    startedAt = c.getLong(3), endedAt = if (c.isNull(4)) null else c.getLong(4),
                    sizeBytes = c.getLong(5), sha256 = c.getString(6), status = c.getString(7),
                    syncState = c.getString(8)
                ))
            }
        }
        return chunks
    }

    fun getChunksToUpload(ownerUserId: String, limit: Int = 20): List<RecordingChunk> {
        val chunks = mutableListOf<RecordingChunk>()
        readableDatabase.rawQuery(
            "SELECT c.session_id, c.chunk_num, c.path, c.started_at, c.ended_at, c.size_bytes, c.sha256, c.status, c.sync_state " +
                "FROM recording_chunks c JOIN sessions s ON s.id = c.session_id " +
                "WHERE s.owner_user_id = ? AND c.status = 'recorded' AND c.sync_state = 'pending' " +
                "ORDER BY c.started_at LIMIT ?", arrayOf(ownerUserId, limit.toString())
        ).use { c ->
            while (c.moveToNext()) chunks.add(RecordingChunk(
                sessionId = c.getString(0), chunkNum = c.getInt(1), path = c.getString(2),
                startedAt = c.getLong(3), endedAt = if (c.isNull(4)) null else c.getLong(4),
                sizeBytes = c.getLong(5), sha256 = c.getString(6), status = c.getString(7),
                syncState = c.getString(8)
            ))
        }
        return chunks
    }

    fun getLocalSyncStats(): LocalSyncStats {
        val db = readableDatabase
        val sessions = db.rawQuery("SELECT COUNT(*) FROM sessions", null).use { c -> c.moveToFirst(); c.getInt(0) }
        val notes = db.rawQuery("SELECT COUNT(*) FROM notes", null).use { c -> c.moveToFirst(); c.getInt(0) }
        return db.rawQuery(
            "SELECT COUNT(*), " +
                "COALESCE(SUM(CASE WHEN status = 'recorded' AND sync_state = 'pending' THEN 1 ELSE 0 END), 0), " +
                "COALESCE(SUM(CASE WHEN sync_state = 'conflict' THEN 1 ELSE 0 END), 0), " +
                "COALESCE(SUM(CASE WHEN status = 'recorded' THEN size_bytes ELSE 0 END), 0) " +
                "FROM recording_chunks", null
        ).use { c ->
            c.moveToFirst()
            LocalSyncStats(sessions, notes, c.getInt(0), c.getInt(1), c.getInt(2), c.getLong(3))
        }
    }

    /** Keep transcripts and session history; only remove confirmed local copies. */
    fun audioCleanupCandidates(ownerUserId: String, beforeMillis: Long): List<AudioCleanupCandidate> {
        val result = mutableListOf<AudioCleanupCandidate>()
        readableDatabase.rawQuery(
            "SELECT c.session_id, c.chunk_num, c.path, c.size_bytes FROM recording_chunks c " +
                "JOIN sessions s ON s.id = c.session_id " +
                "WHERE s.owner_user_id = ? AND s.ended_at IS NOT NULL AND s.ended_at < ? " +
                "AND s.status IN ('recorded', 'partial') AND s.transcript_state = 'ready' " +
                "AND s.completion_sent = 1 AND c.status = 'recorded' AND c.sync_state = 'uploaded' " +
                "AND NOT EXISTS (SELECT 1 FROM recording_chunks other WHERE other.session_id = s.id " +
                "AND other.status = 'recorded' AND other.sync_state != 'uploaded') " +
                "ORDER BY s.ended_at, c.chunk_num",
            arrayOf(ownerUserId, beforeMillis.toString())
        ).use { cursor ->
            while (cursor.moveToNext()) result.add(AudioCleanupCandidate(
                cursor.getString(0), cursor.getInt(1), cursor.getString(2), cursor.getLong(3)
            ))
        }
        return result
    }

    fun markAudioPurged(candidate: AudioCleanupCandidate): Boolean {
        val values = ContentValues().apply {
            put("status", "purged")
            put("size_bytes", 0L)
        }
        return writableDatabase.update("recording_chunks", values,
            "session_id = ? AND chunk_num = ? AND path = ? AND status = 'recorded' AND sync_state = 'uploaded'",
            arrayOf(candidate.sessionId, candidate.chunkNum.toString(), candidate.path)) == 1
    }

    fun getSyncSessionIds(ownerUserId: String): List<String> {
        val ids = mutableListOf<String>()
        readableDatabase.rawQuery(
            "SELECT s.id FROM sessions s WHERE s.owner_user_id = ? AND s.status IN ('recorded', 'partial') " +
                "AND (s.completion_sent = 0 OR s.transcript_state IN ('pending', 'transcribing')) " +
                "AND EXISTS (SELECT 1 FROM recording_chunks c WHERE c.session_id = s.id AND c.status = 'recorded') " +
                "AND NOT EXISTS (SELECT 1 FROM recording_chunks c WHERE c.session_id = s.id " +
                "AND c.status = 'recorded' AND c.sync_state != 'uploaded') " +
                "ORDER BY s.started_at LIMIT 100", arrayOf(ownerUserId)
        ).use { c -> while (c.moveToNext()) ids.add(c.getString(0)) }
        return ids
    }

    fun getSessionStartMillis(sessionId: String): Long? = readableDatabase.rawQuery(
        "SELECT started_at FROM sessions WHERE id = ?", arrayOf(sessionId)
    ).use { c -> if (c.moveToFirst()) c.getLong(0) else null }

    fun getSessionStatus(sessionId: String): String? = readableDatabase.rawQuery(
        "SELECT status FROM sessions WHERE id = ?", arrayOf(sessionId)
    ).use { c -> if (c.moveToFirst()) c.getString(0) else null }

    fun needsCompletion(sessionId: String): Boolean = readableDatabase.rawQuery(
        "SELECT completion_sent FROM sessions WHERE id = ?", arrayOf(sessionId)
    ).use { c -> c.moveToFirst() && c.getInt(0) == 0 }

    fun isSessionFullyUploaded(sessionId: String): Boolean = readableDatabase.rawQuery(
        "SELECT COUNT(*), SUM(CASE WHEN sync_state = 'uploaded' THEN 1 ELSE 0 END) " +
            "FROM recording_chunks WHERE session_id = ? AND status = 'recorded'", arrayOf(sessionId)
    ).use { c -> c.moveToFirst() && c.getInt(0) > 0 && c.getInt(0) == c.getInt(1) }

    fun markChunkSyncState(sessionId: String, chunkNum: Int, state: String) {
        require(state == "uploaded" || state == "conflict")
        writableDatabase.update("recording_chunks", ContentValues().apply { put("sync_state", state) },
            "session_id = ? AND chunk_num = ?", arrayOf(sessionId, chunkNum.toString()))
        refreshAll()
    }

    fun markCompletionSent(sessionId: String) {
        writableDatabase.update("sessions", ContentValues().apply { put("completion_sent", 1) },
            "id = ?", arrayOf(sessionId))
        refreshAll()
    }

    fun updateTranscript(sessionId: String, state: String, text: String?, turns: List<Turn>,
                         done: Int = 0, total: Int = 0) {
        require(state in setOf("ready", "transcribing", "error"))
        val db = writableDatabase
        db.beginTransaction()
        try {
            db.update("sessions", ContentValues().apply {
                put("transcript_state", state)
                put("transcript_done", done)
                put("transcript_total", total)
                if (state == "ready") put("text", text.orEmpty())
            }, "id = ?", arrayOf(sessionId))
            if (state == "ready") {
                val retainedIds = mutableSetOf<String>()
                turns.forEach { turn ->
                    val remoteId = turn.remoteSegmentId
                    val existing = if (remoteId != null) db.rawQuery(
                        "SELECT id FROM turns WHERE session_id = ? AND remote_segment_id = ?",
                        arrayOf(sessionId, remoteId.toString())
                    ).use { if (it.moveToFirst()) it.getString(0) else null } else null
                    val legacy = if (existing == null && remoteId != null) db.rawQuery(
                        "SELECT id FROM turns WHERE session_id = ? AND remote_segment_id IS NULL AND speaker = ? AND text = ? AND timestamp = ? LIMIT 1",
                        arrayOf(sessionId, turn.speaker, turn.text, turn.timestamp.toString())
                    ).use { if (it.moveToFirst()) it.getString(0) else null } else null
                    val localId = existing ?: legacy ?: UUID.randomUUID().toString()
                    retainedIds.add(localId)
                    db.insertWithOnConflict("turns", null, ContentValues().apply {
                        put("id", localId)
                        put("session_id", sessionId)
                        put("speaker", turn.speaker)
                        put("text", turn.text)
                        put("timestamp", turn.timestamp)
                        if (remoteId != null) put("remote_segment_id", remoteId)
                    }, SQLiteDatabase.CONFLICT_IGNORE)
                    if (existing != null || legacy != null) db.update("turns", ContentValues().apply {
                        put("speaker", turn.speaker); put("text", turn.text); put("timestamp", turn.timestamp)
                        if (remoteId != null) put("remote_segment_id", remoteId)
                    }, "id = ?", arrayOf(existing ?: legacy))
                }
                // Keep an empty response from erasing a transcript during transient upstream gaps.
                if (turns.isNotEmpty()) {
                    val staleIds = mutableListOf<String>()
                    db.rawQuery(
                        "SELECT id FROM turns WHERE session_id = ?",
                        arrayOf(sessionId)
                    ).use { cursor ->
                        while (cursor.moveToNext()) {
                            if (cursor.getString(0) !in retainedIds) staleIds.add(cursor.getString(0))
                        }
                    }
                    staleIds.forEach { db.delete("turns", "id = ?", arrayOf(it)) }
                }
            }
            db.setTransactionSuccessful()
        } finally { db.endTransaction() }
        refreshAll()
    }

    fun saveParticipantData(sessionId: String, remoteSegmentId: Long, ownerUserId: String, data: JSONObject) {
        writableDatabase.update("turns", ContentValues().apply {
            put("participant_data", data.toString())
            put("participant_cached_at", System.currentTimeMillis())
        }, "session_id = ? AND remote_segment_id = ? AND EXISTS (SELECT 1 FROM sessions WHERE id = ? AND owner_user_id = ?)",
            arrayOf(sessionId, remoteSegmentId.toString(), sessionId, ownerUserId))
        refreshAll()
    }

    fun insertNote(note: Note) {
        val db = writableDatabase
        val tagsJson = JSONArray(note.tags).toString()
        val cv = ContentValues().apply {
            put("id", note.id)
            put("title", note.title)
            put("body", note.body)
            put("color", note.color)
            put("tags", tagsJson)
            put("reminder_date", note.reminderDate)
            put("created_at", note.createdAt)
        }
        db.insertWithOnConflict("notes", null, cv, SQLiteDatabase.CONFLICT_REPLACE)
        refreshAll()
    }

    fun getAllNotes(): List<Note> {
        val db = readableDatabase
        val notes = mutableListOf<Note>()
        val cursor = db.rawQuery("SELECT id, title, body, color, tags, reminder_date, created_at FROM notes ORDER BY created_at DESC", null)
        cursor.use { c ->
            while (c.moveToNext()) {
                val tagsList = mutableListOf<String>()
                val tagsStr = c.getString(4)
                if (!tagsStr.isNullOrEmpty()) {
                    try {
                        val arr = JSONArray(tagsStr)
                        for (i in 0 until arr.length()) tagsList.add(arr.getString(i))
                    } catch (_: Exception) {}
                }
                notes.add(
                    Note(
                        id = c.getString(0),
                        title = c.getString(1),
                        body = c.getString(2),
                        color = c.getString(3),
                        tags = tagsList,
                        reminderDate = if (c.isNull(5)) null else c.getString(5),
                        createdAt = c.getLong(6)
                    )
                )
            }
        }
        return notes
    }

    fun deleteNote(id: String) {
        val db = writableDatabase
        db.delete("notes", "id = ?", arrayOf(id))
        refreshAll()
    }

    fun refreshAll() {
        val today = com.example.braincore.data.model.todayIso()
        _sessionsFlow.value = getSessionsForDate(today)
        _notesFlow.value = getAllNotes()
    }

    fun claimableUnownedSessionCount(): Int = readableDatabase.rawQuery(
        "SELECT COUNT(*) FROM sessions s WHERE s.owner_user_id IS NULL AND s.completion_sent = 0 " +
            "AND EXISTS (SELECT 1 FROM recording_chunks c WHERE c.session_id = s.id AND c.status = 'recorded') " +
            "AND NOT EXISTS (SELECT 1 FROM recording_chunks c WHERE c.session_id = s.id AND c.sync_state != 'pending')",
        null
    ).use { c -> c.moveToFirst(); c.getInt(0) }

    fun unownedSessionsWithRemoteProgress(): List<String> {
        val ids = mutableListOf<String>()
        readableDatabase.rawQuery(
            "SELECT s.id FROM sessions s WHERE s.owner_user_id IS NULL AND " +
                "(s.completion_sent = 1 OR EXISTS (SELECT 1 FROM recording_chunks c WHERE c.session_id = s.id " +
                "AND c.sync_state IN ('uploaded', 'conflict'))) ORDER BY s.started_at",
            null
        ).use { c -> while (c.moveToNext()) ids.add(c.getString(0)) }
        return ids
    }

    fun bindServerOwnedSessions(sessionIds: Set<String>, ownerUserId: String) {
        if (sessionIds.isEmpty()) return
        val db = writableDatabase
        db.beginTransaction()
        try {
            for (sessionId in sessionIds) {
                db.update("sessions", ContentValues().apply { put("owner_user_id", ownerUserId) },
                    "id = ? AND owner_user_id IS NULL", arrayOf(sessionId))
            }
            db.setTransactionSuccessful()
        } finally { db.endTransaction() }
        refreshAll()
    }

    fun claimUnownedSessions(ownerUserId: String): Int {
        require(ownerUserId.isNotBlank())
        val count = writableDatabase.compileStatement(
            "UPDATE sessions SET owner_user_id = ? WHERE owner_user_id IS NULL AND completion_sent = 0 " +
                "AND EXISTS (SELECT 1 FROM recording_chunks c WHERE c.session_id = sessions.id AND c.status = 'recorded') " +
                "AND NOT EXISTS (SELECT 1 FROM recording_chunks c WHERE c.session_id = sessions.id AND c.sync_state != 'pending')"
        ).use { statement -> statement.bindString(1, ownerUserId); statement.executeUpdateDelete() }
        refreshAll()
        return count
    }

    companion object {
        private const val DATABASE_NAME = "brain_core.db"
        private const val DATABASE_VERSION = 6

        @Volatile
        private var instance: BrainCoreDatabase? = null

        fun getInstance(context: Context): BrainCoreDatabase {
            return instance ?: synchronized(this) {
                instance ?: BrainCoreDatabase(context.applicationContext).also { instance = it }
            }
        }
    }
}
