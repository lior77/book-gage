package com.hebsub.app.asr

import com.hebsub.app.log.RunLog
import com.hebsub.app.net.PrivacyHttp
import com.hebsub.core.speech.SpeechWord
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
 * Request shape, and why:
 *  - `model=nova-3` by default. It is Deepgram's current model, generally
 *    available for Spanish since September 2025, and the one they publish as
 *    markedly better on noise, crosstalk and distant speech — which is what film
 *    audio is. If the service rejects the model for a language, the same request
 *    is repeated on `nova-2` and the fallback is logged.
 *  - `language=` is declared explicitly whenever the pipeline knows it. Detection
 *    is asked for only when nothing knows the language; a wrong guess there means
 *    the whole film transcribed in the wrong language, so the pipeline asks on
 *    the first piece only and declares the answer for the rest.
 *  - `punctuate=true` and NOT `smart_format`: smart formatting rewrites numbers,
 *    dates and the like, and Deepgram's own forum records it adding errors to
 *    conversational speech. Punctuation is what the segmenter needs.
 *  - Words, not utterances. The pipeline cuts subtitles itself from the word
 *    timings, so an utterance boundary is nothing it needs.
 *
 * Privacy (spec §12): only the audio bytes are sent — no device or user
 * identifiers. The key is the user's own, entered in Settings and stored
 * encrypted.
 */
class DeepgramAsrEngine(private val apiKey: String) : AsrEngine {

    override val available: Boolean get() = apiKey.isNotBlank()

    override suspend fun transcribe(audio: File, language: String?, model: String): AsrResult =
        withContext(Dispatchers.IO) {
            require(apiKey.isNotBlank()) { "Missing Deepgram API key" }
            try {
                request(audio, language, model)
            } catch (e: RejectedRequest) {
                if (model == FALLBACK_MODEL) throw e
                RunLog.error("Deepgram rejected model=$model (${e.message}) — retrying on $FALLBACK_MODEL")
                request(audio, language, FALLBACK_MODEL)
            }
        }

    private class RejectedRequest(message: String) : RuntimeException(message)

    private fun request(audio: File, language: String?, model: String): AsrResult {
        val url = "https://api.deepgram.com/v1/listen".toHttpUrl().newBuilder()
            .addQueryParameter("model", model)
            .addQueryParameter("punctuate", "true")
            .apply {
                if (language != null) addQueryParameter("language", language)
                else addQueryParameter("detect_language", "true")
            }
            .build()

        val mime = when (audio.extension.lowercase()) {
            "flac" -> "audio/flac"
            "wav" -> "audio/wav"
            "ogg", "opus" -> "audio/ogg"
            else -> "audio/mp4"
        }
        val request = Request.Builder()
            .url(url)
            .header("Authorization", "Token $apiKey")
            .post(audio.asRequestBody(mime.toMediaType()))
            .build()

        RunLog.log("Deepgram: ${audio.name} ${audio.length() / 1024} KB ($mime) model=$model lang=${language ?: "detect"}")
        PrivacyHttp.client.newCall(request).execute().use { resp ->
            val body = resp.body?.string().orEmpty()
            if (!resp.isSuccessful) {
                val detail = "HTTP ${resp.code}: ${body.take(200)}"
                // 400/404 on a model/language pair the service does not offer.
                if (resp.code == 400 || resp.code == 404) throw RejectedRequest(detail)
                RunLog.error("Deepgram $detail")
                throw RuntimeException("Deepgram error ${resp.code}")
            }
            return parse(body, model)
        }
    }

    private fun parse(json: String, model: String): AsrResult {
        val root = JSONObject(json)
        val channel0 = root.optJSONObject("results")?.optJSONArray("channels")?.optJSONObject(0)
        val language = channel0?.optString("detected_language")?.ifBlank { null }
        val words = ArrayList<SpeechWord>()
        val arr = channel0?.optJSONArray("alternatives")?.optJSONObject(0)?.optJSONArray("words")
        if (arr != null) {
            for (i in 0 until arr.length()) {
                val w = arr.getJSONObject(i)
                val text = w.optString("punctuated_word").ifBlank { w.optString("word") }.trim()
                if (text.isEmpty()) continue
                val start = w.optDouble("start", -1.0)
                if (start < 0) continue
                val end = w.optDouble("end", start)
                words.add(SpeechWord((start * 1000).toLong(), (end * 1000).toLong(), text))
            }
        }
        return AsrResult(words, language, model, json)
    }

    private companion object {
        const val FALLBACK_MODEL = "nova-2"
    }
}
