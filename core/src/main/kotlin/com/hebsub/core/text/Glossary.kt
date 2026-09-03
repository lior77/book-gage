package com.hebsub.core.text

import com.hebsub.core.subtitle.SubtitleCue

/**
 * Keeps recurring proper nouns consistent across a whole film.
 *
 * A film is translated in batches, and nothing stops the model rendering the
 * same name two ways in two batches ("מרטין" here, "מארטין" there). Passing the
 * cast list from a film database does not solve this and actively misleads —
 * an actor's name is not the character's name.
 *
 * Instead the names are taken from the subtitle itself: capitalised words that
 * recur, which in dialogue are overwhelmingly characters and places. They are
 * translated once and then pinned, so every batch is told the same spelling.
 */
object Glossary {

    /** A term must appear at least this often to be worth pinning. */
    const val MIN_OCCURRENCES = 3

    /** Cap the list so the prompt stays small. */
    const val MAX_TERMS = 40

    // Sentence-initial words are capitalised by grammar, not because they are
    // names, so only words that also appear mid-sentence are considered.
    private val WORD = Regex("""\b[\p{Lu}][\p{Ll}'’]{2,}\b""")

    private val STOPWORDS = setOf(
        "The", "This", "That", "There", "Then", "They", "These", "Those", "Their",
        "What", "When", "Where", "Which", "While", "Who", "Why", "With", "Would",
        "You", "Your", "Yeah", "Yes", "And", "But", "For", "Not", "Now", "Okay",
        "One", "Two", "Are", "Was", "Were", "Have", "Has", "Had", "How", "Him",
        "Her", "His", "She", "Him", "Its", "Let", "Look", "Come", "Please",
        "Sir", "Well", "Sorry", "Thank", "Thanks", "Hey", "Oh", "God", "Good",
        "Get", "Got", "Just", "Know", "Like", "Make", "Take", "Tell", "Think",
        "Want", "Will", "Can", "Did", "Does", "Don", "Doing", "Going", "Never",
        "Nothing", "Something", "Everything", "Because", "About", "After",
        "All", "Any", "Been", "Before", "Being", "Down", "Even", "Every",
        "From", "Here", "Into", "More", "Much", "Only", "Out", "Over", "Right",
        "Said", "Same", "See", "Should", "Some", "Still", "Such", "Than",
        "Too", "Under", "Very", "Way", "Well", "Went", "Why", "Yet",
    )

    /**
     * The proper nouns worth pinning, most frequent first.
     * Only words seen mid-sentence at least [MIN_OCCURRENCES] times qualify.
     */
    fun extractTerms(
        cues: List<SubtitleCue>,
        minOccurrences: Int = MIN_OCCURRENCES,
        maxTerms: Int = MAX_TERMS,
    ): List<String> {
        val counts = HashMap<String, Int>()
        for (cue in cues) {
            for (line in cue.lines) {
                // Everything after the first word of a sentence: a capital there
                // signals a name rather than sentence case.
                val body = line.trimStart()
                var searchFrom = 0
                val firstBreak = body.indexOfFirst { it == ' ' }
                if (firstBreak > 0) searchFrom = firstBreak
                val tail = if (searchFrom > 0) body.substring(searchFrom) else ""
                for (m in WORD.findAll(tail)) {
                    val w = m.value
                    if (w in STOPWORDS) continue
                    counts[w] = (counts[w] ?: 0) + 1
                }
            }
        }
        return counts.entries
            .filter { it.value >= minOccurrences }
            .sortedWith(compareByDescending<Map.Entry<String, Int>> { it.value }.thenBy { it.key })
            .take(maxTerms)
            .map { it.key }
    }

    /** Render the agreed spellings for the prompt; empty when there is nothing to pin. */
    fun render(pinned: Map<String, String>): String {
        if (pinned.isEmpty()) return ""
        return pinned.entries.joinToString("\n") { "${it.key} = ${it.value}" }
    }
}
