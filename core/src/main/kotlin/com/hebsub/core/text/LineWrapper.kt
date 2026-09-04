package com.hebsub.core.text

/**
 * Wraps a cue's text into at most two balanced display lines, respecting a
 * maximum characters-per-line budget. Broadcast subtitle guidelines (BBC,
 * Netflix) cap a line at ~37–42 chars and a cue at two lines; we default to 42.
 *
 * The algorithm never splits a word. If the text cannot fit in two lines it
 * still returns two lines (the second may exceed the budget) rather than
 * dropping content — losing dialogue is worse than a slightly long line.
 */
object LineWrapper {

    const val DEFAULT_MAX_CHARS = 42

    fun wrap(text: String, maxChars: Int = DEFAULT_MAX_CHARS): List<String> {
        val collapsed = text.replace('\n', ' ').replace(Regex("\\s+"), " ").trim()
        if (collapsed.isEmpty()) return listOf("")
        if (collapsed.length <= maxChars) return listOf(collapsed)

        val words = collapsed.split(' ')
        // Find the break that keeps line 1 within the budget, preferring one that
        // leaves line 2 inside it too and only then the most balanced pair. Without
        // the overflow term the break nearest the middle wins even when it strands
        // everything else on line 2 — which is how a long cue used to arrive at the
        // renderer as one enormous line and come out as a block of text.
        val target = collapsed.length / 2
        var best = -1
        var bestScore = Long.MAX_VALUE
        var runningLen = 0
        for (w in words.indices.take(words.size - 1)) {
            runningLen += words[w].length + if (w > 0) 1 else 0
            if (runningLen > maxChars) break
            val rest = collapsed.length - runningLen - 1
            val overflow = (rest - maxChars).coerceAtLeast(0).toLong()
            val score = overflow * 1000L + kotlin.math.abs(runningLen - target)
            if (score <= bestScore) {
                bestScore = score
                best = w
            }
        }

        if (best < 0) {
            // A single word longer than the budget; keep it on one line.
            return listOf(collapsed)
        }

        val line1 = words.subList(0, best + 1).joinToString(" ")
        val line2 = words.subList(best + 1, words.size).joinToString(" ")
        return listOf(line1, line2)
    }
}
