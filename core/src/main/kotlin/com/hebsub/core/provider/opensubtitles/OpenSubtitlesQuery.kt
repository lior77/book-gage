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
    ): Map<String, String> {
        val params = LinkedHashMap<String, String>()
        val langs = languages.mapNotNull { Language.canonical(it) }.distinct()
        if (langs.isNotEmpty()) {
            // API expects a comma-separated, alphabetically sorted list.
            params["languages"] = langs.sorted().joinToString(",")
        }
        if (!movieHash.isNullOrBlank()) params["moviehash"] = movieHash.lowercase()
        if (!title.isNullOrBlank()) params["query"] = title.trim()
        return params
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
