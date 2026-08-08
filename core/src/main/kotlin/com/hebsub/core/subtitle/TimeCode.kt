package com.hebsub.core.subtitle

/**
 * Conversion helpers between milliseconds and the textual timestamp forms used
 * by SRT (`HH:MM:SS,mmm`) and WebVTT (`HH:MM:SS.mmm`).
 *
 * The parser is deliberately lenient: it accepts either `,` or `.` as the
 * millisecond separator, an optional hours field, and 1–3 millisecond digits,
 * because real-world subtitle files are messy. The writer always emits the
 * canonical SRT form.
 */
object TimeCode {

    private val TIMESTAMP = Regex(
        """^\s*(?:(\d+):)?(\d{1,2}):(\d{1,2})[,.](\d{1,3})\s*$"""
    )

    /** Parse a single timestamp to milliseconds, or return null if malformed. */
    fun parseOrNull(text: String): Long? {
        val m = TIMESTAMP.matchEntire(text) ?: return null
        val (h, mm, ss, frac) = m.destructured
        val hours = if (h.isEmpty()) 0L else h.toLong()
        val minutes = mm.toLong()
        val seconds = ss.toLong()
        if (minutes > 59 || seconds > 59) return null
        // Normalise 1–3 digit fractions to milliseconds (e.g. "5" -> 500ms).
        val millis = frac.padEnd(3, '0').take(3).toLong()
        return ((hours * 60 + minutes) * 60 + seconds) * 1000 + millis
    }

    /** Format milliseconds as canonical SRT `HH:MM:SS,mmm`. */
    fun formatSrt(ms: Long): String {
        val clamped = if (ms < 0) 0 else ms
        val millis = clamped % 1000
        val totalSeconds = clamped / 1000
        val seconds = totalSeconds % 60
        val minutes = (totalSeconds / 60) % 60
        val hours = totalSeconds / 3600
        return "%02d:%02d:%02d,%03d".format(hours, minutes, seconds, millis)
    }
}
