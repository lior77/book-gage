package com.hebsub.core.lang

/**
 * Lightweight, dependency-free language helpers. This is not a full language
 * detector — it only needs to answer the questions the pipeline asks:
 * "is this Hebrew?", "which language tag does this file claim?", and, only when
 * nothing else says, "roughly which script is this?".
 *
 * **A tag beats the text.** Every subtitle source but one arrives with a real
 * language tag: the container's stream tag, OpenSubtitles' own language field,
 * the recogniser's detected language. A file the user uploads usually carries
 * one too, in its name (`…Saraiva.pt-PT.srt`). [detectScript] is the last
 * resort, and it answers a question about the SCRIPT, not the language — a
 * Portuguese subtitle and an English one are both "Latin", and calling either
 * of them English is how a run once told the translator to translate Portuguese
 * "from English".
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
        "por" to "pt",
        "ita" to "it",
        "dut" to "nl",
        "nld" to "nl",
        "pol" to "pl",
        "tur" to "tr",
        "swe" to "sv",
        "dan" to "da",
        "nor" to "no",
        "fin" to "fi",
        "cze" to "cs",
        "ces" to "cs",
        "gre" to "el",
        "ell" to "el",
        "hun" to "hu",
        "rum" to "ro",
        "ron" to "ro",
        "ukr" to "uk",
        "vie" to "vi",
        "tha" to "th",
        "hin" to "hi",
        "ind" to "id",
        "per" to "fa",
        "fas" to "fa",
        "bul" to "bg",
        "hrv" to "hr",
        "srp" to "sr",
        "slo" to "sk",
        "slk" to "sk",
        "slv" to "sl",
        "cat" to "ca",
        "est" to "et",
        "lav" to "lv",
        "lit" to "lt",
        "may" to "ms",
        "msa" to "ms",
    )

    /**
     * The language codes a subtitle file is plausibly tagged with. A tag is only
     * believed when it is one of these: without the check, a file ending
     * "…-the.srt" would hand the translator "the" as a source language.
     */
    private val KNOWN = setOf(
        "he", "en", "es", "pt", "fr", "de", "it", "nl", "ru", "ar", "ja", "ko", "zh",
        "pl", "tr", "sv", "da", "no", "fi", "cs", "el", "hu", "ro", "uk", "vi", "th",
        "hi", "id", "fa", "bg", "hr", "sr", "sk", "sl", "ca", "et", "lv", "lt", "ms",
        "is", "ga", "gl", "eu", "af", "sq", "mk", "bs", "be", "ka", "hy", "az", "kk",
        "ta", "te", "ml", "bn", "ur", "mr", "pa", "si", "ne", "km", "my", "sw", "am",
    )

    /** English names for the tags a run is likely to see, for the translator prompt. */
    private val NAMES = mapOf(
        "he" to "Hebrew", "en" to "English", "es" to "Spanish", "pt" to "Portuguese",
        "fr" to "French", "de" to "German", "it" to "Italian", "nl" to "Dutch",
        "ru" to "Russian", "ar" to "Arabic", "ja" to "Japanese", "ko" to "Korean",
        "zh" to "Chinese", "pl" to "Polish", "tr" to "Turkish", "sv" to "Swedish",
        "da" to "Danish", "no" to "Norwegian", "fi" to "Finnish", "cs" to "Czech",
        "el" to "Greek", "hu" to "Hungarian", "ro" to "Romanian", "uk" to "Ukrainian",
        "vi" to "Vietnamese", "th" to "Thai", "hi" to "Hindi", "id" to "Indonesian",
        "fa" to "Persian", "bg" to "Bulgarian", "hr" to "Croatian", "sr" to "Serbian",
        "sk" to "Slovak", "sl" to "Slovenian", "ca" to "Catalan", "et" to "Estonian",
        "lv" to "Latvian", "lt" to "Lithuanian", "ms" to "Malay", "is" to "Icelandic",
    )

    /** Spelled-out languages that turn up in subtitle file names. */
    private val SPELLED = mapOf(
        "hebrew" to "he", "ivrit" to "he", "english" to "en", "spanish" to "es",
        "castellano" to "es", "espanol" to "es", "portuguese" to "pt",
        "portugues" to "pt", "french" to "fr", "francais" to "fr", "german" to "de",
        "deutsch" to "de", "italian" to "it", "italiano" to "it", "dutch" to "nl",
        "russian" to "ru", "arabic" to "ar", "polish" to "pl", "turkish" to "tr",
    )

    /**
     * Segments that sit between the name and the language tag and say something
     * about the subtitle rather than its language, so the search looks past them.
     * ("hi" is deliberately absent — it is also Hindi.)
     */
    private val MARKERS = setOf("forced", "sdh", "cc", "default", "full", "hearing")

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

    /**
     * The language a subtitle file's NAME claims, or null when it claims none.
     *
     * The convention every subtitle site and every subtitle manager uses is to
     * put the tag last, before the extension: `Film.en.srt`, `Film.pt-BR.srt`,
     * `Film.eng.forced.srt`, `Film-he.ass`. Reading it costs nothing and is
     * right far more often than guessing from the text — which cannot tell
     * Portuguese from English at all.
     *
     * A candidate is believed only when it is a known language code (or a
     * spelled-out language), so a title ending in an ordinary word is not
     * mistaken for a tag.
     */
    fun fromFileName(fileName: String?): String? {
        if (fileName.isNullOrBlank()) return null
        // Drop the subtitle extension, then read the trailing segments right to left.
        var stem = fileName.trim().substringAfterLast('/').substringBeforeLast('.', "")
        if (stem.isBlank()) return null
        repeat(3) {
            val cut = stem.lastIndexOfAny(charArrayOf('.', '-', '_', ' '))
            if (cut <= 0) return null
            val candidate = stem.substring(cut + 1)
            stem = stem.substring(0, cut)
            // "pt-PT" arrives as "PT" after a '-' cut; put the pair back together.
            val pair = if (candidate.length == 2 && stem.length >= 2) {
                val prev = stem.substringAfterLast('.').substringAfterLast('_').substringAfterLast(' ')
                if (prev.length == 2 && prev.all { c -> c.isLetter() }) "$prev-$candidate" else candidate
            } else candidate
            languageOf(pair)?.let { return it }
            if (candidate.lowercase() !in MARKERS) return null
        }
        return null
    }

    /** The canonical code for one name-segment, or null when it is not a language. */
    private fun languageOf(segment: String): String? {
        val s = segment.trim().lowercase()
        if (s.isEmpty() || s.any { !it.isLetter() && it != '-' }) return null
        SPELLED[s]?.let { return it }
        val core = s.substringBefore('-')
        if (core.length !in 2..3) return null
        val code = canonical(s) ?: return null
        return code.takeIf { it in KNOWN }
    }

    /**
     * The English name of a language code, for the translator's prompt: a model
     * reads "Portuguese" more surely than it reads "pt". Falls back to the code
     * itself, and to null when there is no code — the prompt then simply does
     * not name a language and the model identifies it from the text, which is
     * better than naming the wrong one.
     */
    fun displayName(tag: String?): String? {
        val code = canonical(tag) ?: return null
        return NAMES[code] ?: code
    }

    private fun isHebrewChar(c: Char): Boolean = c in '֐'..'׿'
    private fun isLatinLetter(c: Char): Boolean = c in 'a'..'z' || c in 'A'..'Z'

    /**
     * Heuristic SCRIPT detection from the text itself. Returns "he" when a
     * meaningful share of the letters are Hebrew, "en" when they are
     * overwhelmingly Latin, otherwise null.
     *
     * Read the "en" as "Latin script", not as English: this cannot tell one
     * Latin-script language from another. Use it to answer "is this Hebrew?",
     * and never as the source language of a translation — [fromFileName] and the
     * source's own tag are for that.
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
