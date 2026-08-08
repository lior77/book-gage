package com.hebsub.core.lang

/**
 * Lightweight, dependency-free language helpers. This is not a full language
 * detector — it only needs to answer the questions the pipeline asks:
 * "is this Hebrew?", "is this English?", and "roughly which script is this?".
 */
object Language {

    const val HEBREW = "he"
    const val ENGLISH = "en"

    // Common alternate/legacy tags mapped to canonical ISO-639-1.
    private val ALIASES = mapOf(
        "iw" to "he",      // legacy Hebrew code
        "heb" to "he",
        "eng" to "en",
        "en-us" to "en",
        "en-gb" to "en",
        "spa" to "es",
        "fre" to "fr",
        "fra" to "fr",
        "ger" to "de",
        "deu" to "de",
        "rus" to "ru",
        "ara" to "ar",
        "jpn" to "ja",
        "kor" to "ko",
        "chi" to "zh",
        "zho" to "zh",
    )

    /** Normalise a language tag to a lower-case canonical code, or null if blank/undefined. */
    fun canonical(tag: String?): String? {
        if (tag.isNullOrBlank()) return null
        val t = tag.trim().lowercase()
        if (t == "und" || t == "unknown") return null
        ALIASES[t]?.let { return it }
        // Take the primary subtag ("pt-br" -> "pt").
        val primary = t.substringBefore('-')
        return ALIASES[primary] ?: primary
    }

    fun isHebrew(tag: String?): Boolean = canonical(tag) == HEBREW
    fun isEnglish(tag: String?): Boolean = canonical(tag) == ENGLISH

    private fun isHebrewChar(c: Char): Boolean = c in '֐'..'׿'
    private fun isLatinLetter(c: Char): Boolean = c in 'a'..'z' || c in 'A'..'Z'

    /**
     * Heuristic script detection from the text itself. Returns "he" if a
     * meaningful share of letters are Hebrew, "en" if predominantly Latin,
     * otherwise null. Used as a sanity check on declared track languages.
     */
    fun detectScript(text: String): String? {
        var hebrew = 0
        var latin = 0
        for (c in text) {
            when {
                isHebrewChar(c) -> hebrew++
                isLatinLetter(c) -> latin++
            }
        }
        val total = hebrew + latin
        if (total < 4) return null
        return when {
            hebrew.toDouble() / total >= 0.20 -> HEBREW
            latin.toDouble() / total >= 0.80 -> ENGLISH
            else -> null
        }
    }
}
