package com.example.braincore.ui.desktop

import android.content.Context
import android.media.MediaRecorder
import android.os.Build
import android.os.Handler
import android.os.Looper
import com.example.braincore.data.MobileApi
import java.io.File

/** Short, foreground-only reference sample. The temporary audio never enters the WebView. */
internal object NativeVoiceSampleRecorder {
    private const val MIN_MILLIS = 8_000L
    private const val MAX_MILLIS = 32_000L
    private val handler = Handler(Looper.getMainLooper())
    private var recorder: MediaRecorder? = null
    private var file: File? = null
    private var ownerUserId: String? = null
    private var startedAt = 0L
    private val timeout = Runnable { cancel() }

    @Synchronized
    fun start(context: Context, userId: String): Boolean {
        if (recorder != null) return false
        val sample = File.createTempFile("voice-sample-", ".m4a", context.cacheDir)
        val next = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) MediaRecorder(context) else MediaRecorder()
        try {
            next.setAudioSource(MediaRecorder.AudioSource.MIC)
            next.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
            next.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            next.setAudioChannels(1)
            next.setAudioSamplingRate(44100)
            next.setAudioEncodingBitRate(64000)
            next.setOutputFile(sample.absolutePath)
            next.prepare()
            next.start()
            recorder = next
            file = sample
            ownerUserId = userId
            startedAt = android.os.SystemClock.elapsedRealtime()
            handler.postDelayed(timeout, MAX_MILLIS)
            return true
        } catch (error: Exception) {
            next.release()
            sample.delete()
            throw error
        }
    }

    @Synchronized
    fun stop(): Pair<File, String> {
        val active = recorder ?: throw IllegalStateException("Nenhuma amostra em gravação")
        val sample = requireNotNull(file)
        val owner = requireNotNull(ownerUserId)
        val duration = android.os.SystemClock.elapsedRealtime() - startedAt
        handler.removeCallbacks(timeout)
        recorder = null
        file = null
        ownerUserId = null
        try {
            active.stop()
            if (duration < MIN_MILLIS || sample.length() == 0L) {
                sample.delete()
                throw IllegalStateException("Grave sua voz por pelo menos 8 segundos")
            }
            return sample to owner
        } catch (error: Exception) {
            sample.delete()
            throw error
        } finally {
            active.release()
        }
    }

    @Synchronized
    fun cancel() {
        handler.removeCallbacks(timeout)
        try { recorder?.stop() } catch (_: Exception) {}
        recorder?.release()
        recorder = null
        file?.delete()
        file = null
        ownerUserId = null
    }

    fun upload(context: Context, sample: File, owner: String) {
        try { MobileApi(context).uploadVoiceSample(sample, owner) }
        finally { sample.delete() }
    }
}
