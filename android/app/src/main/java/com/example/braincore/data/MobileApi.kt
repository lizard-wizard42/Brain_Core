package com.example.braincore.data

import android.content.Context
import android.os.Build
import android.webkit.CookieManager
import org.json.JSONObject
import org.json.JSONArray
import java.io.File
import java.net.HttpURLConnection
import java.net.URLEncoder
import java.net.URL
import java.security.MessageDigest
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

class MobileApiException(val statusCode: Int, message: String) : Exception(message)

class MobileApi(private val context: Context) {
    private val origin = ServerSettings.get(context)
    private val deviceToken = MobileCredentials.get(context)

    private fun ownerQuery(ownerUserId: String): String =
        "owner_user_id=${URLEncoder.encode(ownerUserId, "UTF-8")}"

    fun resolveLinkedUserId(): String {
        val connection = connection("/api/mobile/device", "GET", requireNotNull(deviceToken))
        return try { response(connection).getString("user_id") } finally { connection.disconnect() }
    }

    fun webLoginUserId(): String {
        val cookie = CookieManager.getInstance().getCookie(origin).orEmpty()
        if (cookie.isBlank()) throw MobileApiException(401, "Faça login primeiro")
        val connection = connection("/api/auth/me", "GET")
        return try {
            connection.setRequestProperty("Cookie", cookie)
            response(connection).getString("id")
        } finally { connection.disconnect() }
    }

    fun uploadVoiceSample(file: File, expectedUserId: String) {
        require(file.isFile && file.length() > 0L && file.length() <= 25L * 1024 * 1024)
        if (webLoginUserId() != expectedUserId) throw MobileApiException(409, "A conta mudou durante a gravação")
        val cookie = CookieManager.getInstance().getCookie(origin).orEmpty()
        val connection = connection("/api/remember/memory/voiceprint", "POST")
        try {
            connection.readTimeout = 180_000
            connection.setRequestProperty("Cookie", cookie)
            connection.setRequestProperty("Origin", origin)
            connection.setRequestProperty("Content-Type", "audio/mp4")
            connection.setFixedLengthStreamingMode(file.length())
            connection.doOutput = true
            connection.outputStream.use { output -> file.inputStream().use { it.copyTo(output) } }
            response(connection)
        } finally { connection.disconnect() }
    }

    fun ownedSessionIds(sessionIds: List<String>): Set<String> {
        if (sessionIds.isEmpty()) return emptySet()
        require(sessionIds.size <= 100)
        val connection = connection("/api/mobile/sessions/owned", "POST", requireNotNull(deviceToken))
        return try {
            connection.setRequestProperty("Content-Type", "application/json")
            connection.doOutput = true
            connection.outputStream.use { output ->
                output.write(JSONObject().put("session_ids", JSONArray(sessionIds)).toString().toByteArray())
            }
            val array = response(connection).getJSONArray("session_ids")
            buildSet { for (index in 0 until array.length()) add(array.getString(index)) }
        } finally { connection.disconnect() }
    }

    private fun connection(path: String, method: String, token: String? = null): HttpURLConnection {
        require(ServerSettings.normalize(origin) == origin) { "Endereço do PC inválido" }
        return (URL("$origin$path").openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = 10_000
            readTimeout = 120_000
            instanceFollowRedirects = false
            if (token != null) setRequestProperty("Authorization", "Bearer $token")
        }
    }

    private fun response(connection: HttpURLConnection): JSONObject {
        val status = connection.responseCode
        val text = (if (status in 200..299) connection.inputStream else connection.errorStream)
            ?.bufferedReader()?.use { it.readText() }.orEmpty()
        if (status !in 200..299) throw MobileApiException(status, "HTTP $status")
        return JSONObject(text)
    }

    fun linkAfterWebLogin(
        expectedUserId: String? = null,
        previousUserId: String? = null,
        confirmSwitch: Boolean = false
    ): String {
        val cookie = CookieManager.getInstance().getCookie(origin).orEmpty()
        if (cookie.isBlank()) throw MobileApiException(401, "Faça login primeiro na aba PC")
        val connection = connection("/api/mobile/devices", "POST")
        return try {
            connection.setRequestProperty("Cookie", cookie)
            connection.setRequestProperty("Origin", origin)
            connection.setRequestProperty("X-Brain-Core-Device", "android")
            connection.setRequestProperty("Content-Type", "application/json")
            connection.doOutput = true
            val name = "Android ${Build.MODEL}".take(80)
            val body = JSONObject().apply {
                put("name", name)
                if (!expectedUserId.isNullOrBlank()) put("expected_user_id", expectedUserId)
                if (!previousUserId.isNullOrBlank()) put("previous_user_id", previousUserId)
                if (confirmSwitch) put("confirm_switch", true)
            }
            connection.outputStream.use { it.write(body.toString().toByteArray()) }
            val result = response(connection)
            val deviceId = result.getString("device_id")
            MobileCredentials.save(context, deviceId, result.getString("token"), result.getString("user_id"))
            deviceId
        } finally { connection.disconnect() }
    }

