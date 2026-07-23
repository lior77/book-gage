package com.reminder.meds

/** Broadcast action for a medication reminder (initial ring or a snooze/"nudge"). */
const val ACTION_REMIND = "com.reminder.meds.ACTION_REMIND"

/** Which of the four daily times fired (0..3). */
const val EXTRA_SLOT = "extra_slot"

/** How many snoozes ("nudges") have happened for this reminder so far. */
const val EXTRA_SNOOZE_COUNT = "extra_snooze_count"

/** Notification channel used for the alarm. */
const val CHANNEL_ID = "med_reminder_alarm_channel"

/** The nudge repeats at most twice. */
const val MAX_SNOOZE = 2

/** Two minutes between the ring and each nudge. */
const val SNOOZE_DELAY_MS = 2L * 60L * 1000L

/** Each ring lasts three seconds. */
const val SOUND_DURATION_MS = 3000L
