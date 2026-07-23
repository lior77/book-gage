package com.reminder.meds

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import java.util.Calendar

/**
 * Owns all interaction with [AlarmManager]: the four fixed daily times and the snooze ("nudge") alarms.
 */
object AlarmScheduler {

    /** The four daily reminder times: 07:30, 13:00, 17:00, 22:00. */
    val TIMES: List<Pair<Int, Int>> = listOf(
        7 to 30,
        13 to 0,
        17 to 0,
        22 to 0
    )

    private const val REQ_DAILY_BASE = 0     // request codes 0..3
    private const val REQ_SNOOZE_BASE = 100  // request codes 100..103

    private fun alarmManager(context: Context) =
        context.getSystemService(Context.ALARM_SERVICE) as AlarmManager

    // ---- Public API -------------------------------------------------------

    /** Arm all four daily reminders. */
    fun scheduleAll(context: Context) {
        for (slot in TIMES.indices) scheduleDaily(context, slot)
    }

    /** Cancel all daily reminders and any pending snooze. */
    fun cancelAll(context: Context) {
        val am = alarmManager(context)
        for (slot in TIMES.indices) {
            am.cancel(dailyPendingIntent(context, slot))
            am.cancel(snoozePendingIntent(context, slot, 0))
        }
    }

    /** Schedule (or re-schedule) the next occurrence of one daily time. */
    fun scheduleDaily(context: Context, slot: Int) {
        val (hour, minute) = TIMES[slot]
        val cal = Calendar.getInstance().apply {
            set(Calendar.HOUR_OF_DAY, hour)
            set(Calendar.MINUTE, minute)
            set(Calendar.SECOND, 0)
            set(Calendar.MILLISECOND, 0)
            // If today's time already passed, move to tomorrow.
            if (timeInMillis <= System.currentTimeMillis()) {
                add(Calendar.DAY_OF_YEAR, 1)
            }
        }
        setExact(context, cal.timeInMillis, dailyPendingIntent(context, slot))
    }

    /** Schedule the next nudge, two minutes from now. */
    fun scheduleSnooze(context: Context, slot: Int, snoozeCount: Int) {
        val triggerAt = System.currentTimeMillis() + SNOOZE_DELAY_MS
        setExact(context, triggerAt, snoozePendingIntent(context, slot, snoozeCount))
    }

    /** Cancel a pending nudge for a slot (called when the user presses "תרופות"). */
    fun cancelSnooze(context: Context, slot: Int) {
        alarmManager(context).cancel(snoozePendingIntent(context, slot, 0))
    }

    // ---- Internals --------------------------------------------------------

    private fun setExact(context: Context, triggerAtMillis: Long, pi: PendingIntent) {
        val am = alarmManager(context)
        try {
            am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAtMillis, pi)
        } catch (e: SecurityException) {
            // Exact-alarm permission not granted — fall back to an inexact alarm so it still fires.
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAtMillis, pi)
        }
    }

    private fun dailyPendingIntent(context: Context, slot: Int): PendingIntent {
        val intent = Intent(context, ReminderReceiver::class.java).apply {
            action = ACTION_REMIND
            putExtra(EXTRA_SLOT, slot)
            putExtra(EXTRA_SNOOZE_COUNT, 0)
        }
        return PendingIntent.getBroadcast(context, REQ_DAILY_BASE + slot, intent, piFlags())
    }

    // Extras are ignored when matching for cancellation, so a fixed request code per slot is enough.
    private fun snoozePendingIntent(context: Context, slot: Int, snoozeCount: Int): PendingIntent {
        val intent = Intent(context, ReminderReceiver::class.java).apply {
            action = ACTION_REMIND
            putExtra(EXTRA_SLOT, slot)
            putExtra(EXTRA_SNOOZE_COUNT, snoozeCount)
        }
        return PendingIntent.getBroadcast(context, REQ_SNOOZE_BASE + slot, intent, piFlags())
    }

    private fun piFlags(): Int {
        var flags = PendingIntent.FLAG_UPDATE_CURRENT
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            flags = flags or PendingIntent.FLAG_IMMUTABLE
        }
        return flags
    }
}
