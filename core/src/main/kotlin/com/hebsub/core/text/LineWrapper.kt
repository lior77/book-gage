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
        // Find the break point closest to the middle that keeps line 1 <= maxChars,
        // producing visually balanced lines.
        val target = collapsed.length / 2
        var best = -1
        var bestDistance = Int.MAX_VALUE
        var runningLen = 0
        for (w in words.indices.take(words.size - 1)) {
            runningLen += words[w].length + if (w > 0) 1 else 0
            if (runningLen <= maxChars) {
                val distance = kotlin.math.abs(runningLen - target)
                if (distance <= bestDistance) {
                    bestDistance = distance
                    best = w
                }
            } else {
                break
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
