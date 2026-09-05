package com.hebsub.core.subtitle

/**
 * A single subtitle cue. Times are in milliseconds from the start of the media.
 * [lines] holds the display lines already split (a cue is usually 1–2 lines).
 */
data class SubtitleCue(
    val index: Int,
    val startMs: Long,
    val endMs: Long,
    val lines: List<String>,
) {
    val text: String get() = lines.joinToString("\n")
    val durationMs: Long get() = (endMs - startMs).coerceAtLeast(0)

    /** Return a copy with new text, re-splitting on newlines. */
    fun withText(newText: String): SubtitleCue =
        copy(lines = newText.split('\n').map { it.trimEnd() })
}

/**
 * An ordered list of cues plus the BCP-47-ish language tag of their text
 * (e.g. "he", "en", "fr", or null if unknown).
 */
data class SubtitleTrack(
    val cues: List<SubtitleCue>,
    val language: String?,
) {
    val isEmpty: Boolean get() = cues.isEmpty()

    /** Concatenated plain text of every cue — handy for language detection. */
    fun plainText(): String = cues.joinToString("\n") { it.text }
}
