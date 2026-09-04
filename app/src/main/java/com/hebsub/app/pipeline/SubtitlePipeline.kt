package com.hebsub.app.pipeline

import android.content.Context
import com.hebsub.app.asr.AsrEngine
import com.hebsub.app.data.SettingsRepository
import com.hebsub.app.io.MoviePdf
import com.hebsub.app.log.RunLog
import com.hebsub.app.media.EmbeddedSubtitle
import com.hebsub.app.media.MediaProbe
import com.hebsub.app.media.MediaTool
import com.hebsub.app.provider.OmdbService
import com.hebsub.app.provider.OpenSubtitlesService
import com.hebsub.app.translate.ClaudeCloudTranslator
import com.hebsub.app.translate.ClaudeText
import com.hebsub.app.translate.MlKitTranslator
import com.hebsub.core.lang.Language
import com.hebsub.core.provider.omdb.OmdbMovie
import com.hebsub.core.subtitle.AssParser
import com.hebsub.core.subtitle.AssStyleOptions
import com.hebsub.core.subtitle.AssWriter
import com.hebsub.core.subtitle.SubtitleTiming
import com.hebsub.core.subtitle.SubtitleTrack
import com.hebsub.core.subtitle.SrtParser
import com.hebsub.core.subtitle.SrtWriter
import com.hebsub.core.subtitle.SubtitleCue
import com.hebsub.core.text.CueSplitter
import com.hebsub.core.text.LineWrapper
import com.hebsub.core.text.SubtitlePostProcessor
import java.io.File

/**
 * Everything that happens to one video.
 *
 * **Where the Hebrew comes from** — [SourceStep], tried in order, first hit wins:
 * an embedded Hebrew track, a Hebrew hash match, an English hash match, the file the
 * user uploaded, an embedded foreign track, then the soundtrack itself.
 *
 * The app never *searches* for subtitles by title or IMDb id — that finds the right
 * film but not the right cut, which is how it once produced subtitles minutes out of
 * step. What is left is a hash lookup, which is an identity check, not a search.
 *
 * **Timing**: every source is used at exactly its own timing, with no exceptions.
 * Aligning subtitles to the soundtrack was tried and removed: the speech timeline
 * came from ASR, which transcribes background music as speech, so a scored song was
 * indistinguishable from dialogue and the alignment anchored on it. Correcting a
 * mistimed track is now a manual offset in the style editor, where the person
 * watching the film says how far out it is.
 *
 * The display-duration floor only ever extends a cue into the silence that follows
 * it, never moves a start; [SubtitleTiming.startTimesUnchanged] asserts that before
 * anything is written.
 *
 * Each step reports its outcome to [PipelineBus], so the progress screen shows which
 * of the six is being tried and how the earlier ones ended.
 */
