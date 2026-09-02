package com.hebsub.app.provider

import com.hebsub.app.log.RunLog
import com.hebsub.app.net.PrivacyHttp
import com.hebsub.core.provider.omdb.Omdb
import com.hebsub.core.provider.omdb.OmdbMovie
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.Request
import java.io.File

/**
 * Fetches a movie record from OMDb (omdbapi.com) by IMDb id, and downloads its
 * poster. Only the IMDb id and the API key are sent — no device/user data.
 */
class OmdbService(private val apiKey: String) {

    suspend fun fetch(imdbId: String): OmdbMovie? = withContext(Dispatchers.IO) {
        if (apiKey.isBlank()) return@withContext null
        val url = "https://www.omdbapi.com/".toHttpUrl().newBuilder()
            .addQueryParameter("apikey", apiKey)
            .addQueryParameter("i", imdbId)
            .addQueryParameter("plot", "full")
            .build()
        val req = Request.Builder().url(url).header("Accept", "application/json").get().build()
        runCatching {
            PrivacyHttp.client.newCall(req).execute().use { resp ->
                if (!resp.isSuccessful) { RunLog.error("OMDb HTTP ${resp.code}"); return@withContext null }
                val movie = Omdb.parse(resp.body?.string().orEmpty())
                if (!movie.ok) { RunLog.error("OMDb: ${movie.error}"); null } else movie
            }
        }.getOrElse { RunLog.error("OMDb fetch failed", it); null }
    }

    suspend fun downloadPoster(posterUrl: String, out: File): Boolean = withContext(Dispatchers.IO) {
        if (!posterUrl.startsWith("http")) return@withContext false
        runCatching {
            val req = Request.Builder().url(posterUrl).get().build()
            PrivacyHttp.client.newCall(req).execute().use { resp ->
                if (!resp.isSuccessful) return@withContext false
                out.outputStream().use { o -> resp.body?.byteStream()?.copyTo(o) ?: return@withContext false }
            }
            out.length() > 0
        }.getOrDefault(false)
    }
}
