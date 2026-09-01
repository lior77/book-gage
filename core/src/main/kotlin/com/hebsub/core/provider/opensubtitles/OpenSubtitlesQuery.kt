package com.hebsub.core.provider.opensubtitles

import com.hebsub.core.lang.Language
import kotlinx.serialization.json.Json

/**
 * Pure query-building and result-ranking for OpenSubtitles. Performs no network
 * I/O — the app layer takes [buildSearchParams] to make the request and feeds
 * the raw JSON back into [parse] + [selectBest].
 *
 * Privacy note: the only identifying value ever sent is the movie hash and/or a
 * title the user chose to process. No device or account identifiers are added.
 */
object OpenSubtitlesQuery {

    private val json = Json { ignoreUnknownKeys = true }

    /**
     * Build the query parameters for `GET /api/v1/subtitles`.
     * Provide [movieHash] (OpenSubtitles' 64-bit file hash, hex) when available
     * — it gives by far the most accurate matches — and/or a [title] fallback.
     */
    fun buildSearchParams(
        languages: List<String>,
        movieHash: String? = null,
        title: String? = null,
        year: String? = null,
    ): Map<String, String> {
        val params = LinkedHashMap<String, String>()
        val langs = languages.mapNotNull { Language.canonical(it) }.distinct()
        if (langs.isNotEmpty()) {
            // API expects a comma-separated, alphabetically sorted list.
            params["languages"] = langs.sorted().joinToString(",")
        }
        if (!movieHash.isNullOrBlank()) params["moviehash"] = movieHash.lowercase()
        val cleaned = title?.let { cleanQuery(it) }
        if (!cleaned.isNullOrBlank()) params["query"] = cleaned
        val yr = year?.filter { it.isDigit() }?.take(4)
        if (!yr.isNullOrBlank()) params["year"] = yr
        return params
    }

    private val RELEASE_TOKENS = Regex(
        """(?i)\b(?:\d{3,4}p|x264|x265|h\.?264|h\.?265|hevc|xvid|divx|aac|ac3|dts|web[\s.-]?rip|web[\s.-]?dl|webrip|bluray|blu[\s.-]?ray|brrip|bdrip|hdrip|hdtv|dvdrip|dvdscr|remux|proper|repack|extended|internal|readnfo|\d+of\d+|s\d{1,2}e\d{1,2}|mvgroup|yify|yts|rarbg|evo|ntb|ettv|fgt)\b"""
    )
    private val YEAR_IN_NAME = Regex("""\b(19|20)\d{2}\b""")

    /**
     * Turn a raw file-name-ish title into a clean search query: dots/underscores
     * become spaces, and common release tags (resolution, codec, source, release
     * group, "1of3", "S01E02", …) are stripped, so a name that isn't a 100% match
     * still finds the film (spec §3). The year, if embedded, is left for the
     * caller to pass separately via [buildSearchParams].
     */
    fun cleanQuery(raw: String): String =
        raw.replace('.', ' ').replace('_', ' ').replace('-', ' ')
            .let { RELEASE_TOKENS.replace(it, " ") }
            .replace(Regex("""[\[\](){}]"""), " ")
            .replace(Regex("""\s{2,}"""), " ")
            .trim()

    /** Pull a 4-digit year out of a raw name if present (for [buildSearchParams]). */
    fun yearFrom(raw: String): String? = YEAR_IN_NAME.find(raw)?.value

    /**
     * Rank every candidate in the response so the caller can try them in order
     * and keep the first whose duration matches the video (spec §3). Ordering:
     * language-priority first, then non-HI, human (not machine) subs, trusted
     * uploaders, and popularity.
     */
    fun rankCandidates(
        response: OsSearchResponse,
        languagePriority: List<String>,
        excludeHearingImpaired: Boolean = true,
    ): List<OsCandidate> {
        val priority = languagePriority.mapNotNull { Language.canonical(it) }
        fun langRank(c: OsCandidate): Int {
            val i = priority.indexOf(c.language)
            return if (i >= 0) i else Int.MAX_VALUE
        }
        val comparator = compareBy<OsCandidate> { langRank(it) }
            .thenByDescending { if (excludeHearingImpaired) !it.hearingImpaired else false }
            .thenByDescending { !it.machineTranslated }
            .thenByDescending { it.fromTrusted }
            .thenByDescending { it.downloadCount }
        return flatten(response).sortedWith(comparator)
    }

    private fun flatten(response: OsSearchResponse): List<OsCandidate> =
        response.data.flatMap { d ->
            val a = d.attributes
            a.files.filter { it.fileId != 0L }.map { f ->
                OsCandidate(
                    fileId = f.fileId,
                    language = Language.canonical(a.language),
                    downloadCount = a.downloadCount,
                    hearingImpaired = a.hearingImpaired,
                    machineTranslated = a.machineTranslated,
                    fromTrusted = a.fromTrusted,
                    release = a.release,
                )
            }
        }

    fun parse(rawJson: String): OsSearchResponse =
        json.decodeFromString(OsSearchResponse.serializer(), rawJson)

    /**
     * Choose the best subtitle from a search response for the given language
     * priority. Within a language, prefer human (not machine-translated) subs,
     * trusted uploaders, then popularity.
     *
     * @param excludeHearingImpaired drop SDH/CC tracks when a normal one exists.
     */
    fun selectBest(
        response: OsSearchResponse,
        languagePriority: List<String>,
        excludeHearingImpaired: Boolean = true,
    ): OsCandidate? {
        val candidates = response.data.flatMap { d ->
            val a = d.attributes
            a.files.filter { it.fileId != 0L }.map { f ->
                OsCandidate(
                    fileId = f.fileId,
                    language = Language.canonical(a.language),
                    downloadCount = a.downloadCount,
                    hearingImpaired = a.hearingImpaired,
                    machineTranslated = a.machineTranslated,
                    fromTrusted = a.fromTrusted,
                    release = a.release,
                )
            }
        }
        if (candidates.isEmpty()) return null

        val priority = languagePriority.mapNotNull { Language.canonical(it) }

        fun rankFor(pool: List<OsCandidate>): OsCandidate? {
            if (pool.isEmpty()) return null
            val comparator = compareByDescending<OsCandidate> { !it.machineTranslated }
                .thenByDescending { it.fromTrusted }
                .thenByDescending { it.downloadCount }
            return pool.sortedWith(comparator).firstOrNull()
        }

        // Walk the language priority; within each language honour the HI filter,
        // but fall back to HI subs rather than returning nothing.
        for (lang in priority) {
            val inLang = candidates.filter { it.language == lang }
            if (inLang.isEmpty()) continue
            val nonHi = inLang.filterNot { it.hearingImpaired }
            val chosen = if (excludeHearingImpaired && nonHi.isNotEmpty()) rankFor(nonHi) else rankFor(inLang)
            if (chosen != null) return chosen
        }

        // No priority language matched: if the caller passed an empty priority
        // (meaning "any language"), return the globally best candidate.
        if (priority.isEmpty()) {
            val nonHi = candidates.filterNot { it.hearingImpaired }
            return if (excludeHearingImpaired && nonHi.isNotEmpty()) rankFor(nonHi) else rankFor(candidates)
        }
        return null
    }
}
