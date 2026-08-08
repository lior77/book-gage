package com.hebsub.core.text

import com.hebsub.core.subtitle.SubtitleCue

/**
 * Ensures Hebrew subtitle lines render right-to-left in players that default to
 * left-to-right paragraph direction.
 *
 * Strategy: for any line containing a Hebrew character, wrap it in a Unicode
 * right-to-left embedding — RLE (U+202B) … PDF (U+202C). This forces the base
 * direction of the whole line to RTL while still letting embedded Latin/number
 * runs (e.g. "iPhone 15") display in their natural LTR order via the Unicode
 * Bidirectional Algorithm. Lines with no Hebrew are left untouched so mixed
 * tracks are safe.
 *
 * We deliberately do NOT reorder characters ourselves — that is the player's
 * job and doing it here would double-flip on correct players.
 */
object RtlFormatter {

    private const val RLE = '‫' // RIGHT-TO-LEFT EMBEDDING
    private const val PDF = '‬' // POP DIRECTIONAL FORMATTING

    private fun containsHebrew(s: String): Boolean = s.any { it in '֐'..'׿' }

    private fun alreadyWrapped(s: String): Boolean =
        s.startsWith(RLE) && s.endsWith(PDF)

    fun applyToLine(line: String): String {
        if (line.isBlank() || !containsHebrew(line) || alreadyWrapped(line)) return line
        return "$RLE$line$PDF"
    }

    fun applyToCue(cue: SubtitleCue): SubtitleCue =
        cue.copy(lines = cue.lines.map { applyToLine(it) })

    fun applyToCues(cues: List<SubtitleCue>): List<SubtitleCue> =
        cues.map { applyToCue(it) }
}
