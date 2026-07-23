package com.reminder.meds

/** Broadcast action for a medication reminder (initial ring or a snooze/"nudge"). */
const val ACTION_REMIND = "com.reminder.meds.ACTION_REMIND"

/** Which of the four daily times fired (0..3), or TEST_SLOT for a one-off test reminder. */
const val EXTRA_SLOT = "extra_slot"

/** Sentinel slot for the optional one-off "test" reminder chosen when enabling the app. */
const val TEST_SLOT = 99

/** How many snoozes ("nudges") have happened for this reminder so far. */
const val EXTRA_SNOOZE_COUNT = "extra_snooze_count"

/** Notification channel used for the alarm. */
const val CHANNEL_ID = "med_reminder_alarm_channel"

/** The nudge repeats at most twice (so at most 3 rings per reminder). */
const val MAX_SNOOZE = 2

/** One minute between the ring and each nudge. */
const val SNOOZE_DELAY_MS = 1L * 60L * 1000L

/** Each ring lasts six seconds. */
const val SOUND_DURATION_MS = 6000L

/** Gap between the short beeps that make up a ring. */
const val BEEP_INTERVAL_MS = 500L
