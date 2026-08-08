package com.hebsub.core.text

import com.hebsub.core.subtitle.SubtitleCue

/**
 * Final polish applied to the translated Hebrew cues before they are written to
 * the output track: normalise whitespace, re-wrap to at most two balanced
 * lines, enforce a minimum on-screen duration, and apply RTL marks.
 *
 * Kept pure (no I/O) so it is fully unit-testable.
 */
object SubtitlePostProcessor {

    /** Minimum time a cue should stay on screen so short replies remain readable. */
    const val MIN_DURATION_MS = 800L

    fun process(
        cues: List<SubtitleCue>,
        maxCharsPerLine: Int = LineWrapper.DEFAULT_MAX_CHARS,
        applyRtl: Boolean = true,
        minDurationMs: Long = MIN_DURATION_MS,
    ): List<SubtitleCue> {
        return cues
            .asSequence()
            .filter { it.lines.any { l -> l.isNotBlank() } }
            .map { cue ->
                val wrapped = LineWrapper.wrap(cue.text, maxCharsPerLine)
                var out = cue.copy(lines = wrapped)
                if (out.durationMs < minDurationMs) {
                    out = out.copy(endMs = out.startMs + minDurationMs)
                }
                if (applyRtl) out = RtlFormatter.applyToCue(out) else out
                out
            }
            .mapIndexed { i, cue -> cue.copy(index = i + 1) }
            .toList()
    }
}
