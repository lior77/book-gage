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
                segmentUtterance(utterances.getJSONObject(i), cues)
            }
            RunLog.log("Deepgram: ${utterances.length()} utterances → ${cues.size} cues")
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

    /**
     * Turn one Deepgram utterance into subtitle-sized cues.
     *
     * An utterance is everything said between two pauses, which in a conversation
     * can be twenty seconds and several hundred characters — a paragraph, not a
     * subtitle. Used whole it becomes a wall of text over the picture, and it makes
     * the translation coarse as well, because the model is handed a paragraph and
     * asked for one line back.
     *
     * The response already carries a timing for every word, so the utterance is cut
     * at the places a reader would cut it: the end of a sentence, a pause in the
     * speech, or the two-line budget — whichever comes first. Every cue then starts
     * and ends on a real word boundary, with times measured rather than estimated.
     */
    private fun segmentUtterance(u: JSONObject, out: MutableList<SubtitleCue>) {
        val transcript = u.optString("transcript").trim()
        val uStart = u.optDouble("start", 0.0)
        val uEnd = u.optDouble("end", uStart + 1.0)
        val words = u.optJSONArray("words")

        // Short enough already, or no word timings to cut it with.
        if (words == null || words.length() == 0 || transcript.length <= MAX_CHARS) {
            if (transcript.isNotEmpty()) out.add(cue(out.size + 1, uStart, uEnd, transcript))
            return
        }

        val text = StringBuilder()
        var segStart = 0.0
        var segEnd = 0.0
        var prevEnd = -1.0

        fun flush() {
            if (text.isEmpty()) return
            out.add(cue(out.size + 1, segStart, segEnd, text.toString()))
            text.setLength(0)
        }

        for (i in 0 until words.length()) {
            val w = words.getJSONObject(i)
            val token = w.optString("punctuated_word").ifBlank { w.optString("word") }.trim()
            if (token.isEmpty()) continue
            val wStart = w.optDouble("start", if (prevEnd < 0) uStart else prevEnd)
            val wEnd = w.optDouble("end", wStart)

            if (text.isNotEmpty()) {
                val tooWide = text.length + 1 + token.length > MAX_CHARS
                val pause = prevEnd >= 0 && wStart - prevEnd >= PAUSE_S
                val tooLong = wEnd - segStart > MAX_SPAN_S
                if (tooWide || pause || tooLong) flush()
            }
            if (text.isEmpty()) segStart = wStart else text.append(' ')
            text.append(token)
            segEnd = wEnd
            prevEnd = wEnd

            // A finished sentence is the best place to end a subtitle — but only once
            // there is enough on screen to be worth its own cue.
            if (text.length >= MIN_CHARS && token.last() in SENTENCE_END) flush()
        }
        flush()
    }

    private fun cue(index: Int, startSec: Double, endSec: Double, text: String): SubtitleCue =
        SubtitleCue(index, (startSec * 1000).toLong(), (endSec * 1000).toLong(), listOf(text))

    private companion object {
        /** Two subtitle lines' worth of text — the point at which a cue must be cut. */
        const val MAX_CHARS = 84

        /** Below this a cue is too short to stand alone, so a full stop is ignored. */
        const val MIN_CHARS = 24

        /** A silence this long between two words is a natural subtitle boundary. */
        const val PAUSE_S = 0.6

        /** No cue stays on screen longer than this without a break. */
        const val MAX_SPAN_S = 7.0

        val SENTENCE_END = charArrayOf('.', '!', '?', '…')
    }
}
