package com.hebsub.app.pipeline

import android.content.Context
import com.hebsub.app.asr.AsrEngine
import com.hebsub.app.data.SettingsRepository
import com.hebsub.app.log.RunLog
import com.hebsub.app.media.MediaProbe
import com.hebsub.app.media.MediaTool
import com.hebsub.app.provider.OpenSubtitlesService
import com.hebsub.app.translate.ClaudeCloudTranslator
import com.hebsub.app.translate.MlKitTranslator
import com.hebsub.core.lang.Language
import com.hebsub.core.pipeline.AcquisitionStep
import com.hebsub.core.pipeline.SubtitleSourcePlanner
import com.hebsub.core.subtitle.SrtParser
import com.hebsub.core.subtitle.SrtWriter
import com.hebsub.core.subtitle.SubtitleCue
import com.hebsub.core.text.SubtitlePostProcessor
import java.io.File
import kotlin.math.abs

/**
 * Executes the updated flow for one video, writing every artifact into the
 * video's own folder inside HebSub. Reports progress through [PipelineBus].
 *
 * Naming (spec §2.2): subtitle files are `<lang>-<folder>.srt`; the finished
 * Hebrew file is `he-<folder>.srt`.
 *
 * Online matches are verified against the video's duration (spec §3): a
 * downloaded subtitle is accepted only if its span is close to the video length,
 * so an unrelated file (a different movie) is rejected rather than translated.
 */
