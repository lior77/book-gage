package com.reminder.meds

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

/**
 * Posts the high-priority, full-screen "alarm" notification that launches [AlarmActivity].
 * The full-screen intent is what wakes the screen and pops the reminder over the lock screen.
 */
object AlarmNotifier {

    private const val NOTIF_ID_BASE = 1000

    fun notifId(slot: Int) = NOTIF_ID_BASE + slot

    fun showReminder(context: Context, slot: Int) {
        createChannel(context)

        val fullScreenIntent = Intent(context, AlarmActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra(EXTRA_SLOT, slot)
        }
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or
            (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0)
        val fullScreenPi = PendingIntent.getActivity(context, 2000 + slot, fullScreenIntent, flags)

        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_pill)
            .setContentTitle(context.getString(R.string.app_name))
            .setContentText(context.getString(R.string.reminder_text))
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setOngoing(true)
            .setAutoCancel(true)
            .setContentIntent(fullScreenPi)
            .setFullScreenIntent(fullScreenPi, true)
            .build()

        // On Android 13+ the POST_NOTIFICATIONS permission is required; the full-screen
        // intent still fires even if the user declined the visible notification.
        try {
            NotificationManagerCompat.from(context).notify(notifId(slot), notification)
        } catch (_: SecurityException) {
            // Notifications not permitted — the AlarmActivity is still launched via the full-screen intent.
        }
    }

    fun cancel(context: Context, slot: Int) {
        NotificationManagerCompat.from(context).cancel(notifId(slot))
    }

    private fun createChannel(context: Context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            if (nm.getNotificationChannel(CHANNEL_ID) == null) {
                val channel = NotificationChannel(
                    CHANNEL_ID,
                    context.getString(R.string.channel_name),
                    NotificationManager.IMPORTANCE_HIGH
                ).apply {
                    description = context.getString(R.string.channel_desc)
                    // We play our own distinct tone in AlarmActivity, so silence the channel itself
                    // to avoid a second sound on top of it.
                    setSound(null, null)
                    enableVibration(false)
                    setBypassDnd(true)
                }
                nm.createNotificationChannel(channel)
            }
        }
    }
}
