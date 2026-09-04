package com.hebsub.app.pipeline

import com.hebsub.app.asr.AsrEngine
import com.hebsub.app.log.RunLog
import com.hebsub.app.media.MediaProbe
import com.hebsub.app.media.MediaTool
import com.hebsub.core.speech.SpeechChunks
import com.hebsub.core.speech.SpeechSegmenter
import com.hebsub.core.speech.SpeechWord
import com.hebsub.core.subtitle.SubtitleTrack
import java.io.File

/**
 * Step 1.6 — subtitles from the soundtrack, done the way it has to be done for a
 * feature film rather than a voice memo.
 *
 * A film sent whole to the recogniser came back with almost half its dialogue
 * missing: a documented failure on long files, made worse by 48 kbps audio, an
 * older model, and dialogue buried under the score. So:
 *
 *  1. **The dialogue is extracted, not the mix** — centre channel or an enhanced
 *     stereo centre, speech brought up to level, lossless ([MediaTool.extractDialogueForAsr]).
 *  2. **The film goes up in pieces** of ten minutes with a few seconds of overlap,
 *     on the current model with the language declared, and the words are put back
 *     on the film's own clock ([SpeechChunks]).
 *  3. **Every long stretch with no words is checked.** If it is not silent, it is
 *     cut out, enhanced harder, and sent again. What that finds is added.
 *  4. **A coverage report** goes to the log, and every raw reply is kept beside
 *     the film, so the next "there are subtitles missing" can be looked at
 *     instead of guessed at.
 *
 * The words are then cut into subtitles by [SpeechSegmenter].
 */
