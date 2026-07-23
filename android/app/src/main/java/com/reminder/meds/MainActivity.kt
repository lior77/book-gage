package com.reminder.meds

import android.Manifest
import android.app.AlarmManager
import android.app.TimePickerDialog
import android.content.Context
import android.content.DialogInterface
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.widget.Button
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import java.util.Calendar

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
        promptTestTimeThenEnable()
    }

    /**
     * Every time the app is enabled, offer to pick one extra "test" time so the user can verify the
     * app works without waiting for a fixed time. Picking a time enables the reminders and schedules
     * the one-off test; "דלג" (skip) just enables the four fixed reminders.
     */
    private fun promptTestTimeThenEnable() {
        // Default the picker to two minutes from now — a convenient near-future test time.
        val now = Calendar.getInstance().apply { add(Calendar.MINUTE, 2) }
        val dialog = TimePickerDialog(
            this,
            { _, hour, minute ->
                enableReminders()
                AlarmScheduler.scheduleTest(this, hour, minute)
                val time = String.format("%02d:%02d", hour, minute)
                Toast.makeText(
                    this,
                    getString(R.string.test_scheduled, time),
                    Toast.LENGTH_LONG
                ).show()
            },
            now.get(Calendar.HOUR_OF_DAY),
            now.get(Calendar.MINUTE),
            true
        )
        dialog.setTitle(getString(R.string.test_time_title))
        // "דלג" — enable the fixed reminders without a test time.
        dialog.setButton(DialogInterface.BUTTON_NEUTRAL, getString(R.string.skip)) { _, _ ->
            enableReminders()
        }
        // Closing the dialog (back button / tap outside) still enables the fixed reminders.
        dialog.setOnCancelListener { enableReminders() }
        dialog.show()
    }

    private fun enableReminders() {
        // Guard against the dialog callbacks enabling twice.
        if (!Prefs.isEnabled(this)) {
            Prefs.setEnabled(this, true)
            AlarmScheduler.scheduleAll(this)
            updateButtonLabel()
        }
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
