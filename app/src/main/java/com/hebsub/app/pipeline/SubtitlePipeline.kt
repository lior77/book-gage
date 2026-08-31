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

/**
 * Executes the updated flow (spec §ב.3–§ב.4) for one video, writing every
 * artifact into the video's own folder inside HebSub. Reports progress through
 * [PipelineBus] (§ב.5); the detailed log (§ב.6) is written by the service.
 *
 * Precedence (built by the tested [SubtitleSourcePlanner] with
 * `preferEmbeddedSource = true`):
 *   embedded Hebrew (ready) → embedded source (extract → translate) →
 *   online Hebrew (ready) → online source (download → translate) →
 *   transcribe audio (→ translate).
 *
 * Ready-Hebrew paths skip translation; every source path is translated to
 * Hebrew automatically (Claude when a key is set — context-aware per §ב.3.4 —
 * otherwise on-device ML Kit). No mid-run prompts: after onboarding the app
 * "operates without restriction" (§א.2.1).
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

    suspend fun run(videoFile: File, baseName: String) {
        try {
            PipelineBus.update(PipelineState.Running("קריאת נתוני הקובץ", null))
            RunLog.log("mediaTool=${mediaTool::class.java.simpleName} outputDir=${outputDir.absolutePath}")
            val probe = runCatching { mediaTool.probe(videoFile) }
                .getOrElse { RunLog.error("probe failed", it); MediaProbe(emptyList(), null, 0) }
            RunLog.log("probe: subs=${probe.subtitleCount} audioLang=${probe.audioLanguage} embedded=${probe.embeddedSubtitles.map { it.index to it.language }}")

            val onlineEnabled = settings.onlineSearchEnabled && settings.hasOpenSubtitlesKey
            val os = if (onlineEnabled) OpenSubtitlesService(settings.openSubtitlesApiKey) else null
            val movieHash = runCatching { OpenSubtitlesService.computeMovieHash(videoFile) }.getOrNull()
            RunLog.log("title='$baseName' onlineEnabled=$onlineEnabled hasClaudeKey=${settings.hasAnthropicKey} hasDeepgram=${settings.hasDeepgramKey} movieHash=${movieHash ?: "-"}")

            val plan = SubtitleSourcePlanner.plan(
                probe.embeddedSubtitles, probe.audioLanguage, onlineEnabled,
                preferEmbeddedSource = true,
            )
            RunLog.log("plan=${plan.map { it::class.java.simpleName }}")

            val source = acquire(plan, videoFile, os, movieHash, baseName)
                ?: run {
                    RunLog.error("no subtitles acquired from any source")
                    PipelineBus.update(PipelineState.Failed("לא נמצאו כתוביות ולא ניתן היה ליצור אותן."))
                    return
                }
            RunLog.log("source acquired: cues=${source.cues.size} lang=${source.language} readyHebrew=${source.readyHebrew}")

            // §ב.3.4 / §ב.4.1 — translate source subtitles to Hebrew (ready Hebrew skips this).
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
            val srtName = "$baseName.he.srt"
            val srtFile = File(outputDir, srtName)
            srtFile.writeText(SrtWriter.write(finalCues), Charsets.UTF_8)
            RunLog.log("wrote Hebrew subtitles: ${srtFile.absolutePath}")

            PipelineBus.update(PipelineState.Success(outputDir.absolutePath, srtName))
            RunLog.log("run finished OK")
        } catch (t: Throwable) {
            RunLog.error("run failed", t)
            val detail = "${t::class.java.simpleName}: ${t.message.orEmpty()}".trim().take(300)
            PipelineBus.update(PipelineState.Failed("שגיאה בעיבוד — $detail"))
        }
    }

    /** Walk the plan until a step yields Hebrew or source text, saving files into the video folder. */
    private suspend fun acquire(
        plan: List<AcquisitionStep>,
        videoFile: File,
        os: OpenSubtitlesService?,
        movieHash: String?,
        base: String,
    ): Source? {
        for (step in plan) {
            RunLog.log("acquire step: ${step::class.java.simpleName}")
            when (step) {
                is AcquisitionStep.EmbeddedHebrew -> {
                    PipelineBus.update(PipelineState.Running("חילוץ כתוביות עברית מהקובץ", null))
                    parseEmbedded(videoFile, step.index, base, "he")?.let { return Source(it, "he", true) }
                }
                is AcquisitionStep.EmbeddedSource -> {
                    // §ב.3.2 — the file has English/source subs; extract an identical file.
                    PipelineBus.update(PipelineState.Running("חילוץ כתוביות מהקובץ", null))
                    val lang = Language.canonical(step.language) ?: "src"
                    parseEmbedded(videoFile, step.index, base, lang)?.let {
                        return Source(it, Language.canonical(step.language), false)
                    }
                }
                is AcquisitionStep.OnlineHebrew -> {
                    // §ב.3.1 — no embedded source subs: look for ready Hebrew online.
                    PipelineBus.update(PipelineState.Running("חיפוש כתוביות עברית ברשת", null))
                    fetchOnline(os, listOf("he"), movieHash, base, base, "he")?.let { (cues, _) ->
                        return Source(cues, "he", true)
                    }
                }
                is AcquisitionStep.OnlineSource -> {
                    // §ב.3.1 — else source/English online, to be translated.
                    PipelineBus.update(PipelineState.Running("חיפוש כתוביות מקור ברשת", null))
                    (fetchOnline(os, step.preferredLanguages, movieHash, base, base, "src")
                        ?: fetchOnline(os, emptyList(), movieHash, base, base, "src"))?.let { (cues, lang) ->
                        return Source(cues, lang, readyHebrew = Language.isHebrew(lang))
                    }
                }
                is AcquisitionStep.Transcribe -> {
                    // §ב.4 — nothing embedded and nothing online: build audio, then subs.
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

    /** Extract an embedded track to `<base>.<lang>.srt` in the video folder and parse it. */
    private suspend fun parseEmbedded(videoFile: File, streamIndex: Int, base: String, lang: String): List<SubtitleCue>? {
        val out = File(outputDir, "$base.$lang.srt")
        if (!mediaTool.extractSubtitle(videoFile, streamIndex, out)) {
            RunLog.log("  extract stream $streamIndex failed")
            return null
        }
        val cues = SrtParser.parse(out.readText(Charsets.UTF_8))
        RunLog.log("  extracted stream $streamIndex → ${cues.size} cues (${out.name})")
        return cues.ifEmpty { null }
    }

    /** Download the best online match to `<base>.<tag>.srt` in the video folder. Returns (cues, language). */
    private suspend fun fetchOnline(
        os: OpenSubtitlesService?,
        languagePriority: List<String>,
        movieHash: String?,
        title: String,
        base: String,
        tag: String,
    ): Pair<List<SubtitleCue>, String?>? {
        if (os == null) return null
        RunLog.log("  OpenSubtitles search langs=$languagePriority")
        val best = os.findBest(languagePriority, movieHash, title)
        if (best == null) { RunLog.log("  OpenSubtitles: no match"); return null }
        RunLog.log("  OpenSubtitles best fileId=${best.fileId} lang=${best.language}")
        val srt = os.download(best.fileId)
        if (srt == null) { RunLog.error("  OpenSubtitles download failed"); return null }
        val langTag = best.language?.takeIf { it.isNotBlank() } ?: tag
        runCatching { File(outputDir, "$base.$langTag.srt").writeText(srt, Charsets.UTF_8) }
        val cues = SrtParser.parse(srt)
        RunLog.log("  OpenSubtitles parsed ${cues.size} cues → saved $base.$langTag.srt")
        return if (cues.isEmpty()) null else cues to best.language
    }
}
