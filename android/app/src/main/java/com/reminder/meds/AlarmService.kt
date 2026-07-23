package com.reminder.meds

import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioManager
import android.media.ToneGenerator
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator

/**
 * Foreground service that actually RINGS at the scheduled time — it plays the distinct alarm tone
 * and vibrates the instant the reminder fires, independent of whether the full-screen alarm screen
 * manages to launch. This is what guarantees the sound is heard without the user having to pull down
 * the notification shade and tap the notification.
 *
 * It also posts the full-screen notification (which opens [AlarmActivity] with the "תרופות" button).
 * After the ring finishes it detaches the notification and stops, leaving the notification in place
 * so the user can still open the button screen.
 */
class AlarmService : Service() {

    private var toneGenerator: ToneGenerator? = null
    private var vibrator: Vibrator? = null
    private val handler = Handler(Looper.getMainLooper())
    private var beepCount = 0

    // Number of beeps that fill SOUND_DURATION_MS (e.g. 6000 / 500 = 12 beeps ≈ 6 seconds).
    private val totalBeeps = (SOUND_DURATION_MS / BEEP_INTERVAL_MS).toInt()

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val slot = intent?.getIntExtra(EXTRA_SLOT, -1) ?: -1
        val notification = AlarmNotifier.buildAlarmNotification(this, slot)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                AlarmNotifier.notifId(slot),
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
            )
        } else {
            startForeground(AlarmNotifier.notifId(slot), notification)
        }

        startSound()
        launchAlarmScreen(slot)
        return START_NOT_STICKY
    }

    /**
     * Try to open the full-screen alarm screen directly. With the "display over other apps"
     * permission (or a locked screen) this launches even while the phone is in use, so the screen
     * appears on its own instead of only after tapping the notification. The full-screen-intent
     * notification remains as a fallback if the direct start is blocked.
     */
    private fun launchAlarmScreen(slot: Int) {
        val activityIntent = Intent(this, AlarmActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            putExtra(EXTRA_SLOT, slot)
        }
        try {
            startActivity(activityIntent)
        } catch (_: Exception) {
            // Background-activity-start blocked (no overlay permission and screen unlocked) —
            // the full-screen-intent notification still provides the entry point.
        }
    }

    private fun startSound() {
        stopSoundOnly()
        toneGenerator = try {
            ToneGenerator(AudioManager.STREAM_ALARM, ToneGenerator.MAX_VOLUME)
        } catch (_: RuntimeException) {
            null // very rare; vibration + notification still happen
        }
        beepCount = 0
        handler.post(beepRunnable)
        vibrate()
    }

    private val beepRunnable = object : Runnable {
        override fun run() {
            if (beepCount >= totalBeeps) {
                // Ring finished: stop the sound but keep the notification so the button stays reachable.
                stopSoundOnly()
                detachAndStop()
                return
            }
            val tone = if (beepCount % 2 == 0) {
                ToneGenerator.TONE_CDMA_HIGH_L
            } else {
                ToneGenerator.TONE_CDMA_MED_L
            }
            toneGenerator?.startTone(tone, 250)
            beepCount++
            handler.postDelayed(this, BEEP_INTERVAL_MS)
        }
    }

    private fun vibrate() {
        val vib = getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator ?: return
        vibrator = vib
        val pattern = ArrayList<Long>().apply {
            add(0L)
            repeat(totalBeeps) {
                add(500L)
                add(300L)
            }
        }.toLongArray()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            vib.vibrate(VibrationEffect.createWaveform(pattern, -1))
        } else {
            @Suppress("DEPRECATION")
            vib.vibrate(pattern, -1)
        }
    }

    private fun detachAndStop() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            stopForeground(STOP_FOREGROUND_DETACH)
        } else {
            @Suppress("DEPRECATION")
            stopForeground(false)
        }
        stopSelf()
    }

    private fun stopSoundOnly() {
        handler.removeCallbacks(beepRunnable)
        try {
            toneGenerator?.stopTone()
        } catch (_: Exception) {
        }
        toneGenerator?.release()
        toneGenerator = null
        vibrator?.cancel()
        vibrator = null
    }

    override fun onDestroy() {
        super.onDestroy()
        stopSoundOnly()
    }
}
