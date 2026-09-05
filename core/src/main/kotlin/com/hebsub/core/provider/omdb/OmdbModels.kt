package com.hebsub.core.provider.omdb

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/** OMDb (omdbapi.com) movie record — the fields we surface into the MKV and PDF. */
@Serializable
data class OmdbMovie(
    @SerialName("Title") val title: String = "",
    @SerialName("Year") val year: String = "",
    @SerialName("Rated") val rated: String = "",
    @SerialName("Released") val released: String = "",
    @SerialName("Runtime") val runtime: String = "",
    @SerialName("Genre") val genre: String = "",
    @SerialName("Director") val director: String = "",
    @SerialName("Writer") val writer: String = "",
    @SerialName("Actors") val actors: String = "",
    @SerialName("Plot") val plot: String = "",
    @SerialName("Language") val language: String = "",
    @SerialName("Country") val country: String = "",
    @SerialName("Awards") val awards: String = "",
    @SerialName("Poster") val poster: String = "",
    @SerialName("Metascore") val metascore: String = "",
    @SerialName("imdbRating") val imdbRating: String = "",
    @SerialName("imdbVotes") val imdbVotes: String = "",
    @SerialName("imdbID") val imdbId: String = "",
    @SerialName("Type") val type: String = "",
    @SerialName("Response") val response: String = "",
    @SerialName("Error") val error: String = "",
) {
    val ok: Boolean get() = response.equals("True", ignoreCase = true)
    val hasPoster: Boolean get() = poster.startsWith("http", ignoreCase = true)
    /** Runtime in minutes parsed from e.g. "97 min", or null. */
    val runtimeMinutes: Int? get() = Regex("""(\d+)""").find(runtime)?.value?.toIntOrNull()
}

object Omdb {
    private val json = Json { ignoreUnknownKeys = true; coerceInputValues = true }

    /** Pull an IMDb id ("tt1234567") out of a URL or raw id, or null. */
    fun imdbId(input: String?): String? =
        input?.let { Regex("""tt\d{7,9}""").find(it)?.value }

    fun parse(rawJson: String): OmdbMovie = json.decodeFromString(OmdbMovie.serializer(), rawJson)
}
