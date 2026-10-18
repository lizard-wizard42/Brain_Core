package com.example.braincore
import com.example.braincore.notifications.ReminderTime
import org.junit.Assert.*
import org.junit.Test
import java.time.*
class ReminderTimeTest {
    private val zone = ZoneId.of("America/Sao_Paulo")
    private fun instant(value: String) = Instant.parse(value).toEpochMilli()
    @Test fun localTimeAndDefaultMorning() {
        assertEquals(instant("2026-10-18T12:00:00Z"), ReminderTime.next("2026-10-18", "", false, instant("2026-10-18T10:00:00Z"), zone))
    }
    @Test fun expiredOneShotIsNotRepeated() {
        assertNull(ReminderTime.next("2026-10-17", "09:00", false, instant("2026-10-18T10:00:00Z"), zone))
    }
    @Test fun dailyMovesToTomorrowAndFutureStartIsRespected() {
        assertEquals(instant("2026-10-19T12:00:00Z"), ReminderTime.next("2026-10-01", "09:00", true, instant("2026-10-18T13:00:00Z"), zone))
        assertEquals(instant("2026-11-01T12:00:00Z"), ReminderTime.next("2026-11-01", "09:00", true, instant("2026-10-18T13:00:00Z"), zone))
    }
    @Test fun invalidDateIsIgnoredAndDstGapUsesZoneRules() {
        assertNull(ReminderTime.next("null", "09:00", true, 0, zone))
        assertEquals(instant("2026-03-08T07:30:00Z"), ReminderTime.next("2026-03-08", "02:30", false, instant("2026-03-08T00:00:00Z"), ZoneId.of("America/New_York")))
    }
}
