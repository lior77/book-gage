package com.hebsub.core.text

import com.hebsub.core.subtitle.SubtitleCue

/**
 * Breaks over-long cues into several consecutive ones.
 *
 * A subtitle is two lines. That is not a stylistic preference — it is the amount
 * a viewer can read without losing the picture. A cue that carries more than that
 * does not become a longer subtitle; it becomes a block of text sitting over the
 * film, which is exactly what happens when speech recognition returns a whole
 * twenty-second exchange as one "utterance" and the wrapper has nowhere to put
 * the overflow but the second line.
 *
 * So anything past the two-line budget is split into its own cue. The split
 * points are chosen where the sentence already breaks — a full stop first, then a
 * comma or colon, and only as a last resort between two arbitrary words.
 *
 * The parent's span is divided between the parts in proportion to their length.
 * That is an estimate, not a measurement: the exact moment each half was spoken
 * is not recoverable from a translated line. But the parent's own start and end
 * are kept exactly, so the split can never drift away from the dialogue — the
 * error is bounded inside the utterance it came from.
 */
object CueSplitter {

    /** How many lines one subtitle may occupy. */
    const val DEFAULT_MAX_LINES = 2

    /** Silence left between two parts of a split cue, so they never touch. */
    const val GAP_MS = 40L

    /** Sentence-final punctuation, including the Hebrew/Arabic full stop forms. */
    private val SENTENCE_BREAK = Regex("""(?<=[.!?…׃])[\s]+""")

    /** Clause punctuation — the second-choice break point. */
    private val CLAUSE_BREAK = Regex("""(?<=[,;:־–—])[\s]+""")

    private val WHITESPACE = Regex("""\s+""")

    /**
     * Split every cue in [cues] that needs it and return the whole track,
     * re-indexed from 1. A cue that already fits is returned untouched.
     */
    fun split(
        cues: List<SubtitleCue>,
        maxCharsPerLine: Int = LineWrapper.DEFAULT_MAX_CHARS,
        maxLines: Int = DEFAULT_MAX_LINES,
    ): List<SubtitleCue> {
        val budget = (maxCharsPerLine * maxLines).coerceAtLeast(1)
        val out = ArrayList<SubtitleCue>(cues.size)
        for (cue in cues) {
            val text = cue.text.replace('\n', ' ').replace(WHITESPACE, " ").trim()
            if (text.length <= budget) { out.add(cue); continue }
            val parts = pieces(text, budget)
            if (parts.size <= 1) { out.add(cue.withText(text)); continue }
            out.addAll(distribute(cue, parts))
        }
        return out.mapIndexed { i, cue -> cue.copy(index = i + 1) }
    }

    /** How many cues [cues] would gain — for logging, without doing the work twice. */
    fun countOversized(cues: List<SubtitleCue>, maxCharsPerLine: Int, maxLines: Int): Int {
        val budget = (maxCharsPerLine * maxLines).coerceAtLeast(1)
        return cues.count { it.text.replace('\n', ' ').trim().length > budget }
    }

    /**
     * Cut [text] into pieces that each fit the budget, preferring the punctuation
     * the writer already put there. Three passes, each finer than the last.
     */
    private fun pieces(text: String, budget: Int): List<String> {
        val out = ArrayList<String>()
        for (sentenceGroup in pack(text.split(SENTENCE_BREAK), budget)) {
            if (sentenceGroup.length <= budget) { out.add(sentenceGroup); continue }
            for (clauseGroup in pack(sentenceGroup.split(CLAUSE_BREAK), budget)) {
                if (clauseGroup.length <= budget) out.add(clauseGroup)
                else out.addAll(pack(clauseGroup.split(' '), budget))
            }
        }
        return out
    }

    /**
     * Greedily join [atoms] into groups of at most [budget] characters. A single
     * atom longer than the budget is emitted on its own — the caller then splits
     * it with a finer rule, and the last caller accepts it as it is rather than
     * cutting a word in half.
     */
    private fun pack(atoms: List<String>, budget: Int): List<String> {
        val out = ArrayList<String>()
        val current = StringBuilder()
        for (raw in atoms) {
            val atom = raw.trim()
            if (atom.isEmpty()) continue
            when {
                current.isEmpty() -> current.append(atom)
                current.length + 1 + atom.length <= budget -> current.append(' ').append(atom)
                else -> { out.add(current.toString()); current.setLength(0); current.append(atom) }
            }
        }
        if (current.isNotEmpty()) out.add(current.toString())
        return out
    }

    /**
     * Lay [parts] out across the parent's span, each part getting time in
     * proportion to its length. The first part starts when the parent did and the
     * last ends when the parent did, so the split stays anchored to the dialogue.
     */
    private fun distribute(cue: SubtitleCue, parts: List<String>): List<SubtitleCue> {
        val totalChars = parts.sumOf { it.length }.coerceAtLeast(1)
        val span = cue.durationMs
        val out = ArrayList<SubtitleCue>(parts.size)
        var cursor = cue.startMs
        var consumed = 0
        for ((i, part) in parts.withIndex()) {
            consumed += part.length
            val end = if (i == parts.size - 1) {
                maxOf(cue.endMs, cursor + 1)
            } else {
                maxOf(cue.startMs + span * consumed / totalChars - GAP_MS, cursor + 1)
            }
            out.add(cue.copy(startMs = cursor, endMs = end, lines = listOf(part)))
            cursor = end + GAP_MS
        }
        return out
    }
}