    fun upload(sessionId: String, chunkNum: Int, startedAtMillis: Long, chunkStartedAtMillis: Long,
               file: File, expectedSha: String, ownerUserId: String): Boolean {
        if (!file.isFile || file.length() == 0L || sha256(file) != expectedSha) {
            throw MobileApiException(409, "Áudio local ausente ou diferente do hash salvo")
        }
        val startedAt = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
            timeZone = TimeZone.getTimeZone("UTC")
        }.format(Date(startedAtMillis))
        val chunkStartedAt = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
            timeZone = TimeZone.getTimeZone("UTC")
        }.format(Date(chunkStartedAtMillis))
        val path = "/api/mobile/chunks?session_id=$sessionId&chunk_num=$chunkNum&sha256=$expectedSha&started_at=$startedAt&chunk_started_at=$chunkStartedAt&${ownerQuery(ownerUserId)}"
        val connection = connection(path, "POST", requireNotNull(deviceToken))
        return try {
            connection.setRequestProperty("Content-Type", "audio/mp4")
            connection.setFixedLengthStreamingMode(file.length())
            connection.doOutput = true
            connection.outputStream.use { output -> file.inputStream().buffered().use { it.copyTo(output) } }
            val result = response(connection)
            if (result.optString("sha256") != expectedSha) throw MobileApiException(503, "Confirmação de hash inválida")
            result.optString("status") in setOf("stored", "already_stored")
        } finally { connection.disconnect() }
    }

    fun complete(sessionId: String, failed: Boolean, ownerUserId: String) {
        val connection = connection("/api/mobile/sessions/$sessionId/complete?${ownerQuery(ownerUserId)}", "POST",
            requireNotNull(deviceToken))
        try {
            connection.setRequestProperty("Content-Type", "application/json")
            connection.doOutput = true
            val status = if (failed) "failed" else "stopped"
            connection.outputStream.use { it.write(JSONObject().put("status", status).toString().toByteArray()) }
            response(connection)
        } finally { connection.disconnect() }
    }

    fun transcript(sessionId: String, ownerUserId: String): JSONObject {
        val connection = connection("/api/mobile/sessions/$sessionId/transcript?${ownerQuery(ownerUserId)}", "GET",
            requireNotNull(deviceToken))
        return try { response(connection) } finally { connection.disconnect() }
    }

    fun participantData(sessionId: String, segmentId: Long, ownerUserId: String): JSONObject =
        jsonRequest("/api/mobile/sessions/$sessionId/participants/segments/$segmentId?${ownerQuery(ownerUserId)}", "GET")

    fun participantIdentities(sessionId: String, ownerUserId: String): JSONArray =
        jsonRequest("/api/mobile/sessions/$sessionId/participants/identities?${ownerQuery(ownerUserId)}", "GET").getJSONArray("identities")

    fun decideParticipant(sessionId: String, segmentId: Long, ownerUserId: String, action: String, identityId: String?): JSONObject =
        jsonRequest("/api/mobile/sessions/$sessionId/participants/segments/$segmentId/decision?${ownerQuery(ownerUserId)}", "POST",
            JSONObject().put("action", action).put("identity_id", identityId))

    fun createNote(title: String, body: String, reminderDate: String?): JSONObject {
        val connection = connection("/api/mobile/notes", "POST", requireNotNull(deviceToken))
        return try {
            connection.setRequestProperty("Content-Type", "application/json")
            connection.doOutput = true
            val payload = JSONObject()
                .put("title", title)
                .put("body", body)
                .put("color", if (reminderDate == null) "slate" else "amber")
                .put("tags", JSONArray(if (reminderDate == null) listOf("#memoria", "#nota") else listOf("#memoria", "#lembrete")))
            if (reminderDate != null) payload.put("reminder_date", reminderDate)
            connection.outputStream.use { it.write(payload.toString().toByteArray(Charsets.UTF_8)) }
            response(connection)
        } finally { connection.disconnect() }
    }

    fun pcAudioRetention(): JSONObject = jsonRequest("/api/mobile/audio-retention", "GET")

    fun pcAudioCleanupPreview(days: Int): JSONObject =
        jsonRequest("/api/mobile/audio-retention/preview?days=$days", "GET")

    fun savePcAudioRetention(automatic: Boolean, days: Int): JSONObject =
        jsonRequest("/api/mobile/audio-retention", "PUT",
            JSONObject().put("automatic", automatic).put("days", days))

    fun cleanPcAudio(days: Int): JSONObject =
        jsonRequest("/api/mobile/audio-retention/cleanup", "POST", JSONObject().put("days", days))

    fun transcriptionPolicy(): JSONObject = jsonRequest("/api/mobile/transcription-policy", "GET")

    fun saveTranscriptionPolicy(mode: String, startTime: String, windowHours: Int): JSONObject =
        jsonRequest("/api/mobile/transcription-policy", "PUT", JSONObject()
            .put("mode", mode).put("start_time", startTime).put("window_hours", windowHours)
            .put("timezone", "America/Sao_Paulo"))

    fun runTranscriptionNow(): JSONObject = jsonRequest("/api/mobile/transcription-policy/run", "POST")

    fun pauseTranscription(): JSONObject = jsonRequest("/api/mobile/transcription-policy/pause", "POST")

    private fun jsonRequest(path: String, method: String, body: JSONObject? = null): JSONObject {
        val connection = connection(path, method, requireNotNull(deviceToken))
        return try {
            if (body != null) {
                connection.setRequestProperty("Content-Type", "application/json")
                connection.doOutput = true
                connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            }
            response(connection)
        } finally { connection.disconnect() }
    }

    fun revokeThisDevice() {
        val token = deviceToken ?: return
        val connection = connection("/api/mobile/device", "DELETE", token)
        try { response(connection) } finally { connection.disconnect() }
    }

    private fun sha256(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().buffered().use { input ->
            val buffer = ByteArray(8192)
            while (true) {
                val size = input.read(buffer)
                if (size < 0) break
                digest.update(buffer, 0, size)
            }
        }
        return digest.digest().joinToString("") { "%02x".format(it.toInt() and 0xff) }
    }
}
