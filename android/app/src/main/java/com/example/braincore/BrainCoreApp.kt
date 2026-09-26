package com.example.braincore

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.os.Build
import com.example.braincore.data.BrainCoreDatabase
import com.example.braincore.data.SyncScheduler
import com.example.braincore.data.AudioRetentionScheduler

class BrainCoreApp : Application() {

    lateinit var database: BrainCoreDatabase
        private set

    override fun onCreate() {
        super.onCreate()
        database = BrainCoreDatabase.getInstance(this)
        createNotificationChannel()
        SyncScheduler.start(this)
        AudioRetentionScheduler.update(this)
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
