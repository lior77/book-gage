package com.hebsub.core.speech

/**
 * Planning and merging for transcription in pieces.
 *
 * A feature film sent to the recogniser as one request comes back with whole
 * scenes missing — a documented failure mode on long files, and the one this
 * app hit. So the audio is cut into pieces of a few minutes, each sent on its
 * own, and the words are put back together on the film's own clock.
 *
 * Consecutive pieces overlap by a few seconds so no word is lost at a cut. Each
 * piece then *keeps* only the words that start on its own side of the midpoint
 * of that overlap, which is how the same word is never taken twice.
 */
object SpeechChunks {

    const val DEFAULT_CHUNK_MS = 600_000L
    const val DEFAULT_OVERLAP_MS = 5_000L

    /** One piece of the audio: what to cut, and which of its words to believe. */
    data class Chunk(
        val index: Int,
        /** Cut from here… */
        val fromMs: Long,
        /** …to here (exclusive). */
        val toMs: Long,
        /** Keep words that start at or after this absolute time… */
        val keepFromMs: Long,
        /** …and before this one. */
        val keepToMs: Long,
    ) {
        val durationMs: Long get() = toMs - fromMs
    }

    fun plan(
        durationMs: Long,
        chunkMs: Long = DEFAULT_CHUNK_MS,
        overlapMs: Long = DEFAULT_OVERLAP_MS,
    ): List<Chunk> {
        if (durationMs <= 0) return emptyList()
        val size = chunkMs.coerceAtLeast(overlapMs * 4)
        val half = overlapMs / 2
        val out = ArrayList<Chunk>()
        var start = 0L
        var i = 0
        while (start < durationMs) {
            val end = minOf(start + size, durationMs)
            val from = (start - overlapMs).coerceAtLeast(0L)
            val to = minOf(end + overlapMs, durationMs)
            val keepFrom = if (i == 0) 0L else start - half
            val keepTo = if (end >= durationMs) Long.MAX_VALUE else end - half
            out.add(Chunk(i, from, to, keepFrom, keepTo))
            start = end
            i++
        }
        return out
    }

    /**
     * Words of one chunk, with times relative to the chunk's own start, placed
     * on the film's clock and filtered to the chunk's keep window.
     */
    fun place(chunk: Chunk, relative: List<SpeechWord>): List<SpeechWord> =
        relative.asSequence()
            .map { SpeechWord(it.startMs + chunk.fromMs, it.endMs + chunk.fromMs, it.text) }
            .filter { it.startMs >= chunk.keepFromMs && it.startMs < chunk.keepToMs }
            .toList()

    /**
     * Merge already-placed word lists into one stream. A word that another
     * list already holds at (almost) the same moment with the same text is a
     * duplicate from an overlap and is dropped.
     */
    fun merge(placed: List<List<SpeechWord>>, jitterMs: Long = 300L): List<SpeechWord> {
        val all = placed.flatten().sortedBy { it.startMs }
        val out = ArrayList<SpeechWord>(all.size)
        for (w in all) {
            val last = out.lastOrNull()
            if (last != null &&
                last.text.equals(w.text, ignoreCase = true) &&
                kotlin.math.abs(last.startMs - w.startMs) <= jitterMs
            ) continue
            out.add(w)
        }
        return out
    }

    /**
     * Stretches of the film with no words at all that last at least [minGapMs],
     * including the run-in before the first word and the tail after the last.
     */
    fun gaps(words: List<SpeechWord>, durationMs: Long, minGapMs: Long): List<LongRange> {
        val out = ArrayList<LongRange>()
        var cursor = 0L
        for (w in words.sortedBy { it.startMs }) {
            if (w.startMs - cursor >= minGapMs) out.add(cursor until w.startMs)
            cursor = maxOf(cursor, w.endMs)
        }
        if (durationMs - cursor >= minGapMs) out.add(cursor until durationMs)
        return out
    }
}
