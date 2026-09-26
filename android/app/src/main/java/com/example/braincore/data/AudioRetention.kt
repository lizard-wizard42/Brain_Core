package com.example.braincore.data

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.util.UUID
import java.util.concurrent.TimeUnit

data class AudioCleanupResult(val files: Int, val bytes: Long)

object AudioRetentionPreferences {
    private const val STORE = "brain_core_audio_retention"
    private const val AUTOMATIC = "automatic"
    private const val DAYS = "days"
    val allowedDays = listOf(7, 30, 90, 180, 365)

    fun automatic(context: Context): Boolean =
        context.getSharedPreferences(STORE, Context.MODE_PRIVATE).getBoolean(AUTOMATIC, false)

    fun days(context: Context): Int =
        context.getSharedPreferences(STORE, Context.MODE_PRIVATE).getInt(DAYS, 30)
            .takeIf { it in allowedDays } ?: 30

    fun setAutomatic(context: Context, enabled: Boolean) {
        context.getSharedPreferences(STORE, Context.MODE_PRIVATE).edit().putBoolean(AUTOMATIC, enabled).apply()
    }

    fun setDays(context: Context, days: Int) {
        require(days in allowedDays)
        context.getSharedPreferences(STORE, Context.MODE_PRIVATE).edit().putInt(DAYS, days).apply()
    }
}

object AudioRetention {
    fun eligible(context: Context, days: Int): List<AudioCleanupCandidate> {
        require(days in AudioRetentionPreferences.allowedDays)
        val owner = MobileCredentials.userId(context) ?: return emptyList()
        val cutoff = System.currentTimeMillis() - TimeUnit.DAYS.toMillis(days.toLong())
        return BrainCoreDatabase.getInstance(context).audioCleanupCandidates(owner, cutoff)
    }

    fun clean(context: Context, days: Int): AudioCleanupResult {
        val db = BrainCoreDatabase.getInstance(context)
        val recordingsRoot = File(context.filesDir, "recordings").canonicalFile
        var files = 0
        var bytes = 0L
        for (candidate in eligible(context, days)) {
            if (runCatching { UUID.fromString(candidate.sessionId).toString() }.getOrNull() != candidate.sessionId) continue
            val expected = File(File(recordingsRoot, candidate.sessionId), "chunk-%04d.m4a".format(candidate.chunkNum))
            val file = File(candidate.path)
            if (file.canonicalFile != expected.canonicalFile || file.parentFile?.canonicalFile != expected.parentFile?.canonicalFile) continue
            val size = if (file.isFile) file.length() else 0L
            if (file.exists() && !file.delete()) continue
            if (db.markAudioPurged(candidate)) {
                if (size > 0L) { files++; bytes += size }
            }
        }
        db.refreshAll()
        return AudioCleanupResult(files, bytes)
    }
}

class AudioCleanupWorker(context: Context, parameters: WorkerParameters) : CoroutineWorker(context, parameters) {
    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        if (!AudioRetentionPreferences.automatic(applicationContext)) return@withContext Result.success()
        try {
            AudioRetention.clean(applicationContext, AudioRetentionPreferences.days(applicationContext))
            Result.success()
        } catch (_: Exception) { Result.retry() }
    }
}

object AudioRetentionScheduler {
    private const val WORK_NAME = "brain-core-audio-cleanup"

    fun update(context: Context) {
        val manager = WorkManager.getInstance(context)
        if (AudioRetentionPreferences.automatic(context)) {
            manager.enqueueUniquePeriodicWork(WORK_NAME, ExistingPeriodicWorkPolicy.UPDATE,
                PeriodicWorkRequestBuilder<AudioCleanupWorker>(1, TimeUnit.DAYS).build())
        } else manager.cancelUniqueWork(WORK_NAME)
    }
}