class SpeechTranscriber(
    private val mediaTool: MediaTool,
    private val asr: AsrEngine,
    private val outputDir: File,
) {
    /** Progress: a Hebrew status line and a 0..1 fraction. */
    suspend fun transcribe(
        videoFile: File,
        base: String,
        probe: MediaProbe,
        onProgress: (String, Float) -> Unit,
    ): SubtitleTrack? {
        // 1. Audio the recogniser can hear.
        onProgress("חילוץ הדיאלוג מפס הקול", 0f)
        val layout = mediaTool.probeAudio(videoFile)
        RunLog.log("speech: audio layout channels=${layout?.channels ?: "?"} (${layout?.layout ?: "?"})")
        var audio = File(outputDir, "$base.dialogue.flac")
        val chain = mediaTool.extractDialogueForAsr(videoFile, audio, layout)
        if (chain != null) {
            RunLog.log("speech: dialogue audio via '$chain' — ${audio.length() / 1024} KB")
        } else {
            RunLog.error("speech: dialogue extraction failed on every chain — falling back to plain AAC")
            audio = File(outputDir, "$base.audio.m4a")
            if (!audio.exists() && !mediaTool.extractAudioForAsr(videoFile, audio)) {
                RunLog.error("speech: audio extraction failed"); return null
            }
        }
        val durationMs = probe.durationMs.takeIf { it > 0 }
            ?: mediaTool.probe(audio).durationMs.takeIf { it > 0 }
            ?: run { RunLog.error("speech: unknown duration"); return null }

        // 2. In pieces, with the language declared.
        val raw = File(outputDir, "$base.deepgram.jsonl")
        runCatching { raw.delete() }
        val chunks = SpeechChunks.plan(durationMs)
        var language: String? = probe.audioLanguage
        var model = PREFERRED_MODEL
        val placed = ArrayList<List<SpeechWord>>()
        RunLog.log("speech: ${chunks.size} pieces of ≤${SpeechChunks.DEFAULT_CHUNK_MS / 60000} min, language=${language ?: "detect on piece 1"}")
        for (chunk in chunks) {
            onProgress("תמלול פס הקול — קטע ${chunk.index + 1}/${chunks.size}", chunk.index.toFloat() / chunks.size * 0.8f)
            val piece = File(outputDir, "$base.piece${chunk.index}.flac")
            if (!mediaTool.cutAudio(audio, chunk.fromMs, chunk.toMs, piece, boost = false)) {
                RunLog.error("speech: could not cut piece ${chunk.index}"); continue
            }
            val result = runCatching { asr.transcribe(piece, language, model) }
                .getOrElse { RunLog.error("speech: piece ${chunk.index} failed", it); null }
            runCatching { piece.delete() }
            if (result == null) continue
            appendRaw(raw, chunk.index, chunk.fromMs, result.rawJson)
            model = result.model
            if (language == null && result.detectedLanguage != null) {
                language = result.detectedLanguage
                RunLog.log("speech: detected language=$language — declaring it for the remaining pieces")
            }
            val kept = SpeechChunks.place(chunk, result.words)
            placed += kept
            RunLog.log("speech: piece ${chunk.index} [${fmt(chunk.fromMs)}–${fmt(chunk.toMs)}] words=${result.words.size} kept=${kept.size} model=${result.model}")
        }
        var words = SpeechChunks.merge(placed)
        if (words.isEmpty()) { RunLog.error("speech: no words at all"); return null }

        // 3. Long stretches with no words: silent, or missed?
        // Longest first: a five-minute hole is more likely to hide a scene than a
        // fifty-second one, and the ceilings below may stop the loop early.
        val gaps = SpeechChunks.gaps(words, durationMs, GAP_MS).sortedByDescending { it.last - it.first }
        var silentGaps = 0; var rePassed = 0; var recovered = 0; var rePassMs = 0L
        val extra = ArrayList<List<SpeechWord>>()
        for ((n, gap) in gaps.withIndex()) {
            if (rePassed >= MAX_REPASS || rePassMs >= MAX_REPASS_MS) break
            val from = gap.first; val to = gap.last + 1
            // Measured on the SOURCE, not the prepared audio: speech normalisation
            // raises everything towards the peak, so on the enhanced file every gap
            // read as 100% non-silent and the measure said nothing.
            val live = mediaTool.nonSilentFraction(videoFile, from, to)
            if (live == null || live < LIVE_FRACTION) {
                silentGaps++
                RunLog.log("speech: gap ${fmt(from)}–${fmt(to)} non-silent=${pct(live)} — quiet, left alone")
                continue
            }
            onProgress("מעבר שני על קטע שקט ${n + 1}/${gaps.size}", 0.8f + 0.15f * n / gaps.size)
            val piece = File(outputDir, "$base.gap$n.flac")
            if (!mediaTool.cutAudio(audio, from, to, piece, boost = true)) continue
            val result = runCatching { asr.transcribe(piece, language, model) }
                .getOrElse { RunLog.error("speech: gap $n re-pass failed", it); null }
            runCatching { piece.delete() }
            rePassed++; rePassMs += to - from
            if (result == null) continue
            appendRaw(raw, 1000 + n, from, result.rawJson)
            val found = result.words.map { SpeechWord(it.startMs + from, it.endMs + from, it.text) }
            recovered += found.size
            extra += found
            RunLog.log("speech: gap ${fmt(from)}–${fmt(to)} non-silent=${pct(live)} — re-pass found ${found.size} words")
        }
        if (extra.isNotEmpty()) words = SpeechChunks.merge(listOf(words) + extra)

        // 4. Subtitles, and the report.
        onProgress("חיתוך התמלול לכתוביות", 0.97f)
        val cues = SpeechSegmenter.segment(words)
        val spokenMs = cues.sumOf { it.durationMs }
        val remaining = SpeechChunks.gaps(words, durationMs, GAP_MS)
        RunLog.log(
            "speech coverage: words=${words.size} cues=${cues.size} on-screen=${spokenMs / 60000} min of ${durationMs / 60000}; " +
                "gaps>${GAP_MS / 1000}s: ${gaps.size} (silent: $silentGaps, re-passed: $rePassed, recovered: $recovered words); " +
                "gaps left: ${remaining.size} (${remaining.sumOf { it.last + 1 - it.first } / 60000} min); model=$model language=${language ?: "?"}"
        )
        RunLog.log("speech: raw replies kept in ${raw.name}")
        return SubtitleTrack(cues, language)
    }

    private fun appendRaw(file: File, piece: Int, offsetMs: Long, json: String) {
        runCatching {
            file.appendText("""{"piece":$piece,"offsetMs":$offsetMs,"reply":$json}""" + "\n", Charsets.UTF_8)
        }.onFailure { RunLog.error("speech: could not keep raw reply", it) }
    }

    private fun fmt(ms: Long): String {
        val s = ms / 1000
        return "%02d:%02d:%02d".format(s / 3600, (s % 3600) / 60, s % 60)
    }

    private fun pct(x: Double?): String = if (x == null) "?" else "${(x * 100).toInt()}%"

    private companion object {
        const val PREFERRED_MODEL = "nova-3"

        /** A stretch this long with no words is worth a second look. */
        const val GAP_MS = 45_000L

        /** Below this share of non-silence a gap is taken to be genuinely quiet. */
        const val LIVE_FRACTION = 0.25

        /** Ceilings on the second pass, so a film of pure music cannot double its bill. */
        const val MAX_REPASS = 12
        const val MAX_REPASS_MS = 25 * 60_000L
    }
}
