package com.reminder.meds

import android.app.KeyguardManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import android.widget.Button
import androidx.appcompat.app.AppCompatActivity

/**
 * Full-screen "alarm going off" screen. It wakes the screen and shows the big "תרופות" button.
 * The actual ringing is done by [AlarmService]; pressing the button stops the service (which stops
 * the sound), cancels the pending nudge, removes the notification, and closes the screen.
 */
class AlarmActivity : AppCompatActivity() {

    private var slot: Int = -1

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        showWhenLockedAndTurnScreenOn()
        setContentView(R.layout.activity_alarm)

        slot = intent.getIntExtra(EXTRA_SLOT, -1)
        findViewById<Button>(R.id.medsButton).setOnClickListener { onTaken() }
    }

    override fun onNewIntent(intent: android.content.Intent?) {
        super.onNewIntent(intent)
        setIntent(intent)
        slot = intent?.getIntExtra(EXTRA_SLOT, slot) ?: slot
    }

    /** The user took their medication: stop the ring, cancel the nudge, and dismiss. */
    private fun onTaken() {
        AlarmScheduler.cancelSnooze(this, slot)
        stopService(Intent(this, AlarmService::class.java))
        AlarmNotifier.cancel(this, slot)
        finish()
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
}
