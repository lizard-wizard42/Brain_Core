package com.example.braincore.service

import android.app.Notification
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.media.MediaRecorder
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.Log
import androidx.core.app.NotificationCompat
import com.example.braincore.BrainCoreApp
import com.example.braincore.MainActivity
import com.example.braincore.data.BrainCoreDatabase
import com.example.braincore.data.MobileCredentials
import com.example.braincore.data.SyncScheduler
import com.example.braincore.data.model.RecordingChunk
import com.example.braincore.data.model.Session
import com.example.braincore.data.model.todayIso
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.io.File
import java.security.MessageDigest
import java.util.UUID

class AudioRecordingService : Service() {
    private lateinit var database: BrainCoreDatabase
    private val handler = Handler(Looper.getMainLooper())
    private val rotateRunnable = Runnable { rotateChunk() }
    private var recorder: MediaRecorder? = null
    private var currentSession: Session? = null
    private var currentChunk: RecordingChunk? = null
    private var nextChunkNum = 1
    private var hadError = false

    override fun onCreate() {
        super.onCreate()
        database = (application as BrainCoreApp).database
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> startRecording()
            ACTION_STOP -> {
                finishSession()
                stopSelf()
            }
            else -> stopSelf()
        }
        // A killed process must never silently restart the microphone.
        return START_NOT_STICKY
    }

    private fun startRecording() {
        if (currentSession != null) return
        val ownerUserId = MobileCredentials.recordingOwnerUserId(this)
        if (ownerUserId == null) {
            _error.value = "Vincule o aparelho à sua conta em Ajustes antes de gravar."
            stopSelf()
            return
        }
        val session = Session(
            id = UUID.randomUUID().toString(),
            date = todayIso(),
            startedAt = System.currentTimeMillis(),
            status = "recording",
            ownerUserId = ownerUserId
        )
        try {
            startForeground(BrainCoreApp.NOTIFICATION_ID, buildNotification())
            database.insertSession(session)
            currentSession = session
            nextChunkNum = 1
            hadError = false
            startChunk(session)
            _error.value = null
            _isRecording.value = true
        } catch (error: Exception) {
            Log.e(TAG, "Could not start audio recording", error)
            hadError = true
            _error.value = "Não foi possível iniciar a gravação. Verifique o microfone e o espaço livre."
            finishSession()
            stopSelf()
        }
    }

    private fun startChunk(session: Session) {
        val dir = File(File(filesDir, "recordings"), session.id).apply { mkdirs() }
        check(dir.isDirectory && dir.usableSpace >= MIN_FREE_BYTES) { "Espaço insuficiente para novo bloco" }
        val number = nextChunkNum++
        val file = File(dir, "chunk-%04d.m4a".format(number))
        val next = createRecorder()
        recorder = next
        try {
            next.apply {
                setOnErrorListener { failedRecorder, what, extra ->
                    if (recorder === failedRecorder && currentSession != null) {
                        Log.e(TAG, "MediaRecorder error: what=$what extra=$extra")
                        hadError = true
                        _error.value = "A gravação foi interrompida pelo sistema. Os blocos anteriores foram salvos."
                        finishSession()
                        stopSelf()
                    }
                }
                setAudioSource(MediaRecorder.AudioSource.MIC)
                setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
                setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
                setAudioChannels(1)
                setAudioSamplingRate(44100)
                setAudioEncodingBitRate(64000)
                setOutputFile(file.absolutePath)
                prepare()
                start()
            }
            val chunk = RecordingChunk(
                sessionId = session.id, chunkNum = number, path = file.absolutePath,
                startedAt = System.currentTimeMillis()
            )
            database.insertChunk(chunk)
            currentChunk = chunk
            handler.postDelayed(rotateRunnable, CHUNK_DURATION_MS)
        } catch (error: Exception) {
            try { next.stop() } catch (_: Exception) {}
            next.release()
            recorder = null
            file.delete()
            throw error
        }
    }

    private fun rotateChunk() {
        val session = currentSession ?: return
        if (!finishChunk()) {
            hadError = true
            _error.value = "Um bloco de áudio falhou. A gravação foi interrompida."
            finishSession()
            stopSelf()
            return
        }
        try {
            startChunk(session)
        } catch (error: Exception) {
            Log.e(TAG, "Could not start next audio chunk", error)
            hadError = true
            _error.value = "Não foi possível continuar a gravação. Os blocos anteriores foram salvos."
            finishSession()
            stopSelf()
        }
    }

    private fun finishChunk(): Boolean {
        handler.removeCallbacks(rotateRunnable)
        val chunk = currentChunk ?: return false
        currentChunk = null
        val file = File(chunk.path)
        var stopped = false
        try {
            recorder?.stop()
            stopped = true
        } catch (error: RuntimeException) {
            Log.e(TAG, "Could not finish audio chunk", error)
        } finally {
            try { recorder?.release() } catch (_: Exception) {}
            recorder = null
        }
        var valid = stopped && file.isFile && file.length() > 0L
        val hash = if (valid) {
            try { sha256(file) } catch (error: Exception) {
                Log.e(TAG, "Could not hash audio chunk", error)
                valid = false
                ""
            }
        } else ""
        if (!valid && !stopped) file.delete()
        database.updateChunk(chunk.copy(
            endedAt = System.currentTimeMillis(),
            sizeBytes = if (valid) file.length() else 0,
            sha256 = hash,
            status = if (valid) "recorded" else "error"
        ))
        if (valid) SyncScheduler.runAutomatically(this)
        return valid
    }

    private fun finishSession() {
        handler.removeCallbacks(rotateRunnable)
        val session = currentSession ?: return
        currentSession = null
        if (currentChunk != null && !finishChunk()) hadError = true
        val chunks = database.getChunksForSession(session.id)
        val hasAudio = chunks.any { it.status == "recorded" }
        val now = System.currentTimeMillis()
        database.updateSession(session.copy(
            endedAt = now,
            durationSeconds = ((now - session.startedAt) / 1000).toInt().coerceAtLeast(0),
            status = if (!hasAudio) "error" else if (hadError) "partial" else "recorded"
        ))
        if (hasAudio) SyncScheduler.runAutomatically(this)
        if (!hasAudio) _error.value = "A gravação falhou ou foi curta demais. Tente novamente."
        _isRecording.value = false
        stopForeground(STOP_FOREGROUND_REMOVE)
    }

    override fun onDestroy() {
        finishSession()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    @Suppress("DEPRECATION")
    private fun createRecorder(): MediaRecorder =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) MediaRecorder(this) else MediaRecorder()

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

    private fun buildNotification(): Notification {
        val openAppIntent = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        val stopIntent = PendingIntent.getService(
            this, 1, Intent(this, AudioRecordingService::class.java).apply { action = ACTION_STOP },
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        return NotificationCompat.Builder(this, BrainCoreApp.CHANNEL_ID)
            .setContentTitle("Brain Core — gravando áudio")
            .setContentText("Toque para acompanhar a sessão")
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setContentIntent(openAppIntent)
            .setOngoing(true)
            .addAction(android.R.drawable.ic_media_pause, "Parar", stopIntent)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
    }

    companion object {
        private const val TAG = "AudioRecordingService"
        private const val CHUNK_DURATION_MS = 2 * 60 * 1000L
        private const val MIN_FREE_BYTES = 20L * 1024 * 1024
        const val ACTION_START = "com.example.braincore.START_RECORDING"
        const val ACTION_STOP = "com.example.braincore.STOP_RECORDING"

        private val _isRecording = MutableStateFlow(false)
        val isRecording: StateFlow<Boolean> = _isRecording.asStateFlow()
        private val _error = MutableStateFlow<String?>(null)
        val error: StateFlow<String?> = _error.asStateFlow()

        fun start(context: Context) {
            val intent = Intent(context, AudioRecordingService::class.java).apply { action = ACTION_START }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent)
            else context.startService(intent)
        }

        fun stop(context: Context) {
            context.startService(
                Intent(context, AudioRecordingService::class.java).apply { action = ACTION_STOP }
            )
        }
    }
}
