package com.example.braincore.data

import org.json.JSONObject

fun parseTranscriptTurns(sessionId: String, result: JSONObject): List<com.example.braincore.data.model.Turn> {
    val parsedTurns = mutableListOf<com.example.braincore.data.model.Turn>()
    val turns = result.optJSONArray("turns")
    if (turns != null) for (index in 0 until turns.length()) {
        val turn = turns.optJSONObject(index) ?: continue
        val text = turn.optString("text").trim()
        val spokenAt = turn.optString("start_at").takeIf { it.isNotBlank() && it != "null" }
            ?.let { runCatching { java.time.Instant.parse(it).toEpochMilli() }.getOrNull() }
        if (text.isNotEmpty()) parsedTurns.add(com.example.braincore.data.model.Turn(
            sessionId = sessionId, speaker = com.example.braincore.data.model.SpeakerDisplay.fromServer(
                turn.optString("speaker"), turn.optString("voice"), turn.optBoolean("voice_is_me_probable"),
                turn.optJSONObject("voice_label")?.optString("display_name"),
                turn.optJSONObject("voice_label")?.optBoolean("is_owner") == true),
            text = text, timestamp = spokenAt ?: 0L,
            remoteSegmentId = turn.optLong("id").takeIf { it > 0L }
        ))
    }
    return parsedTurns
}
