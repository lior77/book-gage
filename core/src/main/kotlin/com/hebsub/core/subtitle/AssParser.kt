package com.hebsub.core.subtitle

/**
 * Reads the cues out of an ASS/SSA subtitle so it can be re-translated.
 *
 * Only timing and plain text are recovered: override blocks (`{\an8}`,
 * `{\xbord6\ybord4}`, …), the `\N`/`\n` line breaks and `\h` hard spaces are
 * resolved to ordinary text, and any zero-width spacer this app inserts for line
 * spacing is dropped. Malformed lines are skipped rather than throwing.
 */
object AssParser {

    private val OVERRIDE = Regex("""\{[^}]*\}""")

    /** True when [content] looks like an ASS/SSA document rather than SRT/VTT. */
    fun looksLikeAss(content: String): Boolean =
        content.contains("[Script Info]") || content.contains("[V4+ Styles]") ||
            content.contains("[V4 Styles]") || content.lineSequence().any { it.startsWith("Dialogue:") }

    fun parse(content: String): List<SubtitleCue> {
        if (content.isBlank()) return emptyList()
        val out = ArrayList<SubtitleCue>()
        for (raw in content.replace("\r\n", "\n").replace('\r', '\n').lineSequence()) {
            val line = raw.trim()
            if (!line.startsWith("Dialogue:")) continue
            // Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
            val parts = line.removePrefix("Dialogue:").split(',', limit = 10)
            if (parts.size < 10) continue
            val start = parseTime(parts[1]) ?: continue
            val end = parseTime(parts[2]) ?: continue
            val text = OVERRIDE.replace(parts[9], "")
                .replace("\\N", "\n")
                .replace("\\n", "\n")
                .replace("\\h", " ")
                .replace("​", "")
                .trim()
            if (text.isEmpty()) continue
            val lines = text.split('\n').map { it.trim() }.filter { it.isNotEmpty() }
            if (lines.isEmpty()) continue
            out.add(SubtitleCue(0, start, end.coerceAtLeast(start + 1), lines))
        }
        return out.sortedBy { it.startMs }.mapIndexed { i, c -> c.copy(index = i + 1) }
    }

    /** `H:MM:SS.cc` (ASS uses centiseconds) → milliseconds, or null. */
    private fun parseTime(raw: String): Long? {
        val s = raw.trim()
        val hms = s.split(':')
        if (hms.size != 3) return null
        val h = hms[0].trim().toLongOrNull() ?: return null
        val m = hms[1].trim().toLongOrNull() ?: return null
        val secParts = hms[2].trim().split('.', ',')
        val sec = secParts[0].toLongOrNull() ?: return null
        val frac = secParts.getOrNull(1)?.padEnd(3, '0')?.take(3)?.toLongOrNull() ?: 0L
        // ASS fractions are centiseconds; padding to 3 digits makes them millis.
        val millis = if ((secParts.getOrNull(1)?.length ?: 0) <= 2) {
            (secParts.getOrNull(1)?.padEnd(2, '0')?.take(2)?.toLongOrNull() ?: 0L) * 10
        } else frac
        return ((h * 60 + m) * 60 + sec) * 1000 + millis
    }
}
