package com.contentguard.monitor.model

/**
 * A candidate leaked video found on the public web.
 *
 * `durationSeconds` is best-effort: it is read from the hosting page's video
 * metadata (schema.org VideoObject / og:video:duration) when present, and is null
 * when the page exposes no duration. We never invent a duration.
 *
 * `detectedAt` is likewise best-effort from page metadata. Findings are candidate
 * matches for human review — not confirmed leaks.
 */
data class VideoFinding(
    val url: String,
    val siteName: String,
    val title: String,
    val durationSeconds: Long?, // null when the page exposes no duration
    val detectedAt: Long?,      // epoch millis, or null when unknown
    val source: String
) {
    /** Human-readable duration, e.g. "12:04", or "—" when unknown. */
    val durationLabel: String
        get() {
            val s = durationSeconds ?: return "—"
            val h = s / 3600
            val m = (s % 3600) / 60
            val sec = s % 60
            return if (h > 0)
                String.format("%d:%02d:%02d", h, m, sec)
            else
                String.format("%d:%02d", m, sec)
        }
}

/** The full result set for one handle. */
data class MonitorReport(
    val handle: String,
    val generatedAt: Long,
    val dataSourceName: String,
    val isDemo: Boolean,
    val videos: List<VideoFinding>,
    val totalVideos: Int,
    val videosLast12Months: Int,
    val withKnownDuration: Int,
    val queriesUsed: List<String>,
    val notes: String
)
