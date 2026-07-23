package com.reminder.meds

import android.app.KeyguardManager
import android.content.Context
import android.media.AudioManager
import android.media.ToneGenerator
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator
import android.view.WindowManager
import android.widget.Button
import androidx.appcompat.app.AppCompatActivity

/**
 * Full-screen "alarm going off" screen. It wakes the screen, plays a distinct three-second
 * tone (different from the normal ringtone, on the ALARM stream so it sounds even in silent mode),
 * and shows the big "תרופות" button. Pressing the button stops the sound, cancels the pending
 * nudge, and closes the screen.
 */
class AlarmActivity : AppCompatActivity() {

    private var slot: Int = -1
    private var toneGenerator: ToneGenerator? = null
    private var vibrator: Vibrator? = null
    private val handler = Handler(Looper.getMainLooper())
    private var beepCount = 0

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        showWhenLockedAndTurnScreenOn()
        setContentView(R.layout.activity_alarm)

        slot = intent.getIntExtra(EXTRA_SLOT, -1)

        findViewById<Button>(R.id.medsButton).setOnClickListener { onTaken() }

        startAlarm()
    }

    override fun onNewIntent(intent: android.content.Intent?) {
        super.onNewIntent(intent)
        // A nudge re-launched the screen while it was already open — restart the tone.
        setIntent(intent)
        slot = intent?.getIntExtra(EXTRA_SLOT, slot) ?: slot
        startAlarm()
    }

    /** The user took their medication: stop everything for this reminder. */
    private fun onTaken() {
        AlarmScheduler.cancelSnooze(this, slot)
        AlarmNotifier.cancel(this, slot)
        stopAlarm()
        finish()
    }

    private fun startAlarm() {
        stopAlarm() // reset any previous run (e.g. from onNewIntent)

        // Distinct alarm tone on the ALARM stream (heard even when the ringer is silenced).
        toneGenerator = ToneGenerator(AudioManager.STREAM_ALARM, ToneGenerator.MAX_VOLUME)
        beepCount = 0
        handler.post(beepRunnable)

        // Accompany it with vibration for the same three seconds.
        vibrateForSound()
    }

    private val beepRunnable = object : Runnable {
        override fun run() {
            // 6 beeps, 500 ms apart ≈ 3 seconds total.
            if (beepCount >= 6) {
                stopTone()
                return
            }
            val tone = if (beepCount % 2 == 0) {
                ToneGenerator.TONE_CDMA_HIGH_L
            } else {
                ToneGenerator.TONE_CDMA_MED_L
            }
            toneGenerator?.startTone(tone, 250)
            beepCount++
            handler.postDelayed(this, 500)
        }
    }

    private fun vibrateForSound() {
        val vib = getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator ?: return
        vibrator = vib
        // Buzz-pause pattern for ~3 seconds.
        val pattern = longArrayOf(0, 500, 300, 500, 300, 500, 300)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            vib.vibrate(VibrationEffect.createWaveform(pattern, -1))
        } else {
            @Suppress("DEPRECATION")
            vib.vibrate(pattern, -1)
        }
    }

    private fun stopTone() {
        handler.removeCallbacks(beepRunnable)
        try {
            toneGenerator?.stopTone()
        } catch (_: Exception) {
        }
        toneGenerator?.release()
        toneGenerator = null
    }

    private fun stopAlarm() {
        stopTone()
        vibrator?.cancel()
        vibrator = null
    }

    private fun showWhenLockedAndTurnScreenOn() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
            (getSystemService(Context.KEYGUARD_SERVICE) as? KeyguardManager)
                ?.requestDismissKeyguard(this, null)
        } else {
            @Suppress("DEPRECATION")
            window.addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                    WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
                    WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD
            )
        }
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }

    override fun onDestroy() {
        super.onDestroy()
        stopAlarm()
    }
}
