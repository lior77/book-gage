package com.hebsub.core.subtitle

import kotlin.math.roundToLong

/**
 * Aligns a subtitle track to the actual audio of the video, the same idea as
 * ffsubsync: compare WHEN people speak (a speech timeline from ASR) with WHEN
 * subtitles are displayed, and find the time transform that makes them agree.
 *
 * Only timing is used — no text — so it is language-agnostic: English subtitles
 * can be aligned against Spanish audio.
 *
 * Downloaded subtitles that were not matched by file hash often belong to a
 * different cut or release. Two things then differ: a constant offset (a
 * different intro/logo length) and a time scale (23.976 vs 24 vs 25 fps
 * transfers). Both are searched: `t_audio = t_sub * scale + offsetMs`.
 *
 * Scoring: the audio is turned into a +1 (speech) / −1 (silence) signal at
 * [RESOLUTION_MS]; a candidate transform scores the sum of that signal under
 * every subtitle cue. Cues that land on speech add, cues that land on silence
 * (or outside the audio) subtract, so the true alignment is a sharp maximum.
 * Prefix sums make each candidate O(cues), so the whole search is fast.
 */
object SubtitleAligner {

    /** A span of speech in the audio (from ASR utterances), in milliseconds. */
    data class Speech(val startMs: Long, val endMs: Long)

    /**
     * Fraction of subtitle time landing on speech, from −1 (all on silence) to
     * +1 (all on speech), below which we consider the subtitle to be for a
     * different film/version entirely rather than merely mistimed.
     */
    const val MIN_FIT = 0.20

    data class Result(
        val offsetMs: Long,
        val scale: Double,
        /** Score of the best transform. */
        val score: Long,
        /** Score of leaving the subtitles untouched (offset 0, scale 1). */
        val baselineScore: Long,
        /** [score] normalised to −1..+1 — how well the re-timed cues sit on speech. */
        val fit: Double = 0.0,
        /** [baselineScore] normalised the same way — the fit before re-timing. */
        val baselineFit: Double = 0.0,
    ) {
        val isIdentity: Boolean get() = offsetMs == 0L && scale == 1.0

        /** Apply only when it is a real improvement, not noise. */
        val shouldApply: Boolean
            get() = !isIdentity && score > 0 && score > baselineScore + (baselineScore.coerceAtLeast(0) / 10)

        /** True when the cues genuinely line up with the speech after alignment. */
        val isTrustworthy: Boolean get() = fit >= MIN_FIT
    }

    const val RESOLUTION_MS = 100L

    /** Candidate time scales: identity plus the common frame-rate transfers. */
    val SCALES: DoubleArray = doubleArrayOf(
        1.0,
        25.0 / 23.976, 23.976 / 25.0,
        24.0 / 25.0, 25.0 / 24.0,
        23.976 / 24.0, 24.0 / 23.976,
    )

    /**
     * Find the best (offset, scale) mapping subtitle time to audio time.
     * @param maxOffsetMs largest |offset| to search (default ±5 minutes).
     */
    fun align(
        cues: List<SubtitleCue>,
        speech: List<Speech>,
        maxOffsetMs: Long = 5 * 60_000L,
        scales: DoubleArray = SCALES,
    ): Result {
        if (cues.isEmpty() || speech.isEmpty()) return Result(0L, 1.0, 0L, 0L)

        val res = RESOLUTION_MS
        val lastMs = maxOf(cues.maxOf { it.endMs }, speech.maxOf { it.endMs })
        val n = (lastMs / res).toInt() + 2
        val pad = (maxOffsetMs / res).toInt() + n / 2 + 2   // room for scaled/offset cues

        // ext[k] = +1 during speech, −1 otherwise (including outside the audio).
        val ext = IntArray(n + 2 * pad) { -1 }
        for (s in speech) {
            val a = (s.startMs / res).toInt().coerceIn(0, n - 1) + pad
            val b = ((s.endMs + res - 1) / res).toInt().coerceIn(0, n) + pad
            for (k in a until b) ext[k] = 1
        }
        val prefix = LongArray(ext.size + 1)
        for (k in ext.indices) prefix[k + 1] = prefix[k] + ext[k]

        fun scoreOf(scale: Double, offsetMs: Long): Long {
            var total = 0L
            for (c in cues) {
                val a = ((c.startMs * scale + offsetMs) / res).roundToLong().toInt() + pad
                var b = ((c.endMs * scale + offsetMs) / res).roundToLong().toInt() + pad
                if (b <= a) b = a + 1
                val ca = a.coerceIn(0, ext.size)
                val cb = b.coerceIn(0, ext.size)
                total += prefix[cb] - prefix[ca]
                // Samples pushed outside the padded window count as silence.
                total -= ((b - a) - (cb - ca))
            }
            return total
        }

        // Total samples covered by the cues at a given scale — the normaliser that
        // turns a raw score into a comparable −1..+1 fit.
        fun samplesFor(scale: Double): Long {
            var total = 0L
            for (c in cues) {
                val a = ((c.startMs * scale) / res).roundToLong()
                var b = ((c.endMs * scale) / res).roundToLong()
                if (b <= a) b = a + 1
                total += b - a
            }
            return total.coerceAtLeast(1L)
        }

        val baseline = scoreOf(1.0, 0L)
        var bestScore = Long.MIN_VALUE
        var bestOffset = 0L
        var bestScale = 1.0
        val steps = (maxOffsetMs / res).toInt()
        for (scale in scales) {
            for (i in -steps..steps) {
                val offset = i * res
                val s = scoreOf(scale, offset)
                if (s > bestScore) { bestScore = s; bestOffset = offset; bestScale = scale }
            }
        }
        return Result(
            offsetMs = bestOffset,
            scale = bestScale,
            score = bestScore,
            baselineScore = baseline,
            fit = bestScore.toDouble() / samplesFor(bestScale),
            baselineFit = baseline.toDouble() / samplesFor(1.0),
        )
    }

    /** Re-time [cues] with [result]; order and indices are preserved. */
    fun apply(cues: List<SubtitleCue>, result: Result): List<SubtitleCue> {
        if (result.isIdentity) return cues
        return cues.map { c ->
            val start = (c.startMs * result.scale + result.offsetMs).roundToLong().coerceAtLeast(0L)
            val end = (c.endMs * result.scale + result.offsetMs).roundToLong().coerceAtLeast(start + 1)
            c.copy(startMs = start, endMs = end)
        }
    }
}
