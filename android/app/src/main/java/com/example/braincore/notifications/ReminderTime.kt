package com.example.braincore.notifications

import java.time.*

object ReminderTime {
    fun next(date: String, time: String, daily: Boolean, now: Long, zone: ZoneId = ZoneId.systemDefault()): Long? = runCatching {
        val first = LocalDate.parse(date)
        val clock = LocalTime.parse(time.ifBlank { "09:00" }.take(5))
        val today = Instant.ofEpochMilli(now).atZone(zone).toLocalDate()
        var day = if (daily && today.isAfter(first)) today else first
        var at = day.atTime(clock).atZone(zone).toInstant().toEpochMilli()
        if (at <= now && daily) { day = day.plusDays(1); at = day.atTime(clock).atZone(zone).toInstant().toEpochMilli() }
        if (at <= now) null else at
    }.getOrNull()
}
