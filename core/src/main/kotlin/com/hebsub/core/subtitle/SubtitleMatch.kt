package com.hebsub.core.subtitle

import kotlin.math.abs

/**
 * Cheap metadata checks that decide whether a downloaded subtitle plausibly
 * belongs to THIS video file, before (and alongside) the expensive audio-based
 * verification in [SubtitleAligner].
 *
 * What actually breaks subtitle timing is the release, not the codec:
 *  - a different cut/intro       → constant offset
 *  - a 23.976 ↔ 25 fps transfer  → linear drift
 *  - a different version         → non-linear drift
 * So we compare frame rate, running length and release tags — never the codec,
 * which says nothing about timing.
 */
object SubtitleMatch {

    /** Max |difference| in fps before we call it a conflict (covers 23.976 vs 24 rounding). */
    const val FPS_TOLERANCE = 0.2

    /** A subtitle may not run past the video by more than this. */
    const val OVERSHOOT_MS = 60_000L

    /** …and must cover at least this fraction of the running time (credits have no subs). */
    const val MIN_COVERAGE = 0.6

    /**
     * True when both frame rates are known and differ materially — a strong sign
     * the subtitle was timed for a different transfer and will drift.
     */
    fun fpsConflict(subFps: Double, videoFps: Double, tolerance: Double = FPS_TOLERANCE): Boolean {
        if (subFps <= 0.0 || videoFps <= 0.0) return false   // unknown → no opinion
        return abs(subFps - videoFps) > tolerance
    }

    /**
     * Length plausibility, asymmetric on purpose: the last cue normally ends a few
     * minutes BEFORE the video does (closing credits), but a subtitle that runs
     * PAST the video is definitely from a longer cut.
     */
    fun durationFits(
        spanMs: Long,
        videoMs: Long,
        overshootMs: Long = OVERSHOOT_MS,
        minCoverage: Double = MIN_COVERAGE,
    ): Boolean {
        if (videoMs <= 0L) return true       // unknown duration → no opinion
        if (spanMs <= 0L) return false
        if (spanMs > videoMs + overshootMs) return false
        return spanMs >= videoMs * minCoverage
    }

    private val NOISE = setOf(
        "the", "a", "an", "and", "of", "mp4", "mkv", "avi", "srt", "sub", "subs", "eng", "en",
    )

    /** Lower-case alphanumeric tokens of length ≥ 2, minus filler words. */
    fun tokens(s: String): Set<String> =
        s.lowercase()
            .replace(Regex("""[^a-z0-9]+"""), " ")
            .split(' ')
            .filter { it.length >= 2 && it !in NOISE }
            .toSet()

    /**
     * How much the video's file name and the subtitle's release string agree,
     * as Jaccard overlap of their tokens. Returns -1.0 when either is unknown.
     * Shared tags (1080p, BluRay, x264, the release group) push this up, and a
     * high value strongly predicts identical timing.
     */
    fun releaseSimilarity(videoName: String?, release: String?): Double {
        if (videoName.isNullOrBlank() || release.isNullOrBlank()) return -1.0
        val a = tokens(videoName)
        val b = tokens(release)
        if (a.isEmpty() || b.isEmpty()) return -1.0
        val inter = a.intersect(b).size.toDouble()
        val union = a.union(b).size.toDouble()
        return if (union == 0.0) -1.0 else inter / union
    }
}
