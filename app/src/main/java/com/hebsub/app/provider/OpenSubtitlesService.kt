package com.hebsub.app.provider

import com.hebsub.app.log.RunLog
import com.hebsub.app.net.PrivacyHttp
import com.hebsub.core.provider.opensubtitles.OpenSubtitlesQuery
import com.hebsub.core.provider.opensubtitles.OsCandidate
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.File
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * OpenSubtitles REST v1 client. Query building and best-match selection live in
 * the tested :core module; this class performs the HTTP and computes the movie
 * hash. Privacy (spec §12): the only identifying value sent is the movie hash
 * and/or a title the user is processing — never a device or user identifier.
 */
class OpenSubtitlesService(private val apiKey: String) {

    private val base = "https://api.opensubtitles.com/api/v1"
    private val jsonMedia = "application/json".toMediaType()

    /** Search and return the best downloadable candidate for the language priority, or null. */
    suspend fun findBest(
        languagePriority: List<String>,
        movieHash: String?,
        title: String?,
        excludeHearingImpaired: Boolean = true,
    ): OsCandidate? = findCandidates(languagePriority, movieHash, title, null, excludeHearingImpaired).firstOrNull()

    /**
     * Search and return ALL matching candidates ranked best-first, so the caller
     * can download and verify each against the video's duration (spec §3) and
     * keep the first that fits, instead of blindly trusting one result.
     */
    suspend fun findCandidates(
        languagePriority: List<String>,
        movieHash: String?,
        title: String?,
        year: String?,
        excludeHearingImpaired: Boolean = true,
    ): List<OsCandidate> = withContext(Dispatchers.IO) {
        if (apiKey.isBlank()) return@withContext emptyList()
        val params = OpenSubtitlesQuery.buildSearchParams(languagePriority, movieHash, title, year)
        val urlBuilder = "$base/subtitles".toHttpUrl().newBuilder()
        params.forEach { (k, v) -> urlBuilder.addQueryParameter(k, v) }

        val request = Request.Builder()
            .url(urlBuilder.build())
            .header("Api-Key", apiKey)
            .header("Accept", "application/json")
            .get()
            .build()

        PrivacyHttp.client.newCall(request).execute().use { resp ->
            if (!resp.isSuccessful) {
                RunLog.error("OpenSubtitles search HTTP ${resp.code}")
                return@withContext emptyList()
            }
            val parsed = OpenSubtitlesQuery.parse(resp.body?.string().orEmpty())
            RunLog.log("OpenSubtitles search results=${parsed.data.size}")
            OpenSubtitlesQuery.rankCandidates(parsed, languagePriority, excludeHearingImpaired)
        }
    }

    /** Resolve a download link for a file id and fetch the raw subtitle text. */
    suspend fun download(fileId: Long): String? = withContext(Dispatchers.IO) {
        if (apiKey.isBlank()) return@withContext null
        val body = """{"file_id":$fileId}""".toRequestBody(jsonMedia)
        val linkReq = Request.Builder()
            .url("$base/download")
            .header("Api-Key", apiKey)
            .header("Accept", "application/json")
            .header("Content-Type", "application/json")
            .post(body)
            .build()

        val link = PrivacyHttp.client.newCall(linkReq).execute().use { resp ->
            if (!resp.isSuccessful) return@withContext null
            val json = resp.body?.string().orEmpty()
            // Minimal extraction of the "link" field to avoid a DTO for one value.
            Regex("\"link\"\\s*:\\s*\"([^\"]+)\"").find(json)?.groupValues?.get(1)
                ?.replace("\\/", "/")
        } ?: return@withContext null

        val fileReq = Request.Builder().url(link).get().build()
        PrivacyHttp.client.newCall(fileReq).execute().use { resp ->
            if (!resp.isSuccessful) null else resp.body?.string()
        }
    }

    companion object {
        /**
         * OpenSubtitles / OSDB movie hash: 64-bit sum of the file size and the
         * first and last 64 KiB read as little-endian 64-bit words. Returns a
         * 16-char lowercase hex string, or null for files smaller than 128 KiB.
         */
        fun computeMovieHash(file: File): String? {
            val chunk = 64 * 1024
            val length = file.length()
            if (length < chunk * 2) return null
            RandomAccessFile(file, "r").use { raf ->
                var hash = length
                hash += sumChunk(raf, 0, chunk)
                hash += sumChunk(raf, length - chunk, chunk)
                return String.format("%016x", hash)
            }
        }

        private fun sumChunk(raf: RandomAccessFile, offset: Long, size: Int): Long {
            val buffer = ByteArray(size)
            raf.seek(offset)
            raf.readFully(buffer)
            val bb = ByteBuffer.wrap(buffer).order(ByteOrder.LITTLE_ENDIAN)
            var sum = 0L
            while (bb.remaining() >= 8) sum += bb.long
            return sum
        }
    }
}
