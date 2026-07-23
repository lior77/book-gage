package com.reminder.meds

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

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

        // Only the initial ring (not a nudge) re-arms the daily schedule for the next day.
        if (snoozeCount == 0 && slot in AlarmScheduler.TIMES.indices) {
            AlarmScheduler.scheduleDaily(context, slot)
        }

        // Ring + show the "תרופות" button.
        AlarmNotifier.showReminder(context, slot)

        // Schedule the next nudge (two minutes later), at most twice.
        if (snoozeCount < MAX_SNOOZE && slot in AlarmScheduler.TIMES.indices) {
            AlarmScheduler.scheduleSnooze(context, slot, snoozeCount + 1)
        }
    }
}
