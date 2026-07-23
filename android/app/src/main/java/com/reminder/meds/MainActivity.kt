package com.reminder.meds

import android.Manifest
import android.app.AlarmManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.widget.Button
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat

/**
 * The single home screen: one big button that turns the reminder on ("הפעל") and off ("כבה").
 */
class MainActivity : AppCompatActivity() {

    private lateinit var toggleButton: Button

    private val requestNotifPermission =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) {
            // Whatever the user chose, continue enabling — the full-screen alarm still works.
            proceedEnable()
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        toggleButton = findViewById(R.id.toggleButton)
        toggleButton.setOnClickListener { onToggleClicked() }
    }

    override fun onResume() {
        super.onResume()
        updateButtonLabel()
    }

    private fun onToggleClicked() {
        if (Prefs.isEnabled(this)) {
            // Turn off.
            Prefs.setEnabled(this, false)
            AlarmScheduler.cancelAll(this)
            updateButtonLabel()
        } else {
            // Turn on — make sure we can post notifications first (asks at runtime on Android 13+).
            if (!ensureNotificationPermission()) return
            proceedEnable()
        }
    }

    /** Runs after the notifications permission step: request the remaining permissions, then arm. */
    private fun proceedEnable() {
        ensureExactAlarmPermission()
        ensureBatteryUnrestricted()
        enableReminders()
    }

    private fun enableReminders() {
        Prefs.setEnabled(this, true)
        AlarmScheduler.scheduleAll(this)
        updateButtonLabel()
    }

    private fun updateButtonLabel() {
        toggleButton.text = if (Prefs.isEnabled(this)) {
            getString(R.string.turn_off)
        } else {
            getString(R.string.turn_on)
        }
    }

    /** Returns true if we already have (or don't need) the notifications permission. */
    private fun ensureNotificationPermission(): Boolean {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            val granted = ContextCompat.checkSelfPermission(
                this, Manifest.permission.POST_NOTIFICATIONS
            ) == PackageManager.PERMISSION_GRANTED
            if (!granted) {
                requestNotifPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
                return false // enabling continues from the permission callback
            }
        }
        return true
    }

    /** On Android 12+, send the user to settings if exact alarms are not allowed. */
    private fun ensureExactAlarmPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val am = getSystemService(Context.ALARM_SERVICE) as AlarmManager
            if (!am.canScheduleExactAlarms()) {
                try {
                    startActivity(
                        Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM).apply {
                            data = Uri.parse("package:$packageName")
                        }
                    )
                } catch (_: Exception) {
                    // If the settings screen is unavailable, the scheduler falls back to inexact alarms.
                }
            }
        }
    }

    /**
     * On first enable, ask Android to exempt this app from battery optimization. On Samsung this
     * keeps the app out of "deep sleep" so the alarms are not delayed or blocked in the background.
     * Shows the system allow/deny dialog only if we are not already exempt.
     */
    private fun ensureBatteryUnrestricted() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
            if (!pm.isIgnoringBatteryOptimizations(packageName)) {
                try {
                    @android.annotation.SuppressLint("BatteryLife")
                    val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                        data = Uri.parse("package:$packageName")
                    }
                    startActivity(intent)
                } catch (_: Exception) {
                    // Dialog unavailable on this device — the manual settings path still works.
                }
            }
        }
    }
}
