package com.example.braincore

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.os.Build
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import com.example.braincore.data.BrainCoreDatabase
import com.example.braincore.data.SyncScheduler
import com.example.braincore.data.AudioRetentionScheduler

class BrainCoreApp : Application() {

    val database: BrainCoreDatabase by lazy { BrainCoreDatabase.getInstance(this) }
    private val applicationScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        // Database recovery may inspect audio files; never delay the first frame for it.
        applicationScope.launch {
            database
            SyncScheduler.start(this@BrainCoreApp)
            AudioRetentionScheduler.update(this@BrainCoreApp)
        }
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Brain Core Gravador",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Notificação persistente durante a gravação da Linha do Tempo"
                setShowBadge(false)
            }
            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(channel)
        }
    }

    companion object {
        const val CHANNEL_ID = "brain_core_recording_channel"
        const val NOTIFICATION_ID = 1001
    }
}
