package com.example.braincore.notifications

import android.Manifest
import android.app.*
import android.content.*
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.example.braincore.MainActivity
import com.example.braincore.R
import com.example.braincore.data.MobileCredentials

object NativeNotifications {
    const val REMINDERS = "brain_core_reminders"
    const val TRANSCRIPTS = "brain_core_transcripts"
    fun channels(context: Context) {
        if (Build.VERSION.SDK_INT >= 26) context.getSystemService(NotificationManager::class.java).createNotificationChannels(listOf(
            NotificationChannel(REMINDERS, "Lembretes de Notas", NotificationManager.IMPORTANCE_DEFAULT),
            NotificationChannel(TRANSCRIPTS, "Transcrições prontas", NotificationManager.IMPORTANCE_DEFAULT)
        ))
    }
    fun enabled(context: Context): Boolean = NotificationManagerCompat.from(context).areNotificationsEnabled() &&
        (Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED)

    fun show(context: Context, channel: String, key: String, title: String, text: String, route: String, owner: String? = null): Boolean {
        if (!enabled(context) || (owner != null && MobileCredentials.userId(context) != owner)) return false
        channels(context)
        val intent = Intent(context, MainActivity::class.java).apply {
            data = Uri.parse("braincore://notification/${Uri.encode(key)}")
            putExtra("notification_route", route)
            putExtra("notification_owner", owner)
            flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
        }
        val content = PendingIntent.getActivity(context, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val notification = NotificationCompat.Builder(context, channel)
            .setSmallIcon(R.drawable.ic_notification_brain_core)
            .setContentTitle(title).setContentText(text).setContentIntent(content)
            .setAutoCancel(true).setOnlyAlertOnce(true).setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setCategory(if (channel == REMINDERS) NotificationCompat.CATEGORY_REMINDER else NotificationCompat.CATEGORY_STATUS)
            .build()
        return try { NotificationManagerCompat.from(context).notify(key, 0, notification); true } catch (_: SecurityException) { false }
    }
    fun settings(context: Context) {
        val intent = if (Build.VERSION.SDK_INT >= 26) {
            Intent(android.provider.Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                .putExtra(android.provider.Settings.EXTRA_APP_PACKAGE, context.packageName)
        } else Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${context.packageName}"))
        context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
    fun test(context: Context): Boolean = show(context, REMINDERS, "test", "Brain Core", "As notificações estão funcionando neste aparelho.", "/notes")
}
