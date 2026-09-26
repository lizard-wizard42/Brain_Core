package com.example.braincore.data.model

import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.UUID

data class Session(
    val id: String = UUID.randomUUID().toString(),
    val date: String = todayIso(),
    val startedAt: Long = System.currentTimeMillis(),
    val endedAt: Long? = null,
    val durationSeconds: Int = 0,
    val status: String = "ready", // recording, processing, ready, error
    val text: String = "",
    val turns: List<Turn> = emptyList(),
    val audioFilePath: String? = null,
    val chunks: List<RecordingChunk> = emptyList(),
    val transcriptState: String = "pending",
    val transcriptDone: Int = 0,
    val transcriptTotal: Int = 0,
    val ownerUserId: String? = null
) {
    fun formattedTimeRange(): String {
        val sdf = SimpleDateFormat("HH:mm", Locale.getDefault())
        val start = sdf.format(Date(startedAt))
        val end = endedAt?.let { sdf.format(Date(it)) }
            ?: if (status == "error") "interrompida" else "agora"
        return "$start — $end"
    }

    fun formattedDuration(): String {
        if (status == "error" && endedAt == null) return "—"
        val s = if (durationSeconds > 0) durationSeconds else {
            val end = endedAt ?: System.currentTimeMillis()
            ((end - startedAt) / 1000).toInt().coerceAtLeast(0)
        }
        val mins = s / 60
        val secs = s % 60
        return if (mins > 0) "${mins}m ${secs}s" else "${secs}s"
    }
}

data class RecordingChunk(
    val sessionId: String,
    val chunkNum: Int,
    val path: String,
    val startedAt: Long,
    val endedAt: Long? = null,
    val sizeBytes: Long = 0,
    val sha256: String = "",
    val status: String = "recording",
    val syncState: String = "pending"
)

data class Turn(
    val id: String = UUID.randomUUID().toString(),
    val sessionId: String,
    val speaker: String = "me", // "me", "other", "unknown"
    val text: String,
    val timestamp: Long = System.currentTimeMillis(),
    val remoteSegmentId: Long? = null,
    val participantData: String? = null,
    val participantCachedAt: Long? = null
)

data class Note(
    val id: String = UUID.randomUUID().toString(),
    val title: String,
    val body: String,
    val color: String = "slate", // sand, rose, sage, sky, amber, lavender, slate
    val tags: List<String> = emptyList(),
    val reminderDate: String? = null,
    val createdAt: Long = System.currentTimeMillis()
)

fun todayIso(): String {
    return SimpleDateFormat("yyyy-MM-dd", Locale.getDefault()).format(Date())
}
