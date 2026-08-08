package com.hebsub.app.asr

import com.hebsub.app.log.RunLog
import com.hebsub.app.net.PrivacyHttp
import com.hebsub.core.subtitle.SubtitleCue
import com.hebsub.core.subtitle.SubtitleTrack
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.asRequestBody
import org.json.JSONObject
import java.io.File

/**
 * Cloud speech-to-text via Deepgram (spec §6 — create subtitles from the audio
 * track when no subtitles exist anywhere). Used only as a last resort and only
 * with the user's consent, because the audio is uploaded to Deepgram.
 *
 * Privacy (spec §12): only the audio bytes are sent — no device or user
 * identifiers. The key is the user's own, entered in Settings and stored
 * encrypted.
 */
class DeepgramAsrEngine(private val apiKey: String) : AsrEngine {

    override val available: Boolean get() = apiKey.isNotBlank()

    override suspend fun transcribe(wav: File, onProgress: (Float) -> Unit): SubtitleTrack =
        withContext(Dispatchers.IO) {
            require(apiKey.isNotBlank()) { "Missing Deepgram API key" }

            val url = "https://api.deepgram.com/v1/listen".toHttpUrl().newBuilder()
                .addQueryParameter("model", "nova-2")
                .addQueryParameter("smart_format", "true")
                .addQueryParameter("punctuate", "true")
                .addQueryParameter("utterances", "true")
                .addQueryParameter("detect_language", "true")
                .build()

            val mime = if (wav.extension.equals("wav", true)) "audio/wav" else "audio/mp4"
            val request = Request.Builder()
                .url(url)
                .header("Authorization", "Token $apiKey")
                .post(wav.asRequestBody(mime.toMediaType()))
                .build()

            RunLog.log("Deepgram: uploading ${wav.length() / 1024} KB ($mime)")
            onProgress(0.1f)

            PrivacyHttp.client.newCall(request).execute().use { resp ->
                val body = resp.body?.string().orEmpty()
                if (!resp.isSuccessful) {
                    RunLog.error("Deepgram HTTP ${resp.code}: ${body.take(200)}")
                    throw RuntimeException("Deepgram error ${resp.code}")
                }
                onProgress(0.9f)
                val track = parse(body)
                RunLog.log("Deepgram: ${track.cues.size} cues, language=${track.language}")
                onProgress(1f)
                track
            }
        }

    private fun parse(json: String): SubtitleTrack {
        val results = JSONObject(json).optJSONObject("results") ?: return SubtitleTrack(emptyList(), null)
        val channel0 = results.optJSONArray("channels")?.optJSONObject(0)
        val language = channel0?.optString("detected_language")?.ifBlank { null }

        val cues = ArrayList<SubtitleCue>()
        val utterances = results.optJSONArray("utterances")
        if (utterances != null && utterances.length() > 0) {
            for (i in 0 until utterances.length()) {
                val u = utterances.getJSONObject(i)
                val text = u.optString("transcript").trim()
                if (text.isEmpty()) continue
                val start = u.optDouble("start", 0.0)
                val end = u.optDouble("end", start + 1.0)
                cues.add(SubtitleCue(cues.size + 1, (start * 1000).toLong(), (end * 1000).toLong(), listOf(text)))
            }
        } else {
            // Fallback: group words into short cues.
            val words = channel0?.optJSONArray("alternatives")?.optJSONObject(0)?.optJSONArray("words")
            if (words != null) {
                var i = 0
                while (i < words.length()) {
                    val group = StringBuilder()
                    val startW = words.getJSONObject(i)
                    val start = startW.optDouble("start", 0.0)
                    var end = start
                    var count = 0
                    while (i < words.length() && count < 9) {
                        val w = words.getJSONObject(i)
                        group.append(w.optString("punctuated_word", w.optString("word"))).append(' ')
                        end = w.optDouble("end", end)
                        i++; count++
                    }
                    val text = group.toString().trim()
                    if (text.isNotEmpty()) {
                        cues.add(SubtitleCue(cues.size + 1, (start * 1000).toLong(), (end * 1000).toLong(), listOf(text)))
                    }
                }
            }
        }
        return SubtitleTrack(cues, language)
    }
}
