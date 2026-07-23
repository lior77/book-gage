package com.reminder.meds

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** After a reboot, re-arm the schedule if the reminder was left turned on. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action
        if (action == Intent.ACTION_BOOT_COMPLETED ||
            action == Intent.ACTION_LOCKED_BOOT_COMPLETED
        ) {
            if (Prefs.isEnabled(context)) {
                AlarmScheduler.scheduleAll(context)
            }
        }
    }
}
