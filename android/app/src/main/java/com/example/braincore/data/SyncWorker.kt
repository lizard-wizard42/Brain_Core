package com.example.braincore.data

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.Data
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import com.example.braincore.data.model.Turn
import java.io.File
import java.util.concurrent.TimeUnit

class SyncWorker(context: Context, parameters: WorkerParameters) : CoroutineWorker(context, parameters) {
    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val manual = inputData.getBoolean("manual", false)
        val reconcileOnly = inputData.getBoolean("reconcile_only", false)
        val forceTranscription = inputData.getBoolean("force_transcription", false)
        if (!manual && !reconcileOnly && !SyncPreferences.autoUpload(applicationContext)) return@withContext Result.success()
        val origin = ServerSettings.get(applicationContext)
        val token = MobileCredentials.get(applicationContext)
        if (ServerSettings.normalize(origin) != origin || token == null) {
            return@withContext Result.success()
        }
        if (MobileCredentials.userId(applicationContext) == null) {
            try {
                val owner = MobileApi(applicationContext).resolveLinkedUserId()
                if (!MobileCredentials.bindExistingUserId(applicationContext, token, owner)) return@withContext Result.success()
                BrainCoreDatabase.getInstance(applicationContext).refreshAll()
            } catch (error: MobileApiException) {
                if (error.statusCode == 401 && MobileCredentials.get(applicationContext) == token) {
                    MobileCredentials.clear(applicationContext)
                    return@withContext Result.failure()
                }
                return@withContext Result.retry()
            } catch (_: Exception) { return@withContext Result.retry() }
        }
        val ownerUserId = MobileCredentials.userId(applicationContext) ?: return@withContext Result.success()
        fun sameCredential(): Boolean = MobileCredentials.userId(applicationContext) == ownerUserId &&
            MobileCredentials.get(applicationContext) == token
        val db = BrainCoreDatabase.getInstance(applicationContext)
        val api = MobileApi(applicationContext)
        try {
            for (batch in db.unownedSessionsWithRemoteProgress().chunked(100)) {
                if (!sameCredential()) return@withContext Result.success()
                val owned = api.ownedSessionIds(batch).intersect(batch.toSet())
                if (!sameCredential()) return@withContext Result.success()
                db.bindServerOwnedSessions(owned, ownerUserId)
            }
            if (reconcileOnly) return@withContext Result.success()
            val chunks = db.getChunksToUpload(ownerUserId)
            for (chunk in chunks) {
                if (!sameCredential()) return@withContext Result.success()
                val start = db.getSessionStartMillis(chunk.sessionId) ?: continue
                try {
                    if (api.upload(chunk.sessionId, chunk.chunkNum, start, chunk.startedAt, File(chunk.path), chunk.sha256, ownerUserId)) {
                        if (!sameCredential()) return@withContext Result.success()
                        db.markChunkSyncState(chunk.sessionId, chunk.chunkNum, "uploaded")
                    } else return@withContext Result.retry()
                } catch (error: MobileApiException) {
                    when (error.statusCode) {
                        409 -> {
                            if (!sameCredential()) return@withContext Result.success()
                            db.markChunkSyncState(chunk.sessionId, chunk.chunkNum, "conflict")
                        }
                        401 -> {
                            if (sameCredential()) MobileCredentials.clear(applicationContext)
                            return@withContext Result.failure()
                        }
                        else -> return@withContext Result.retry()
                    }
                }
            }
            if (chunks.size >= 20 && db.getChunksToUpload(ownerUserId, 1).isNotEmpty()) return@withContext Result.retry()

            var waitingForTranscription = false
            for (sessionId in db.getSyncSessionIds(ownerUserId)) {
                if (!sameCredential()) return@withContext Result.success()
                if (!db.isSessionFullyUploaded(sessionId)) continue
                if (db.needsCompletion(sessionId)) {
                    if (!forceTranscription && !SyncPreferences.autoTranscribe(applicationContext)) continue
                    api.complete(sessionId, db.getSessionStatus(sessionId) == "partial", ownerUserId)
                    if (!sameCredential()) return@withContext Result.success()
                    db.markCompletionSent(sessionId)
                }
                val result = api.transcript(sessionId, ownerUserId)
                if (!sameCredential()) return@withContext Result.success()
                val status = result.optString("status")
                val progress = result.optJSONObject("progress")
                val done = progress?.optInt("done") ?: 0
                val total = progress?.optInt("total") ?: 0
                when (status) {
                    "ready" -> {
                        val parsedTurns = mutableListOf<Turn>()
                        val turns = result.optJSONArray("turns")
                        if (turns != null) for (index in 0 until turns.length()) {
                            val turn = turns.optJSONObject(index) ?: continue
                            val text = turn.optString("text").trim()
                            val spokenAt = turn.optString("start_at").takeIf { it.isNotBlank() && it != "null" }
                                ?.let { runCatching { java.time.Instant.parse(it).toEpochMilli() }.getOrNull() }
                            if (text.isNotEmpty()) parsedTurns.add(Turn(
                                sessionId = sessionId, speaker = turn.optString("speaker", "unknown"),
                                text = text, timestamp = spokenAt ?: 0L,
                                remoteSegmentId = turn.optLong("id").takeIf { it > 0L }
                            ))
                        }
                        db.updateTranscript(sessionId, "ready", result.optString("text", ""), parsedTurns, done, total)
                        for (turn in parsedTurns) {
                            val segmentId = turn.remoteSegmentId ?: continue
                            if (!sameCredential()) return@withContext Result.success()
                            try {
                                val participantData = api.participantData(sessionId, segmentId, ownerUserId)
                                if (!sameCredential()) return@withContext Result.success()
                                db.saveParticipantData(sessionId, segmentId, ownerUserId, participantData)
                            }
                            catch (_: Exception) { /* Preserve the last cache when the PC is offline. */ }
                        }
                    }
                    "error" -> db.updateTranscript(sessionId, "error", null, emptyList(), done, total)
                    else -> {
                        db.updateTranscript(sessionId, "transcribing", null, emptyList(), done, total)
                        waitingForTranscription = true
                    }
                }
            }
            if (waitingForTranscription) Result.retry() else Result.success()
        } catch (error: MobileApiException) {
            if (error.statusCode == 401) {
                if (sameCredential()) MobileCredentials.clear(applicationContext)
                Result.failure()
            } else Result.retry()
        } catch (_: Exception) {
            Result.retry()
        }
    }
}

