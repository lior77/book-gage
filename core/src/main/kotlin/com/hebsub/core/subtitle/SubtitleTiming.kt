package com.hebsub.core.subtitle

/**
 * Timing adjustments applied to finished Hebrew cues.
 *
 * The rule that governs everything here: **a cue's start time is never moved.**
 * Subtitles must appear at exactly the moment the source says they do — that is
 * what keeps a translated track in step with the audio it came from. Only the
 * END of a cue may be pushed later, and only into silence that already exists
 * before the next cue.
 */
object SubtitleTiming {

    /** Gap left before the next cue so two subtitles never touch or overlap. */
    const val GUARD_MS = 80L

    /**
     * Give every cue at least [minMs] on screen where the dialogue allows it.
     *
     * A cue is extended up to [minMs], but never past the next cue's start minus
     * [GUARD_MS] — so during rapid back-and-forth dialogue nothing changes, and
     * during pauses the line lingers long enough to read. [minMs] of 0 disables
     * the whole thing and returns the cues untouched.
     *
     * The result is in the SAME ORDER as [cues], so callers can compare the two
     * lists position by position; "the next cue" is worked out on a sorted copy,
     * so an out-of-order input still gets the right ceiling.
     */
    fun ensureMinimumDuration(
        cues: List<SubtitleCue>,
        minMs: Long,
        guardMs: Long = GUARD_MS,
    ): List<SubtitleCue> {
        if (minMs <= 0L || cues.isEmpty()) return cues
        // start time → the next later start anywhere in the track (cues that begin
        // together share one answer, which is what "the next cue" means for them).
        val starts = cues.map { it.startMs }.sorted()
        val nextStart = HashMap<Long, Long>(starts.size)
        for (i in 0 until starts.size - 1) {
            if (starts[i] != starts[i + 1]) nextStart[starts[i]] = starts[i + 1]
        }
        return cues.map { cue ->
            val wanted = cue.startMs + minMs
            // The latest we may run to: just before the next cue, or freely at the end.
            val ceiling = nextStart[cue.startMs]?.minus(guardMs) ?: Long.MAX_VALUE
            val end = minOf(maxOf(cue.endMs, wanted), maxOf(ceiling, cue.endMs))
            if (end == cue.endMs) cue else cue.copy(endMs = end)
        }
    }

    /**
     * True when [after] shows every cue at exactly the same moment as [before].
     * Used to prove that translating a track never disturbs its timing (a
     * translated embedded track must stay in step with the film).
     */
    fun startTimesUnchanged(before: List<SubtitleCue>, after: List<SubtitleCue>): Boolean {
        if (before.size != after.size) return false
        return before.indices.all { before[it].startMs == after[it].startMs }
    }
}
