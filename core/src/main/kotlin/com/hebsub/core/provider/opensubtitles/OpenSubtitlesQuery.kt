package com.hebsub.core.provider.opensubtitles

import com.hebsub.core.lang.Language
import kotlinx.serialization.json.Json

/**
 * Query building and result ranking for OpenSubtitles. Performs no network I/O —
 * the app layer takes [buildSearchParams] to make the request and feeds the raw
 * JSON back into [parse] + [rankCandidates].
 *
 * **Hash matches only.** Searching by title or IMDb id finds the right *film* but
 * not the right *cut*, which is how this app once ended up with subtitles that
 * were minutes out of step (or from another film entirely). The only lookup left
 * is by the file's own hash: the result is then a subtitle uploaded for exactly
 * this file, whose timing is correct by construction. Anything that is not a
 * hash match is discarded by the caller.
 *
 * Privacy: the only value ever sent is the hash of the file being processed. No
 * device or account identifier is added.
 */
object OpenSubtitlesQuery {

    // coerceInputValues: OpenSubtitles sometimes sends an explicit null for a
    // boolean/number field (e.g. "from_trusted": null). Without this, a non-null
    // property with a default throws on that null; with it, the default is used.
    private val json = Json { ignoreUnknownKeys = true; coerceInputValues = true }

    /**
     * Parameters for `GET /api/v1/subtitles`: the languages we want and the
     * file's OpenSubtitles hash. [movieHash] is required — without it there is
     * nothing to match against and the caller should not search at all.
     */
    fun buildSearchParams(languages: List<String>, movieHash: String): Map<String, String> {
        val params = LinkedHashMap<String, String>()
        val langs = languages.mapNotNull { Language.canonical(it) }.distinct()
        // The API expects a comma-separated, alphabetically sorted list.
        if (langs.isNotEmpty()) params["languages"] = langs.sorted().joinToString(",")
        params["moviehash"] = movieHash.lowercase()
        return params
    }

    /**
     * Hash-matched candidates only, best first: language priority, then non-SDH,
     * human (not machine) translations, trusted uploaders, and popularity.
     * Candidates the server returned that are NOT hash matches are dropped here.
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
        return flatten(response).filter { it.hashMatch }.sortedWith(comparator)
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
                    hashMatch = a.movieHashMatch,
                )
            }
        }

    fun parse(rawJson: String): OsSearchResponse =
        json.decodeFromString(OsSearchResponse.serializer(), rawJson)
}
