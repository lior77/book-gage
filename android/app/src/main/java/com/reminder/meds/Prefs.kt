package com.reminder.meds

import android.content.Context

/** Stores whether the reminder is currently turned on, so the state survives app restarts and reboots. */
object Prefs {
    private const val NAME = "med_prefs"
    private const val KEY_ENABLED = "enabled"

    private fun sp(context: Context) =
        context.getSharedPreferences(NAME, Context.MODE_PRIVATE)

    fun isEnabled(context: Context): Boolean =
        sp(context).getBoolean(KEY_ENABLED, false)

    fun setEnabled(context: Context, enabled: Boolean) {
        sp(context).edit().putBoolean(KEY_ENABLED, enabled).apply()
    }
}
