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
     * Characters per second a viewer can comfortably read.
     *
     * This is the constraint the broadcast standards are actually built around,
     * and the one this app was missing: a line can be the right length and still
     * be unreadable if it is only on screen for a second. Netflix's Hebrew guide
     * allows 17 CPS for adult programming (13 for children's); their general limits
     * are 42 characters per line and two lines per subtitle, which is what the
     * splitter and the wrapper enforce.
     */
    const val MAX_CPS = 17.0

    /** Netflix's minimum event duration: 5/6 of a second. */
    const val MIN_EVENT_MS = 833L

    /**
     * Give each cue enough time on screen for its own length, at [cps] characters
     * per second — but taken, as always, only from the silence that follows it. A
     * start is never moved and the next cue is never encroached on, so a dense
     * exchange is left exactly as the source had it and only a line with room after
     * it is allowed to linger.
     *
     * Cues that are still too fast afterwards are the ones the dialogue itself
     * leaves no room for. [tooFast] counts them so a run can say so rather than
     * pretend the constraint was met.
     */
    fun ensureReadingSpeed(
        cues: List<SubtitleCue>,
        cps: Double = MAX_CPS,
        guardMs: Long = GUARD_MS,
    ): List<SubtitleCue> {
        if (cps <= 0.0 || cues.isEmpty()) return cues
        val ceilingOf = nextStarts(cues)
        return cues.map { cue ->
            val wanted = cue.startMs + neededMs(cue, cps)
            val ceiling = ceilingOf[cue.startMs]?.minus(guardMs) ?: Long.MAX_VALUE
            val end = minOf(maxOf(cue.endMs, wanted), maxOf(ceiling, cue.endMs))
            if (end == cue.endMs) cue else cue.copy(endMs = end)
        }
    }

    /** How many cues are still shown faster than [cps] can be read. */
    fun tooFast(cues: List<SubtitleCue>, cps: Double = MAX_CPS): Int =
        cues.count { it.durationMs < neededMs(it, cps) }

    private fun neededMs(cue: SubtitleCue, cps: Double): Long {
        val chars = cue.text.count { !it.isWhitespace() }
        return maxOf(MIN_EVENT_MS, Math.round(chars / cps * 1000.0))
    }

    /**
     * start time → the next later start anywhere in the track. Cues that begin
     * together share one answer, which is what "the next cue" means for them.
     */
    private fun nextStarts(cues: List<SubtitleCue>): Map<Long, Long> {
        val starts = cues.map { it.startMs }.sorted()
        val next = HashMap<Long, Long>(starts.size)
        for (i in 0 until starts.size - 1) {
            if (starts[i] != starts[i + 1]) next[starts[i]] = starts[i + 1]
        }
        return next
    }

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
        val nextStart = nextStarts(cues)
        return cues.map { cue ->
            val wanted = cue.startMs + minMs
            // The latest we may run to: just before the next cue, or freely at the end.
            val ceiling = nextStart[cue.startMs]?.minus(guardMs) ?: Long.MAX_VALUE
            val end = minOf(maxOf(cue.endMs, wanted), maxOf(ceiling, cue.endMs))
            if (end == cue.endMs) cue else cue.copy(endMs = end)
        }
    }

    /**
     * Move every cue by [deltaMs] — positive makes the subtitles appear later,
     * negative earlier. Durations are preserved exactly; a cue pushed before zero
     * is clamped to the start of the film, which is the only case where a shift
     * can change a duration.
     *
     * This is the manual sync: the user watches the film, sees the subtitles are
     * a few seconds out, and says so. Deriving the same number from the audio was
     * tried and abandoned — background music reads as speech, so the automatic
     * alignment anchored on the wrong moments.
     */
    fun shift(cues: List<SubtitleCue>, deltaMs: Long): List<SubtitleCue> {
        if (deltaMs == 0L) return cues
        return cues.map { cue ->
            val start = (cue.startMs + deltaMs).coerceAtLeast(0L)
            val end = (cue.endMs + deltaMs).coerceAtLeast(start)
            cue.copy(startMs = start, endMs = end)
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
