package com.hebsub.app.io

import com.hebsub.app.net.PrivacyHttp
import com.hebsub.core.net.UrlValidator
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import okhttp3.Request
import java.io.File
import kotlin.coroutines.coroutineContext

/**
 * Downloads a user-supplied video URL into the app's private storage (spec §6).
 * The URL is validated first ([UrlValidator]) to reject non-HTTP schemes and
 * local/private addresses. No identifiers are sent (see [PrivacyHttp]).
 */
class VideoDownloader(private val cacheDir: File) {

    sealed interface Result {
        data class Ok(val file: File) : Result
        data class Invalid(val reason: UrlValidator.Reason) : Result
        data class Failed(val message: String) : Result
    }

    suspend fun download(rawUrl: String, onProgress: (Float) -> Unit): Result =
        withContext(Dispatchers.IO) {
            when (val v = UrlValidator.validate(rawUrl)) {
                is UrlValidator.Result.Invalid -> Result.Invalid(v.reason)
                is UrlValidator.Result.Valid -> {
                    val outFile = File(cacheDir, sanitize(v.suggestedFileName))
                    val request = Request.Builder().url(v.normalized).get().build()
                    try {
                        PrivacyHttp.client.newCall(request).execute().use { resp ->
                            if (!resp.isSuccessful) return@withContext Result.Failed("HTTP ${resp.code}")
                            val body = resp.body ?: return@withContext Result.Failed("Empty body")
                            val total = body.contentLength()
                            body.byteStream().use { input ->
                                outFile.outputStream().use { output ->
                                    val buf = ByteArray(64 * 1024)
                                    var read: Int
                                    var written = 0L
                                    while (input.read(buf).also { read = it } >= 0) {
                                        coroutineContext.ensureActive()
                                        output.write(buf, 0, read)
                                        written += read
                                        if (total > 0) onProgress(written.toFloat() / total)
                                    }
                                }
                            }
                        }
                        Result.Ok(outFile)
                    } catch (e: Exception) {
                        Result.Failed(e.message ?: "Download error")
                    }
                }
            }
        }

    private fun sanitize(name: String): String =
        name.ifBlank { "video.mp4" }.takeLast(120)
}