class SubtitlePipeline(
    private val context: Context,
    private val settings: SettingsRepository,
    private val mediaTool: MediaTool,
    private val asrEngine: AsrEngine,
    private val outputDir: File,
) {
    /** Everything the user chose on the "add subtitles" screen. */
    data class RunOptions(
        val subtitlePath: String? = null,
        val styled: Boolean = false,
        val style: AssStyleOptions = AssStyleOptions.STYLED_DEFAULT,
        val minDisplayMs: Long = 0L,
        val deleteData: Boolean = true,
    )

    /** Cues plus where they came from; [readyHebrew] means no translation is needed. */
    private data class Acq(
        val cues: List<SubtitleCue>,
        val language: String?,
        val readyHebrew: Boolean,
        val source: String,
        /** True when the cues are a speech recogniser's output, not a written subtitle. */
        val machine: Boolean = false,
    )

    /** Cached transcript: at most one Deepgram call per run (see [speechTrack]). */
    private var asrTrack: SubtitleTrack? = null
    private var asrAttempted = false

    private companion object {
        // Bundled Hebrew font embedded into the MKV for the ASS plate track.
        // The family name must match the TTF's internal name-table family (nameID 1).
        const val HEBREW_FONT_FAMILY = "Alef"
        const val HEBREW_FONT_FILE = "Alef-Regular.ttf"
    }

    suspend fun run(
        videoFile: File,
        base: String,
        year: String?,
        imdbId: String? = null,
        movie: OmdbMovie? = null,
        options: RunOptions = RunOptions(),
    ) {
        try {
            PipelineBus.update(PipelineState.Running("קריאת נתוני הקובץ", null))
            val probe = runCatching { mediaTool.probe(videoFile) }
                .getOrElse { RunLog.error("probe failed", it); MediaProbe(emptyList(), null, 0) }
            RunLog.log("probe: subs=${probe.subtitleCount} audioLang=${probe.audioLanguage} durationMs=${probe.durationMs} embedded=${probe.embeddedSubtitles.map { it.index to it.language }}")
            RunLog.log(
                "options: imdbId=${imdbId ?: "-"} omdb=${movie != null} chosenSub=${options.subtitlePath ?: "-"} " +
                    "styled=${options.styled} " +
                    "style=${if (options.styled) options.style.serialize() else "-"} " +
                    "minDisplayMs=${options.minDisplayMs} deleteData=${options.deleteData}"
            )

            val built = buildSubtitle(videoFile, base, probe, options)
                ?: run {
                    RunLog.error("no subtitle produced")
                    PipelineBus.update(PipelineState.Failed("לא נמצאו כתוביות תואמות ולא ניתן היה ליצור אותן."))
                    return
                }

            // §2 — metadata + poster + PDF from the OMDb record fetched by the service.
            var poster: File? = null
            val metadata = LinkedHashMap<String, String>()
            var pdf: File? = null
            if (imdbId != null) metadata["IMDB"] = imdbId        // embed the id even without OMDb
            if (movie != null) {
                val hebrewPlot = if (settings.hasAnthropicKey)
                    ClaudeText.toHebrew(settings.anthropicApiKey, settings.claudeModel, movie.plot)
                else null
                if (movie.hasPoster) {
                    val pf = File(outputDir, "$base.poster.jpg")
                    if (OmdbService(settings.omdbApiKey).downloadPoster(movie.poster, pf)) poster = pf
                }
                fillMetadata(metadata, movie, hebrewPlot, year)
                val pf = File(outputDir, "$base.pdf")
                if (MoviePdf.create(pf, movie, hebrewPlot, poster)) pdf = pf
                RunLog.log("OMDb enrich: poster=${poster != null} pdf=${pdf != null} hebrewPlot=${hebrewPlot != null}")
            }

            // Build the MKV with the Hebrew track (+ metadata + poster).
            var mediaName: String? = null
            if (mediaTool.canEmbed) {
                PipelineBus.update(PipelineState.Running("יצירת קובץ מדיה עם מסלול עברית", null))
                val outMkv = File(outputDir, "$base.he.mkv")
                // A styled ASS needs the bundled Hebrew font attached, or libass has
                // no Hebrew glyphs and the track renders as nothing at all.
                val isAss = built.extension.equals("ass", ignoreCase = true)
                val font = if (isAss) ensureHebrewFont() else null
                val muxed = runCatching {
                    mediaTool.remuxWithHebrewAndMeta(videoFile, built, probe.subtitleCount, outMkv, metadata, poster, font)
                }.getOrElse { RunLog.error("remux failed", it); false }
                if (muxed && outMkv.exists()) {
                    mediaName = outMkv.name
                    RunLog.log("wrote media file: ${outMkv.absolutePath} (${outMkv.length()} bytes)")
                    // Keep the MKV, the PDF, the poster and the SRT sidecar (+ the
                    // run log, written later). The sidecar survives the cleanup on
                    // purpose: it is the one file a player will let you load by hand.
                    if (options.deleteData) {
                        cleanIntermediates(
                            keep = setOfNotNull(outMkv.name, pdf?.name, poster?.name, "$base.he.srt", "$base.deepgram.jsonl"),
                            video = videoFile,
                        )
                    }
                } else {
                    RunLog.log("media file not created (muxed=$muxed exists=${outMkv.exists()})")
                }
            }

            PipelineBus.update(PipelineState.Success(outputDir.absolutePath, built.name, mediaName))
            RunLog.log("run finished OK")
        } catch (t: Throwable) {
            RunLog.error("run failed", t)
            val detail = "${t::class.java.simpleName}: ${t.message.orEmpty()}".trim().take(300)
            PipelineBus.update(PipelineState.Failed("שגיאה בעיבוד — $detail"))
        }
    }

    /**
     * Acquire the best available source, translate it if it is not already Hebrew,
     * and write the file that will be muxed. Returns null when there was nothing to
     * work from.
     */
    private suspend fun buildSubtitle(
        videoFile: File, base: String, probe: MediaProbe, options: RunOptions,
    ): File? {
        val acq = acquire(videoFile, base, probe, options) ?: return null
        RunLog.log("source: ${acq.source} — cues=${acq.cues.size} lang=${acq.language ?: "?"} readyHebrew=${acq.readyHebrew}")

        val hebrewCues = if (acq.readyHebrew) acq.cues else translate(acq)
        val processed = SubtitlePostProcessor.process(hebrewCues)
        val oversized = CueSplitter.countOversized(
            hebrewCues, LineWrapper.DEFAULT_MAX_CHARS, CueSplitter.DEFAULT_MAX_LINES,
        )
        RunLog.log(
            "layout: ${hebrewCues.size} cues → ${processed.size} (split $oversized over the two-line budget); " +
                "reading speed >${SubtitleTiming.MAX_CPS.toInt()} cps on ${SubtitleTiming.tooFast(processed)} cues"
        )

        // §8 — a floor on how long each line stays up, taken only from the silence
        // that follows it. §7 says the source timing must survive, so prove it did.
        val timed = SubtitleTiming.ensureMinimumDuration(processed, options.minDisplayMs)
        if (options.minDisplayMs > 0) {
            val extended = timed.indices.count { timed[it].endMs != processed[it].endMs }
            RunLog.log("display duration: floor=${options.minDisplayMs}ms extended=$extended/${timed.size} cues")
        }
        if (!SubtitleTiming.startTimesUnchanged(processed, timed)) {
            // Defensive: the display floor must never shift when a line appears.
            RunLog.error("display-duration pass moved a start time — keeping the source timing")
            return writeSubs(processed, base, options)
        }
        return writeSubs(timed, base, options)
    }

    /**
     * Writes the Hebrew subtitle to mux: a styled ASS when the user asked for one
     * (§9), otherwise a plain SRT. Only one file is written — a parallel SRT
     * alongside an ASS just gave players a second, unstyled Hebrew track to pick.
     */
    private fun writeSubs(cues: List<SubtitleCue>, base: String, options: RunOptions): File {
        // A plain SRT is always written to the folder, whichever kind is muxed.
        // It costs nothing, and it is the only form a player will accept when you
        // ask it to load a subtitle file by hand — VLC's picker lists .srt and not
        // .ass — so there is always something to fall back to and something to
        // compare the muxed track against.
        val srt = File(outputDir, "$base.he.srt").apply {
            writeText(SrtWriter.write(cues), Charsets.UTF_8)
            RunLog.log("wrote SRT sidecar: $name (${cues.size} cues)")
        }
        if (!options.styled) return srt

        return File(outputDir, "$base.he.ass").apply {
            // Name the embedded Hebrew font in the style so libass uses it.
            writeText(
                AssWriter.write(cues, fontName = HEBREW_FONT_FAMILY, options = options.style),
                Charsets.UTF_8,
            )
            RunLog.log("wrote ASS (${options.style.serialize()}, font=$HEBREW_FONT_FAMILY)")
        }
    }

    /**
     * Copy the bundled Hebrew TTF out of assets into the app cache so FFmpeg can
     * attach it to the MKV. Returns the file, or null if the asset is missing.
     * The ASS style names [HEBREW_FONT_FAMILY]; embedding this font guarantees the
     * player's ASS renderer has real Hebrew glyphs (no tofu boxes).
     */
    private fun ensureHebrewFont(): File? = runCatching {
        val out = File(context.cacheDir, HEBREW_FONT_FILE)
        if (!out.exists() || out.length() == 0L) {
            context.assets.open("fonts/$HEBREW_FONT_FILE").use { input ->
                out.outputStream().use { input.copyTo(it) }
            }
        }
        RunLog.log("hebrew font ready: ${out.name} (${out.length()} bytes)")
        out.takeIf { it.exists() && it.length() > 0 }
    }.getOrElse { RunLog.error("hebrew font extract failed", it); null }

    /**
     * The §1 source order, tried top to bottom; the first step that yields cues wins
     * and everything below it is left untried. Each step reports its own outcome to
     * [PipelineBus] so the progress screen can show where the search is (§4).
     */
    private suspend fun acquire(videoFile: File, base: String, probe: MediaProbe, options: RunOptions): Acq? {
        val os = if (settings.hasOpenSubtitlesKey) OpenSubtitlesService(settings.openSubtitlesApiKey) else null
        val hash = runCatching { OpenSubtitlesService.computeMovieHash(videoFile) }.getOrNull()
        RunLog.log("acquire: hashLookup=${os != null && hash != null} movieHash=${hash ?: "-"}")

        val hebrew = probe.embeddedSubtitles.filter { Language.isHebrew(it.language) }
        val foreign = probe.embeddedSubtitles.filterNot { Language.isHebrew(it.language) }

        // 1.1 — a Hebrew track already in the file. Nothing to translate, nothing to time.
        embeddedTrack(videoFile, base, hebrew, SourceStep.EmbeddedHebrew, hebrewSource = true)
            ?.let { return it }

        // 1.2 / 1.3 — subtitles uploaded for a file with exactly this hash. A hash
        // match is an identity check, not a search: the timing is right by
        // construction, so both are used untouched.
        hashStep(os, hash, "he", base, SourceStep.HashHebrew)?.let { (cues, lang) ->
            return Acq(cues, lang, readyHebrew = true, source = "OpenSubtitles hash match (he)")
        }
        hashStep(os, hash, "en", base, SourceStep.HashEnglish)?.let { (cues, lang) ->
            return Acq(cues, lang, readyHebrew = Language.isHebrew(lang), source = "OpenSubtitles hash match ($lang)")
        }

        // 1.4 — the file the user chose for this video.
        chosenSubtitle(videoFile, base, options)?.let { return it }

        // 1.5 — a foreign track already in the container.
        embeddedTrack(videoFile, base, foreign, SourceStep.EmbeddedForeign, hebrewSource = false)
            ?.let { return it }

        // 1.6 — the audio itself. Derived from this very file, so already in step.
        return transcriptionStep(videoFile, base, probe)
    }

    /**
     * 1.1 / 1.5 — pull a subtitle track out of the container. A Hebrew track is used
     * as-is; a foreign one is translated, and (§2.2) may be aligned to the soundtrack
     * if the user asked for that. Returns null when there is no such track, or none
     * of them could be extracted.
     */
    private suspend fun embeddedTrack(
        videoFile: File,
        base: String,
        tracks: List<EmbeddedSubtitle>,
        step: SourceStep,
        hebrewSource: Boolean,
    ): Acq? {
        if (tracks.isEmpty()) {
            PipelineBus.step(step, StepStatus.Skipped, "אין רצועה כזו בקובץ")
            return null
        }
        PipelineBus.step(step, StepStatus.Running)
        PipelineBus.update(PipelineState.Running("${step.number} ${step.label}", null))
        for (t in tracks) {
            val lang = if (hebrewSource) "he" else (Language.canonical(t.language) ?: "src")
            val cues = parseEmbedded(videoFile, t.index, base, lang) ?: continue
            PipelineBus.stepUsed(step, "${cues.size} שורות · $lang")
            return Acq(
                cues,
                if (hebrewSource) "he" else Language.canonical(t.language),
                readyHebrew = hebrewSource,
                source = "embedded $lang (stream ${t.index})",
            )
        }
        PipelineBus.step(step, StepStatus.Failed, "החילוץ נכשל")
        return null
    }

    /** 1.2 / 1.3 — one hash lookup, with its outcome reported to the progress screen. */
    private suspend fun hashStep(
        os: OpenSubtitlesService?, hash: String?, lang: String, base: String, step: SourceStep,
    ): Pair<List<SubtitleCue>, String?>? {
        if (os == null || hash == null) {
            PipelineBus.step(step, StepStatus.Skipped, if (os == null) "אין מפתח OpenSubtitles" else "לא ניתן לחשב hash")
            return null
        }
        PipelineBus.step(step, StepStatus.Running)
        PipelineBus.update(PipelineState.Running("${step.number} ${step.label}", null))
        val found = fetchHashMatch(os, hash, listOf(lang), base)
        if (found == null) {
            PipelineBus.step(step, StepStatus.NotFound, "אין התאמה לקובץ הזה")
            return null
        }
        PipelineBus.stepUsed(step, "${found.first.size} שורות · ${found.second ?: lang}")
        return found
    }

    /**
     * 1.4 — the subtitle file the user picked. It gets the same treatment as any other
     * source: parsed, translated when it is not already Hebrew, written in the
     * requested form — and always at exactly the timing the file itself carries.
     */
    private suspend fun chosenSubtitle(videoFile: File, base: String, options: RunOptions): Acq? {
        val path = options.subtitlePath
        if (path == null) {
            PipelineBus.step(SourceStep.ChosenFile, StepStatus.Skipped, "לא נבחר קובץ")
            return null
        }
        PipelineBus.step(SourceStep.ChosenFile, StepStatus.Running)
        PipelineBus.update(PipelineState.Running("${SourceStep.ChosenFile.number} ${SourceStep.ChosenFile.label}", null))

        val chosen = File(path)
        val ext = chosen.extension.lowercase()
        RunLog.log("using chosen subtitle: ${chosen.name}")
        val raw = runCatching { chosen.readText(Charsets.UTF_8) }.getOrNull()
        if (raw.isNullOrBlank()) {
            RunLog.error("chosen subtitle is empty or unreadable")
            PipelineBus.step(SourceStep.ChosenFile, StepStatus.Failed, "הקובץ ריק או לא קריא")
            return null
        }

        // Keep the original alongside the outputs for reference.
        runCatching { chosen.copyTo(File(outputDir, "chosen-$base.${ext.ifBlank { "srt" }}"), overwrite = true) }

        val parsed = if (ext == "ass" || ext == "ssa" || AssParser.looksLikeAss(raw)) AssParser.parse(raw)
                     else SrtParser.parse(raw)
        if (parsed.isEmpty()) {
            RunLog.error("chosen subtitle produced no cues")
            PipelineBus.step(SourceStep.ChosenFile, StepStatus.Failed, "לא נמצאו שורות בקובץ")
            return null
        }

        val lang = Language.detectScript(parsed.joinToString("\n") { it.text })
        PipelineBus.stepUsed(SourceStep.ChosenFile, "${parsed.size} שורות · ${chosen.name.take(30)}")
        return Acq(
            parsed, lang,
            readyHebrew = Language.isHebrew(lang),
            source = "chosen file ${chosen.name}",
        )
    }

    /** 1.6 — transcribe the soundtrack. The last resort, and derived from this file. */
    private suspend fun transcriptionStep(videoFile: File, base: String, probe: MediaProbe): Acq? {
        PipelineBus.step(SourceStep.Transcription, StepStatus.Running)
        val track = speechTrack(videoFile, base, probe)
        if (track == null) {
            RunLog.log("transcription unavailable (no Deepgram key or it failed)")
            PipelineBus.step(SourceStep.Transcription, StepStatus.Skipped, "אין מפתח Deepgram או שהתמלול נכשל")
            return null
        }
        if (track.cues.isEmpty()) {
            RunLog.error("transcription produced no cues")
            PipelineBus.step(SourceStep.Transcription, StepStatus.Failed, "התמלול לא החזיר שורות")
            return null
        }
        PipelineBus.stepUsed(SourceStep.Transcription, "${track.cues.size} שורות · ${track.language ?: "?"}")
        return Acq(
            track.cues, Language.canonical(track.language),
            readyHebrew = Language.isHebrew(track.language), source = "audio transcription",
            machine = true,
        )
    }

    /**
     * Transcribe the audio and cache it, so a retry inside one run cannot bill a
     * second Deepgram call. Reached only when every other source has fallen through.
     * Returns null when transcription is unavailable or failed.
     */
    private suspend fun speechTrack(videoFile: File, base: String, probe: MediaProbe): SubtitleTrack? {
        if (asrAttempted) return asrTrack
        asrAttempted = true
        if (!asrEngine.available) { RunLog.log("speech: unavailable (no Deepgram key)"); return null }
        asrTrack = runCatching {
            SpeechTranscriber(mediaTool, asrEngine, outputDir).transcribe(videoFile, base, probe) { what, p ->
                PipelineBus.update(PipelineState.Running(what, p))
            }
        }.getOrElse { RunLog.error("speech: transcription failed", it); null }
        RunLog.log("speech: segments=${asrTrack?.cues?.size ?: 0} language=${asrTrack?.language ?: "-"}")
        return asrTrack
    }

    private suspend fun translate(acq: Acq): List<SubtitleCue> {
        val translated = if (settings.hasAnthropicKey) {
            RunLog.log("translating with Claude (${settings.claudeModel}) from ${acq.language}")
            PipelineBus.update(PipelineState.Running("תרגום חכם לעברית (ענן)", 0f))
            ClaudeCloudTranslator(settings.anthropicApiKey, settings.claudeModel)
                .translate(acq.cues, acq.language, machineTranscript = acq.machine) { d, t -> PipelineBus.update(PipelineState.Running("תרגום חכם לעברית (ענן)", d.toFloat() / t)) }
        } else {
            RunLog.log("translating with ML Kit (on-device) from ${acq.language}")
            PipelineBus.update(PipelineState.Running("תרגום לעברית (מקומי)", 0f))
            MlKitTranslator().translate(acq.cues, acq.language) { d, t -> PipelineBus.update(PipelineState.Running("תרגום לעברית (מקומי)", d.toFloat() / t)) }
        }
        return fillUntranslated(translated, acq.language)
    }

    /**
     * Second pass over the lines that came back still in the source language.
     *
     * The cloud translator does not always answer. When it does not, the cue used
     * to keep its source text and go straight to the screen — so a film could play
     * with a run of Spanish subtitles in the middle of the Hebrew, which is worse
     * than either language on its own. The on-device translator is a weaker
     * translator but an unconditional one, so it fills the gaps: an imperfect
     * Hebrew line is still a Hebrew line.
     */
    private suspend fun fillUntranslated(cues: List<SubtitleCue>, sourceLang: String?): List<SubtitleCue> {
        val stuck = cues.filter { stillForeign(it.text) }
        if (stuck.isEmpty()) return cues
        RunLog.error("fallback: ${stuck.size} of ${cues.size} lines are still not in Hebrew — trying the on-device translator")
        PipelineBus.update(PipelineState.Running("השלמת שורות שלא תורגמו (מקומי)", 0f))
        val fixed: List<SubtitleCue>? = runCatching {
            MlKitTranslator().translate(stuck, sourceLang) { d, t ->
                PipelineBus.update(PipelineState.Running("השלמת שורות שלא תורגמו (מקומי)", d.toFloat() / t))
            }
        }.getOrElse { RunLog.error("fallback translation failed — those lines stay in the source language", it); null }
        if (fixed == null) return cues

        val byIndex = fixed.filterNot { stillForeign(it.text) }.associateBy { it.index }
        val out = cues.map { byIndex[it.index] ?: it }
        RunLog.log("fallback: recovered ${byIndex.size} of ${stuck.size} lines with the on-device translator")
        if (byIndex.size < stuck.size) {
            RunLog.error("fallback: ${stuck.size - byIndex.size} lines remain in the source language")
        }
        return out
    }

    /**
     * True when a finished cue is still written in Latin script. `detectScript`
     * calls a line Hebrew as soon as a fifth of its letters are Hebrew, so a Hebrew
     * subtitle quoting a brand or a name does not trip this; the letter floor keeps
     * out short fragments where the script says nothing either way.
     */
    private fun stillForeign(text: String): Boolean {
        if (Language.isHebrew(Language.detectScript(text))) return false
        return text.count { it in 'a'..'z' || it in 'A'..'Z' } >= 8
    }

    private suspend fun parseEmbedded(videoFile: File, streamIndex: Int, base: String, lang: String): List<SubtitleCue>? {
        val out = File(outputDir, "$lang-$base.srt")
        if (!mediaTool.extractSubtitle(videoFile, streamIndex, out)) { RunLog.log("  extract stream $streamIndex failed"); return null }
        val cues = SrtParser.parse(out.readText(Charsets.UTF_8))
        RunLog.log("  extracted stream $streamIndex → ${cues.size} cues (${out.name})")
        return cues.ifEmpty { null }
    }

    /**
     * The only network lookup left: subtitles uploaded for a file with exactly this
     * hash. Nothing else is accepted — a title or IMDb search returns the right film
     * in the wrong cut, and the timing is then silently wrong. Returns the cues and
     * their language, or null when there is no key, no hash, or no match.
     */
    private suspend fun fetchHashMatch(
        os: OpenSubtitlesService?, hash: String?, langs: List<String>, base: String,
    ): Pair<List<SubtitleCue>, String?>? {
        if (os == null || hash == null) return null
        val candidates = os.findCandidates(langs, hash)
        RunLog.log("  hash candidates for $langs: ${candidates.size}")
        for (c in candidates.take(3)) {
            val srt = os.download(c.fileId) ?: continue
            val cues = SrtParser.parse(srt)
            if (cues.isEmpty()) continue
            val langTag = c.language?.takeIf { it.isNotBlank() } ?: "src"
            runCatching { File(outputDir, "$langTag-$base.srt").writeText(srt, Charsets.UTF_8) }
            RunLog.log("  accept fileId=${c.fileId} lang=${c.language} release='${c.release ?: "-"}' cues=${cues.size}")
            return cues to c.language
        }
        return null
    }

    private fun fillMetadata(meta: MutableMap<String, String>, movie: OmdbMovie, hebrewPlot: String?, year: String?) {
        fun put(k: String, v: String) { if (v.isNotBlank() && v != "N/A") meta[k] = v }
        put("title", movie.title)
        put("date", (year ?: movie.year))
        put("description", hebrewPlot ?: movie.plot)   // §2.1 Hebrew description
        put("synopsis", hebrewPlot ?: movie.plot)
        put("comment", movie.plot)                      // original (English) plot
        put("genre", movie.genre)
        put("IMDB", movie.imdbId)
        put("DIRECTOR", movie.director)
        put("ACTORS", movie.actors)
        put("IMDB_RATING", movie.imdbRating)
    }

    /** Remove everything the run created except [keep] (and the video, replaced by the MKV). */
    private fun cleanIntermediates(keep: Set<String>, video: File) {
        runCatching {
            outputDir.listFiles()?.forEach { f ->
                val isLog = f.name.endsWith(".txt")
                if (f.name !in keep && !isLog) {
                    if (f.delete()) RunLog.log("deleted intermediate: ${f.name}")
                }
            }
            // The original video is superseded by the MKV.
            if (video.exists() && video.name !in keep) { if (video.delete()) RunLog.log("deleted original video: ${video.name}") }
        }
    }
}