object SyncScheduler {
    private fun network(context: Context) = Constraints.Builder()
        .setRequiredNetworkType(if (SyncPreferences.unmeteredOnly(context)) NetworkType.UNMETERED else NetworkType.CONNECTED)
        .build()

    fun start(context: Context) {
        val manager = WorkManager.getInstance(context)
        if (MobileCredentials.get(context) != null && ServerSettings.get(context).isNotBlank()) {
            manager.enqueueUniqueWork(
                "brain-core-memory-reconcile-history", ExistingWorkPolicy.KEEP,
                OneTimeWorkRequestBuilder<SyncWorker>()
                    .setInputData(Data.Builder().putBoolean("reconcile_only", true).build())
                    .setConstraints(network(context)).build()
            )
        }
        if (!SyncPreferences.autoUpload(context) || MobileCredentials.get(context) == null || ServerSettings.get(context).isBlank()) {
            manager.cancelUniqueWork("brain-core-memory-sync-periodic")
            return
        }
        manager.enqueueUniquePeriodicWork(
            "brain-core-memory-sync-periodic", ExistingPeriodicWorkPolicy.UPDATE,
            PeriodicWorkRequestBuilder<SyncWorker>(15, TimeUnit.MINUTES)
                .setConstraints(network(context)).build()
        )
        runAutomatically(context)
    }

    fun runAutomatically(context: Context) {
        if (!SyncPreferences.autoUpload(context)) return
        enqueue(context, manual = false, forceTranscription = false)
    }

    fun runNow(context: Context, forceTranscription: Boolean = false) {
        enqueue(context, manual = true, forceTranscription = forceTranscription)
    }

    private fun enqueue(context: Context, manual: Boolean, forceTranscription: Boolean) {
        if (MobileCredentials.get(context) == null || ServerSettings.get(context).isBlank()) return
        WorkManager.getInstance(context).enqueueUniqueWork(
            "brain-core-memory-sync-now", if (manual) ExistingWorkPolicy.REPLACE else ExistingWorkPolicy.KEEP,
            OneTimeWorkRequestBuilder<SyncWorker>()
                .setInputData(Data.Builder().putBoolean("manual", manual)
                    .putBoolean("force_transcription", forceTranscription).build())
                .setConstraints(network(context)).build()
        )
    }
}
