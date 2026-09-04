package com.hebsub.core.speech

import com.hebsub.core.subtitle.SubtitleCue

/** One recognised word with the time it was spoken, absolute from the start of the film. */
data class SpeechWord(
    val startMs: Long,
    val endMs: Long,
    val text: String,
)

/**
 * Turns a stream of timed words into subtitle-sized cues.
 *
 * The recogniser hands back words, not subtitles, and the difference is the whole
 * craft: a subtitle ends where a reader would want it to — at the end of a
 * sentence, at a pause in the speech, or when two lines are full — and it never
 * ends before there is enough on screen to be worth reading.
 *
 * That last clause is what an earlier version got wrong. It cut on every pause of
 * 0.6 s, and an actor delivering "No… me… creas" slowly became three subtitles of
 * one word each, flashing for a second apiece. A pause now ends a cue only once
 * the cue holds a readable amount of text; a *long* silence still ends it
 * regardless, so text is never left hanging over a gap in the dialogue. Anything
 * that still comes out tiny is merged into its neighbour afterwards.
 */
object SpeechSegmenter {

    /** Two subtitle lines' worth of text — the point at which a cue must be cut. */
    const val MAX_CHARS = 84

    /** Below this a cue is not worth its own appearance, so a pause or a full stop is ignored. */
    const val MIN_CHARS = 24

    /** A silence this long between words is a natural boundary — once there is enough text. */
    const val PAUSE_MS = 600L

    /** A silence this long ends the cue whatever its length: text must not hang over it. */
    const val HARD_PAUSE_MS = 1_500L

    /** No cue stays on screen longer than this without a break. */
    const val MAX_SPAN_MS = 7_000L

    /** A finished cue shorter than this is folded into a neighbour when one is close enough. */
    const val TINY_CHARS = 12

    /** How close a tiny cue must be to its neighbour to be merged into it. */
    const val MERGE_GAP_MS = 1_000L

    private val SENTENCE_END = charArrayOf('.', '!', '?', '…')

    fun segment(words: List<SpeechWord>): List<SubtitleCue> {
        val raw = ArrayList<SubtitleCue>()
        val text = StringBuilder()
        var segStart = 0L
        var segEnd = 0L
        var prevEnd = -1L

        fun flush() {
            if (text.isEmpty()) return
            raw.add(SubtitleCue(raw.size + 1, segStart, segEnd, listOf(text.toString())))
            text.setLength(0)
        }

        for (w in words.sortedBy { it.startMs }) {
            val token = w.text.trim()
            if (token.isEmpty()) continue
            if (text.isNotEmpty()) {
                val gap = if (prevEnd < 0) 0L else w.startMs - prevEnd
                val tooWide = text.length + 1 + token.length > MAX_CHARS
                val hardPause = gap >= HARD_PAUSE_MS
                val pause = gap >= PAUSE_MS && text.length >= MIN_CHARS
                val tooLong = w.endMs - segStart > MAX_SPAN_MS
                if (tooWide || hardPause || pause || tooLong) flush()
            }
            if (text.isEmpty()) segStart = w.startMs else text.append(' ')
            text.append(token)
            segEnd = maxOf(w.endMs, w.startMs)
            prevEnd = segEnd
            if (text.length >= MIN_CHARS && token.last() in SENTENCE_END) flush()
        }
        flush()
        return mergeTiny(raw).mapIndexed { i, c -> c.copy(index = i + 1) }
    }

    /**
     * Join runs of fragments: consecutive cues that are each under [MIN_CHARS],
     * close together, and fit two lines when joined. Two fragments are joined;
     * a fragment is NOT appended to a full sentence — "¿Nunca seguiste una
     * compañera?" followed by "Sí, obvio." is a question and its answer, two
     * speakers, and stays two subtitles. A lone "Sí." after a long silence is
     * likewise left alone: that is a legitimate subtitle.
     */
    private fun mergeTiny(cues: List<SubtitleCue>): List<SubtitleCue> {
        if (cues.size < 2) return cues
        val out = ArrayList<SubtitleCue>(cues.size)
        var i = 0
        while (i < cues.size) {
            var cur = cues[i]
            while (i + 1 < cues.size && cur.text.length < MIN_CHARS) {
                val next = cues[i + 1]
                if (next.text.length >= MIN_CHARS) break
                val gap = next.startMs - cur.endMs
                val joined = cur.text + " " + next.text
                if (gap > MERGE_GAP_MS || joined.length > MAX_CHARS ||
                    next.endMs - cur.startMs > MAX_SPAN_MS
                ) break
                cur = cur.copy(endMs = next.endMs, lines = listOf(joined))
                i++
            }
            out.add(cur)
            i++
        }
        return out
    }
}
