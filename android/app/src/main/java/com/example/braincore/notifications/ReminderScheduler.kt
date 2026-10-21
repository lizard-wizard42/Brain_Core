package com.example.braincore.notifications

import android.app.*
import android.content.*
import android.net.Uri
import androidx.work.*
import com.example.braincore.data.MobileApi
import com.example.braincore.data.MobileApiException
import com.example.braincore.data.MobileCredentials
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

object ReminderScheduler {
    private fun prefs(c: Context) = c.getSharedPreferences("native_reminders", Context.MODE_PRIVATE)
    private fun alarm(c: Context, id: String): PendingIntent = PendingIntent.getBroadcast(c, 0,
        Intent(c, ReminderReceiver::class.java).setData(Uri.parse("braincore://reminder/$id")),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    @Synchronized fun clear(c: Context) {
        val manager = c.getSystemService(AlarmManager::class.java)
        for (id in prefs(c).all.keys) manager.cancel(alarm(c, id))
        prefs(c).edit().clear().apply()
        // Remove account-specific notifications when the device is unlinked or switched.
        c.getSystemService(NotificationManager::class.java).activeNotifications
            .filter { it.tag?.startsWith("reminder:") == true || it.tag?.startsWith("transcript:") == true || it.tag == "test" }
            .forEach { c.getSystemService(NotificationManager::class.java).cancel(it.tag, it.id) }
    }
    @Synchronized fun sync(c: Context, owner: String, notes: JSONArray) {
        if (MobileCredentials.userId(c) != owner) return
        val keep = mutableSetOf<String>()
        val now = System.currentTimeMillis()
        for (i in 0 until notes.length()) {
            val n = notes.getJSONObject(i)
            val id = n.getString("id")
            val date = n.optString("reminder_date")
            val time = n.optString("reminder_time").takeUnless { it == "null" }.orEmpty()
            val daily = n.optBoolean("reminder_repeat_daily")
            val old = prefs(c).getString(id, null)?.let { runCatching { JSONObject(it) }.getOrNull() }
            if (old != null && old.optString("owner") == owner && old.optString("date") == date &&
                old.optString("time") == time && old.optBoolean("daily") == daily) {
                keep.add(id); continue
            }
            val at = ReminderTime.next(date, time, daily, now) ?: continue
            keep.add(id)
            val value = JSONObject().put("owner", owner).put("date", date).put("time", time).put("daily", daily).put("at", at)
            if (prefs(c).getString(id, null) != value.toString()) {
                prefs(c).edit().putString(id, value.toString()).apply()
                schedule(c, id, at)
            }
        }
        for (id in prefs(c).all.keys - keep) {
            c.getSystemService(AlarmManager::class.java).cancel(alarm(c, id))
            prefs(c).edit().remove(id).apply()
        }
    }
    private fun schedule(c: Context, id: String, at: Long) {
        c.getSystemService(AlarmManager::class.java).setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, alarm(c, id))
    }
    @Synchronized fun restore(c: Context) {
        for ((id, raw) in prefs(c).all) {
            val n = runCatching { JSONObject(raw as String) }.getOrNull() ?: continue
            if (n.optString("owner") != MobileCredentials.userId(c)) continue
            val now = System.currentTimeMillis()
            val previous = n.optLong("at")
            // Recover a pending recent alarm after reboot/force-stop instead of silently skipping it.
            val at = if (previous <= now && now - previous < TimeUnit.DAYS.toMillis(1)) now + 1000
                else ReminderTime.next(n.getString("date"), n.optString("time"), n.optBoolean("daily"), now) ?: continue
            n.put("at", at); prefs(c).edit().putString(id, n.toString()).apply(); schedule(c, id, at)
        }
    }
    @Synchronized fun deliver(c: Context, id: String) {
        val raw = prefs(c).getString(id, null) ?: return
        val n = JSONObject(raw)
        if (n.getString("owner") != MobileCredentials.userId(c)) return
        // Ignore a stale broadcast after the reminder was moved into the future.
        if (n.getLong("at") > System.currentTimeMillis() + 1000) return
        NativeNotifications.show(c, NativeNotifications.REMINDERS, "reminder:$id", "Lembrete do Brain Core", "Você tem um lembrete em Notas.", "/notes", n.getString("owner"))
        if (n.optBoolean("daily")) {
            val at = ReminderTime.next(n.getString("date"), n.optString("time"), true, System.currentTimeMillis() + 1000) ?: return
            n.put("at", at); prefs(c).edit().putString(id, n.toString()).apply(); schedule(c, id, at)
        } else prefs(c).edit().remove(id).apply()
    }
    fun start(c: Context) {
        NativeNotifications.channels(c)
        if (MobileCredentials.get(c) == null) return
        restore(c)
        val constraints = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
        val manager = WorkManager.getInstance(c)
        manager.enqueueUniquePeriodicWork("brain-core-reminders", ExistingPeriodicWorkPolicy.KEEP,
            PeriodicWorkRequestBuilder<ReminderSyncWorker>(15, TimeUnit.MINUTES).setConstraints(constraints).build())
        manager.enqueueUniqueWork("brain-core-reminders-now", ExistingWorkPolicy.KEEP,
            OneTimeWorkRequestBuilder<ReminderSyncWorker>().setConstraints(constraints).build())
    }
}
class ReminderReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        intent.data?.lastPathSegment?.let { ReminderScheduler.deliver(context, it) }
    }
}
class ReminderRestoreReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        ReminderScheduler.restore(context)
        ReminderScheduler.start(context)
    }
}
class ReminderSyncWorker(c: Context, p: WorkerParameters) : CoroutineWorker(c, p) {
    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val owner = MobileCredentials.userId(applicationContext) ?: return@withContext Result.success()
        val token = MobileCredentials.get(applicationContext) ?: return@withContext Result.success()
        try {
            val notes = MobileApi(applicationContext).reminders()
            if (MobileCredentials.get(applicationContext) == token) ReminderScheduler.sync(applicationContext, owner, notes)
            Result.success()
        } catch (e: MobileApiException) {
            if (e.statusCode == 401 && MobileCredentials.get(applicationContext) == token) {
                MobileCredentials.clear(applicationContext); Result.failure()
            } else Result.retry()
        } catch (_: Exception) { Result.retry() }
    }
}
