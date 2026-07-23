package com.reminder.meds

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

/**
 * Builds the high-priority, full-screen "alarm" notification that launches [AlarmActivity].
 * The notification is posted by [AlarmService] via startForeground, so the tone (played by the
 * service) and the full-screen screen appear together the instant the reminder fires.
 */
object AlarmNotifier {

    private const val NOTIF_ID_BASE = 1000

    fun notifId(slot: Int) = NOTIF_ID_BASE + slot

    /** Build the alarm notification (and create its channel). */
    fun buildAlarmNotification(context: Context, slot: Int): Notification {
        createChannel(context)

        val fullScreenIntent = Intent(context, AlarmActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra(EXTRA_SLOT, slot)
        }
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or
            (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0)
        val fullScreenPi = PendingIntent.getActivity(context, 2000 + slot, fullScreenIntent, flags)

        return NotificationCompat.Builder(context, CHANNEL_ID)
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
                    // The tone is played by AlarmService, so keep the channel itself silent
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