class SubtitlePipeline(
    private val context: Context,
    private val settings: SettingsRepository,
    private val mediaTool: MediaTool,
    private val asrEngine: AsrEngine,
    private val outputDir: File,
) {
    private data class Source(
        val cues: List<SubtitleCue>,
        val language: String?,
        val readyHebrew: Boolean,
    )

    /** @param base the confirmed folder name; @param year optional 4-digit year for the online search. */
    suspend fun run(videoFile: File, base: String, year: String?) {
        try {
            PipelineBus.update(PipelineState.Running("קריאת נתוני הקובץ", null))
            RunLog.log("mediaTool=${mediaTool::class.java.simpleName} outputDir=${outputDir.absolutePath}")
            val probe = runCatching { mediaTool.probe(videoFile) }
                .getOrElse { RunLog.error("probe failed", it); MediaProbe(emptyList(), null, 0) }
            val videoMs = probe.durationMs
            RunLog.log("probe: subs=${probe.subtitleCount} audioLang=${probe.audioLanguage} durationMs=$videoMs embedded=${probe.embeddedSubtitles.map { it.index to it.language }}")

            val onlineEnabled = settings.onlineSearchEnabled && settings.hasOpenSubtitlesKey
            val os = if (onlineEnabled) OpenSubtitlesService(settings.openSubtitlesApiKey) else null
            val movieHash = runCatching { OpenSubtitlesService.computeMovieHash(videoFile) }.getOrNull()
            // Search by the confirmed name, without the appended year folder-suffix.
            val searchTitle = if (!year.isNullOrBlank()) base.removeSuffix("-$year") else base
            RunLog.log("base='$base' searchTitle='$searchTitle' year='${year ?: "-"}' onlineEnabled=$onlineEnabled hasClaudeKey=${settings.hasAnthropicKey} hasDeepgram=${settings.hasDeepgramKey}")

            val plan = SubtitleSourcePlanner.plan(
                probe.embeddedSubtitles, probe.audioLanguage, onlineEnabled,
                preferEmbeddedSource = true,
            )
            RunLog.log("plan=${plan.map { it::class.java.simpleName }}")

            val source = acquire(plan, videoFile, os, movieHash, searchTitle, year, base, videoMs)
                ?: run {
                    RunLog.error("no matching subtitles from any source")
                    PipelineBus.update(PipelineState.Failed("לא נמצאו כתוביות תואמות ולא ניתן היה ליצור אותן."))
                    return
                }
            RunLog.log("source acquired: cues=${source.cues.size} lang=${source.language} readyHebrew=${source.readyHebrew}")

            // §ב.3.4 / §ב.4.1 — translate to Hebrew unless it is already Hebrew.
            val hebrewCues: List<SubtitleCue> = if (source.readyHebrew) {
                source.cues
            } else if (settings.hasAnthropicKey) {
                RunLog.log("translating with Claude (${settings.claudeModel}) from ${source.language}")
                PipelineBus.update(PipelineState.Running("תרגום חכם לעברית (ענן)", 0f))
                ClaudeCloudTranslator(settings.anthropicApiKey, settings.claudeModel)
                    .translate(source.cues, source.language) { d, t ->
                        PipelineBus.update(PipelineState.Running("תרגום חכם לעברית (ענן)", d.toFloat() / t))
                    }
            } else {
                RunLog.log("translating with ML Kit (on-device) from ${source.language}")
                PipelineBus.update(PipelineState.Running("תרגום לעברית (מקומי)", 0f))
                MlKitTranslator().translate(source.cues, source.language) { d, t ->
                    PipelineBus.update(PipelineState.Running("תרגום לעברית (מקומי)", d.toFloat() / t))
                }
            }
            RunLog.log("translation done: ${hebrewCues.size} Hebrew cues")

            PipelineBus.update(PipelineState.Running("עיצוב וסנכרון הכתוביות", null))
            val finalCues = SubtitlePostProcessor.process(hebrewCues)
            val srtName = "he-$base.srt"
            val srtFile = File(outputDir, srtName)
            val srtText = SrtWriter.write(finalCues)
            srtFile.writeText(srtText, Charsets.UTF_8)
            RunLog.log("wrote Hebrew subtitles: ${srtFile.absolutePath}")

            // Also save a player-auto-load sidecar named after the video, so VLC/MX
            // pick it up without the (crash-prone) manual external-subtitle picker.
            runCatching { File(outputDir, "$base.he.srt").writeText(srtText, Charsets.UTF_8) }

            // Create a media file with the Hebrew as a selectable embedded track
            // (fast lossless remux to MKV). Avoids external-subtitle selection.
            var mediaName: String? = null
            if (mediaTool.canEmbed) {
                PipelineBus.update(PipelineState.Running("יצירת קובץ מדיה עם מסלול עברית", null))
                val outMkv = File(outputDir, "$base.he.mkv")
                val muxed = runCatching {
                    mediaTool.remuxWithHebrew(videoFile, srtFile, probe.subtitleCount, outMkv)
                }.getOrElse { RunLog.error("remux failed", it); false }
                if (muxed && outMkv.exists()) {
                    mediaName = outMkv.name
                    RunLog.log("wrote media file: ${outMkv.absolutePath} (${outMkv.length()} bytes)")
                } else {
                    RunLog.log("media file not created (muxed=$muxed exists=${outMkv.exists()})")
                }
            }

            PipelineBus.update(PipelineState.Success(outputDir.absolutePath, srtName, mediaName))
            RunLog.log("run finished OK")
        } catch (t: Throwable) {
            RunLog.error("run failed", t)
            val detail = "${t::class.java.simpleName}: ${t.message.orEmpty()}".trim().take(300)
            PipelineBus.update(PipelineState.Failed("שגיאה בעיבוד — $detail"))
        }
    }

    private suspend fun acquire(
        plan: List<AcquisitionStep>,
        videoFile: File,
        os: OpenSubtitlesService?,
        movieHash: String?,
        title: String,
        year: String?,
        base: String,
        videoMs: Long,
    ): Source? {
        for (step in plan) {
            RunLog.log("acquire step: ${step::class.java.simpleName}")
            when (step) {
                is AcquisitionStep.EmbeddedHebrew -> {
                    PipelineBus.update(PipelineState.Running("חילוץ כתוביות עברית מהקובץ", null))
                    parseEmbedded(videoFile, step.index, base, "he")?.let { return Source(it, "he", true) }
                }
                is AcquisitionStep.EmbeddedSource -> {
                    PipelineBus.update(PipelineState.Running("חילוץ כתוביות מהקובץ", null))
                    val lang = Language.canonical(step.language) ?: "src"
                    parseEmbedded(videoFile, step.index, base, lang)?.let {
                        return Source(it, Language.canonical(step.language), false)
                    }
                }
                is AcquisitionStep.OnlineHebrew -> {
                    PipelineBus.update(PipelineState.Running("חיפוש כתוביות עברית ברשת", null))
                    fetchOnline(os, listOf("he"), movieHash, title, year, base, videoMs)?.let { (cues, _) ->
                        return Source(cues, "he", true)
                    }
                }
                is AcquisitionStep.OnlineSource -> {
                    PipelineBus.update(PipelineState.Running("חיפוש כתוביות מקור ברשת", null))
                    (fetchOnline(os, step.preferredLanguages, movieHash, title, year, base, videoMs)
                        ?: fetchOnline(os, emptyList(), movieHash, title, year, base, videoMs))?.let { (cues, lang) ->
                        return Source(cues, lang, readyHebrew = Language.isHebrew(lang))
                    }
                }
                is AcquisitionStep.Transcribe -> {
                    if (!asrEngine.available) {
                        RunLog.log("  transcription unavailable (no Deepgram key)")
                        return null
                    }
                    PipelineBus.update(PipelineState.Running("חילוץ פס הקול מהקובץ", null))
                    val audio = File(outputDir, "$base.audio.m4a")
                    if (!mediaTool.extractAudioForAsr(videoFile, audio)) {
                        RunLog.error("  audio extraction failed")
                        return null
                    }
                    RunLog.log("  audio extracted: ${audio.absolutePath}")
                    PipelineBus.update(PipelineState.Running("תמלול פס הקול", 0f))
                    val track = asrEngine.transcribe(audio) { p ->
                        PipelineBus.update(PipelineState.Running("תמלול פס הקול", p))
                    }
                    return Source(track.cues, Language.canonical(track.language), Language.isHebrew(track.language))
                }
            }
        }
        return null
    }

    /** Extract an embedded track to `<lang>-<base>.srt` in the video folder and parse it. */
    private suspend fun parseEmbedded(videoFile: File, streamIndex: Int, base: String, lang: String): List<SubtitleCue>? {
        val out = File(outputDir, "$lang-$base.srt")
        if (!mediaTool.extractSubtitle(videoFile, streamIndex, out)) {
            RunLog.log("  extract stream $streamIndex failed")
            return null
        }
        val cues = SrtParser.parse(out.readText(Charsets.UTF_8))
        RunLog.log("  extracted stream $streamIndex → ${cues.size} cues (${out.name})")
        return cues.ifEmpty { null }
    }

    /**
     * Search online, then download candidates best-first and keep the FIRST whose
     * duration matches the video (spec §3). Saves the accepted file as
     * `<lang>-<base>.srt`. Returns (cues, language) or null.
     */
    private suspend fun fetchOnline(
        os: OpenSubtitlesService?,
        languagePriority: List<String>,
        movieHash: String?,
        title: String,
        year: String?,
        base: String,
        videoMs: Long,
    ): Pair<List<SubtitleCue>, String?>? {
        if (os == null) return null
        RunLog.log("  OpenSubtitles search langs=$languagePriority title='$title' year='${year ?: "-"}'")
        val candidates = os.findCandidates(languagePriority, movieHash, title, year)
        if (candidates.isEmpty()) { RunLog.log("  OpenSubtitles: no results"); return null }
        for (c in candidates.take(MAX_CANDIDATES)) {
            val srt = os.download(c.fileId) ?: continue
            val cues = SrtParser.parse(srt)
            if (cues.isEmpty()) continue
            val spanMs = cues.maxOf { it.endMs }
            if (!durationMatches(spanMs, videoMs)) {
                RunLog.log("  reject fileId=${c.fileId} lang=${c.language} span=${spanMs}ms video=${videoMs}ms (duration mismatch)")
                continue
            }
            val langTag = c.language?.takeIf { it.isNotBlank() } ?: "src"
            runCatching { File(outputDir, "$langTag-$base.srt").writeText(srt, Charsets.UTF_8) }
            RunLog.log("  accept fileId=${c.fileId} lang=${c.language} cues=${cues.size} span=${spanMs}ms video=${videoMs}ms → $langTag-$base.srt")
            return cues to c.language
        }
        RunLog.log("  OpenSubtitles: no candidate matched the video duration")
        return null
    }

    /** True if the subtitle span is within tolerance of the video length (or the length is unknown). */
    private fun durationMatches(spanMs: Long, videoMs: Long): Boolean {
        if (videoMs <= 0L) return true          // unknown duration — can't verify, accept best-effort
        if (spanMs <= 0L) return false
        val tolerance = maxOf(120_000L, videoMs * 15 / 100) // 2 min or 15%, whichever is larger
        return abs(spanMs - videoMs) <= tolerance
    }

    private companion object {
        const val MAX_CANDIDATES = 6
    }
}
