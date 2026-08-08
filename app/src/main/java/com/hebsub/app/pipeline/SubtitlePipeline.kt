package com.hebsub.app.pipeline

import android.content.Context
import com.hebsub.app.asr.AsrEngine
import com.hebsub.app.data.SettingsRepository
import com.hebsub.app.io.OutputWriter
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
 * Executes the whole flow for one video, reporting through [PipelineBus].
 *
 * Precedence (built by the tested [SubtitleSourcePlanner]):
 *   ready Hebrew (embedded → online) → source to translate (embedded → online)
 *   → transcribe audio. Ready Hebrew skips translation; every other path asks
 *   the user LOCAL / CLOUD / STOP.
 */
class SubtitlePipeline(
    private val context: Context,
    private val settings: SettingsRepository,
    private val mediaTool: MediaTool,
    private val asrEngine: AsrEngine,
    private val cacheDir: File,
) {
    private data class Source(val cues: List<SubtitleCue>, val language: String?, val readyHebrew: Boolean)

    private val outputWriter = OutputWriter(context)

    suspend fun run(videoFile: File, originalDisplayName: String) {
        try {
            PipelineBus.update(PipelineState.Running("בדיקת הקובץ", null))
            val probe = mediaTool.probe(videoFile)
            val title = originalDisplayName.substringBeforeLast('.').ifBlank { originalDisplayName }
            val onlineEnabled = settings.onlineSearchEnabled && settings.hasOpenSubtitlesKey
            val os = if (onlineEnabled) OpenSubtitlesService(settings.openSubtitlesApiKey) else null
            val movieHash = runCatching { OpenSubtitlesService.computeMovieHash(videoFile) }.getOrNull()

            val plan = SubtitleSourcePlanner.plan(probe.embeddedSubtitles, probe.audioLanguage, onlineEnabled)

            val source = acquire(plan, videoFile, probe.subtitleCount, os, movieHash, title)
                ?: run {
                    PipelineBus.update(PipelineState.Failed("לא נמצאו כתוביות ולא ניתן היה ליצור אותן."))
                    return
                }

            // Decide the final Hebrew cues.
            val hebrewCues: List<SubtitleCue> = if (source.readyHebrew) {
                source.cues
            } else {
                when (PipelineBus.awaitTranslationChoice(cloudAvailable = settings.hasAnthropicKey)) {
                    TranslationChoice.STOP -> {
                        PipelineBus.update(PipelineState.Idle)
                        return
                    }
                    TranslationChoice.LOCAL -> {
                        PipelineBus.update(PipelineState.Running("תרגום מקומי", 0f))
                        MlKitTranslator().translate(source.cues, source.language) { d, t ->
                            PipelineBus.update(PipelineState.Running("תרגום מקומי", d.toFloat() / t))
                        }
                    }
                    TranslationChoice.CLOUD -> {
                        PipelineBus.update(PipelineState.Running("תרגום בענן", 0f))
                        ClaudeCloudTranslator(settings.anthropicApiKey, settings.claudeModel)
                            .translate(source.cues, source.language) { d, t ->
                                PipelineBus.update(PipelineState.Running("תרגום בענן", d.toFloat() / t))
                            }
                    }
                }
            }

            PipelineBus.update(PipelineState.Running("עיצוב כתוביות", null))
            val finalCues = SubtitlePostProcessor.process(hebrewCues)
            val srtFile = File(cacheDir, "hebrew.srt").apply { writeText(SrtWriter.write(finalCues), Charsets.UTF_8) }

            PipelineBus.update(PipelineState.Running("יצירת קובץ MKV", null))
            val outMkv = File(cacheDir, "$title.he.mkv")
            val muxed = runCatching {
                mediaTool.remuxWithHebrew(videoFile, srtFile, probe.subtitleCount, outMkv)
            }.getOrDefault(false)

            PipelineBus.update(PipelineState.Running("שמירה", null))
            val srtName = "$title.he.srt"
            outputWriter.publishSrt(srtFile, srtName)
            val videoName = outMkv.name
            if (muxed && outMkv.exists()) outputWriter.publishVideo(outMkv, videoName)

            PipelineBus.update(PipelineState.Success(videoName, srtName, muxed && outMkv.exists()))
        } catch (e: Exception) {
            PipelineBus.update(PipelineState.Failed(e.message ?: "שגיאה בעיבוד"))
        }
    }

    /** Walk the plan until a step yields Hebrew or source text. */
    private suspend fun acquire(
        plan: List<AcquisitionStep>,
        videoFile: File,
        existingSubCount: Int,
        os: OpenSubtitlesService?,
        movieHash: String?,
        title: String,
    ): Source? {
        for (step in plan) {
            when (step) {
                is AcquisitionStep.EmbeddedHebrew -> {
                    PipelineBus.update(PipelineState.Running("חילוץ כתוביות עברית מהקובץ", null))
                    parseEmbedded(videoFile, step.index)?.let { return Source(it, "he", true) }
                }
                is AcquisitionStep.OnlineHebrew -> {
                    PipelineBus.update(PipelineState.Running("חיפוש כתוביות עברית ברשת", null))
                    fetchOnline(os, listOf("he"), movieHash, title)?.let { (cues, _) ->
                        return Source(cues, "he", true)
                    }
                }
                is AcquisitionStep.EmbeddedSource -> {
                    PipelineBus.update(PipelineState.Running("חילוץ כתוביות מהקובץ לתרגום", null))
                    parseEmbedded(videoFile, step.index)?.let {
                        return Source(it, Language.canonical(step.language), false)
                    }
                }
                is AcquisitionStep.OnlineSource -> {
                    PipelineBus.update(PipelineState.Running("חיפוש כתוביות ברשת לתרגום", null))
                    // Preferred (source) language first, then any language.
                    (fetchOnline(os, step.preferredLanguages, movieHash, title)
                        ?: fetchOnline(os, emptyList(), movieHash, title))?.let { (cues, lang) ->
                        // A globally-best result might itself be Hebrew — treat as ready.
                        return Source(cues, lang, readyHebrew = Language.isHebrew(lang))
                    }
                }
                is AcquisitionStep.Transcribe -> {
                    val consent = PipelineBus.awaitAsrConsent(asrEngine.available)
                    if (!consent || !asrEngine.available) return null
                    PipelineBus.update(PipelineState.Running("תמלול פס הקול", 0f))
                    val wav = File(cacheDir, "audio.wav")
                    if (!mediaTool.extractAudioForAsr(videoFile, wav)) return null
                    val track = asrEngine.transcribe(wav) { p ->
                        PipelineBus.update(PipelineState.Running("תמלול פס הקול", p))
                    }
                    return Source(track.cues, Language.canonical(track.language), false)
                }
            }
        }
        return null
    }

    private suspend fun parseEmbedded(videoFile: File, streamIndex: Int): List<SubtitleCue>? {
        val out = File(cacheDir, "embedded_$streamIndex.srt")
        if (!mediaTool.extractSubtitle(videoFile, streamIndex, out)) return null
        val cues = SrtParser.parse(out.readText(Charsets.UTF_8))
        return cues.ifEmpty { null }
    }

    /** Returns (cues, canonicalLanguage) or null. */
    private suspend fun fetchOnline(
        os: OpenSubtitlesService?,
        languagePriority: List<String>,
        movieHash: String?,
        title: String,
    ): Pair<List<SubtitleCue>, String?>? {
        if (os == null) return null
        val best = os.findBest(languagePriority, movieHash, title) ?: return null
        val srt = os.download(best.fileId) ?: return null
        val cues = SrtParser.parse(srt)
        return if (cues.isEmpty()) null else cues to best.language
    }
}
