package com.hebsub.core.text

import com.hebsub.core.subtitle.SubtitleCue
import com.hebsub.core.subtitle.SubtitleTiming

/**
 * Final polish applied to the translated Hebrew cues before they are written to
 * the output track, in this order:
 *
 *  1. **Split** anything longer than two lines into consecutive cues. This has to
 *     come first: wrapping cannot fix a cue that holds four sentences, it can only
 *     decide where to put the overflow, and every choice it has is wrong.
 *  2. **Wrap** each cue into at most two balanced lines.
 *  3. **Give each cue time to be read** — [SubtitleTiming.MAX_CPS] characters per
 *     second, plus a floor for very short replies, taken only from the silence
 *     that follows and never by overlapping the next cue.
 *  4. **Apply the RTL marks** that keep mixed Hebrew/Latin lines in the right order.
 *
 * Kept pure (no I/O) so it is fully unit-testable.
 */
object SubtitlePostProcessor {

    /** Minimum time a cue should stay on screen so short replies remain readable. */
    const val MIN_DURATION_MS = SubtitleTiming.MIN_EVENT_MS

    fun process(
        cues: List<SubtitleCue>,
        maxCharsPerLine: Int = LineWrapper.DEFAULT_MAX_CHARS,
        applyRtl: Boolean = true,
        minDurationMs: Long = MIN_DURATION_MS,
        maxLines: Int = CueSplitter.DEFAULT_MAX_LINES,
    ): List<SubtitleCue> {
        val kept = cues.filter { cue -> cue.lines.any { it.isNotBlank() } }
        val split = CueSplitter.split(kept, maxCharsPerLine, maxLines)
        val wrapped = split.map { it.copy(lines = LineWrapper.wrap(it.text, maxCharsPerLine)) }
        val readable = SubtitleTiming.ensureReadingSpeed(wrapped)
        val timed = SubtitleTiming.ensureMinimumDuration(readable, minDurationMs)
        // Last, so nothing above can reintroduce one: a cue must be gone before the
        // next appears, or the renderer stacks them.
        val separated = SubtitleTiming.removeOverlaps(timed)
        val out = if (applyRtl) separated.map { RtlFormatter.applyToCue(it) } else separated
        return out.mapIndexed { i, cue -> cue.copy(index = i + 1) }
    }
}
