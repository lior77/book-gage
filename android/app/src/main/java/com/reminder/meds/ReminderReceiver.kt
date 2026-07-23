package com.reminder.meds

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat

/**
 * Fired by AlarmManager at each scheduled time and for each nudge.
 *
 *  - On the initial ring it re-arms the same daily time for tomorrow.
 *  - It shows the full-screen reminder (which plays the sound and shows the "תרופות" button).
 *  - It schedules the next nudge, up to [MAX_SNOOZE] times.
 */
class ReminderReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        // If the user turned the app off, ignore any alarm that was already in flight.
        if (!Prefs.isEnabled(context)) return

        val slot = intent.getIntExtra(EXTRA_SLOT, -1)
        val snoozeCount = intent.getIntExtra(EXTRA_SNOOZE_COUNT, 0)

        val isFixed = slot in AlarmScheduler.TIMES.indices
        val isTest = slot == TEST_SLOT

        // Only a fixed daily reminder re-arms itself for the next day on its initial ring.
        // The test reminder is one-off, so it is never rescheduled.
        if (snoozeCount == 0 && isFixed) {
            AlarmScheduler.scheduleDaily(context, slot)
        }

        // Start the foreground service: it rings immediately AND posts the full-screen
        // notification that opens the "תרופות" screen — the sound no longer depends on the
        // notification being opened by hand.
        val serviceIntent = Intent(context, AlarmService::class.java).apply {
            putExtra(EXTRA_SLOT, slot)
            putExtra(EXTRA_SNOOZE_COUNT, snoozeCount)
        }
        try {
            ContextCompat.startForegroundService(context, serviceIntent)
        } catch (e: Exception) {
            // Very rare (e.g. a foreground-service start restriction): fall back to posting the
            // full-screen notification directly so the reminder still appears.
            try {
                NotificationManagerCompat.from(context)
                    .notify(AlarmNotifier.notifId(slot), AlarmNotifier.buildAlarmNotification(context, slot))
            } catch (_: Exception) {
            }
        }

        // Schedule the next nudge (one minute later), at most twice — for both fixed and test.
        if (snoozeCount < MAX_SNOOZE && (isFixed || isTest)) {
            AlarmScheduler.scheduleSnooze(context, slot, snoozeCount + 1)
        }
    }
}
