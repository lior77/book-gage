package com.hebsub.app.pipeline

import android.content.Context
import com.hebsub.app.asr.AsrEngine
import com.hebsub.app.data.SettingsRepository
import com.hebsub.app.io.MoviePdf
import com.hebsub.app.log.RunLog
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
import com.hebsub.core.subtitle.SubtitleAligner
import com.hebsub.core.subtitle.SubtitleTiming
import com.hebsub.core.subtitle.SubtitleTrack
import com.hebsub.core.subtitle.SrtParser
import com.hebsub.core.subtitle.SrtWriter
import com.hebsub.core.subtitle.SubtitleCue
import com.hebsub.core.text.SubtitlePostProcessor
import java.io.File

/**
 * Everything that happens to one video, in the order spec §6 lays down.
 *
 * **Where the Hebrew comes from**, first hit wins:
 *  1. a Hebrew track already inside the file;
 *  2. an OpenSubtitles Hebrew subtitle that hash-matches this exact file;
 *  3. the subtitle file the user chose for this video;
 *  4. a foreign track inside the file, translated;
 *  5. an OpenSubtitles English subtitle that hash-matches this exact file, translated;
 *  6. a transcript of the audio, translated.
 *
 * The app no longer *searches* for subtitles by title or IMDb id — that finds the
 * right film but not the right cut, which is how it once produced subtitles minutes
 * out of step. What is left is a hash lookup, which is an identity check, not a search.
 *
 * **Timing** (spec §7): every source above is used at exactly its own timing. The
 * one exception is the user's own file, which they may ask to align to the audio
 * ([RunOptions.syncUploaded]) — they chose it, so it may well be for another
 * release. The display-duration floor (§8) only ever extends a cue into the silence
 * that follows it, never moves a start; [SubtitleTiming.startTimesUnchanged] asserts
 * that before anything is written.
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
        val syncUploaded: Boolean = false,
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
                    "syncUploaded=${options.syncUploaded} styled=${options.styled} " +
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
                    // Keep the MKV, the PDF and the poster (+ the run log, written later).
                    if (options.deleteData) {
                        cleanIntermediates(keep = setOfNotNull(outMkv.name, pdf?.name, poster?.name), video = videoFile)
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
        return if (options.styled) {
            File(outputDir, "$base.he.ass").apply {
                // Name the embedded Hebrew font in the style so libass uses it.
                writeText(
                    AssWriter.write(cues, fontName = HEBREW_FONT_FAMILY, options = options.style),
                    Charsets.UTF_8,
                )
                RunLog.log("wrote ASS (${options.style.serialize()}, font=$HEBREW_FONT_FAMILY)")
            }
        } else {
            File(outputDir, "he-$base.srt").apply {
                writeText(SrtWriter.write(cues), Charsets.UTF_8)
                RunLog.log("wrote SRT (${cues.size} cues)")
            }
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

    /** The §6 source order. Returns the first source that yielded cues, or null. */
    private suspend fun acquire(videoFile: File, base: String, probe: MediaProbe, options: RunOptions): Acq? {
        val os = if (settings.hasOpenSubtitlesKey) OpenSubtitlesService(settings.openSubtitlesApiKey) else null
        val hash = runCatching { OpenSubtitlesService.computeMovieHash(videoFile) }.getOrNull()
        RunLog.log("acquire: hashLookup=${os != null && hash != null} movieHash=${hash ?: "-"}")

        val hebrew = probe.embeddedSubtitles.filter { Language.isHebrew(it.language) }
        val foreign = probe.embeddedSubtitles.filterNot { Language.isHebrew(it.language) }

        // 1. A Hebrew track already in the file — nothing to translate, nothing to time.
        for (t in hebrew) {
            PipelineBus.update(PipelineState.Running("חילוץ כתוביות עברית מהקובץ", null))
            parseEmbedded(videoFile, t.index, base, "he")?.let {
                return Acq(it, "he", readyHebrew = true, source = "embedded Hebrew (stream ${t.index})")
            }
        }
        // 2. Hebrew uploaded for this exact file. A hash match is an identity check:
        //    the timing is right by construction, so it is used untouched.
        fetchHashMatch(os, hash, listOf("he"), base)?.let { (cues, lang) ->
            return Acq(cues, lang, readyHebrew = true, source = "OpenSubtitles hash match (he)")
        }
        // 3. The file the user chose for this video (§6.2).
        chosenSubtitle(videoFile, base, options)?.let { return it }
        // 4. A foreign track in the file — its timing belongs to this very cut (§7).
        for (t in foreign) {
            PipelineBus.update(PipelineState.Running("חילוץ כתוביות מהקובץ", null))
            val lang = Language.canonical(t.language) ?: "src"
            parseEmbedded(videoFile, t.index, base, lang)?.let {
                return Acq(it, Language.canonical(t.language), readyHebrew = false, source = "embedded $lang (stream ${t.index})")
            }
        }
        // 5. English uploaded for this exact file, translated.
        fetchHashMatch(os, hash, listOf("en"), base)?.let { (cues, lang) ->
            return Acq(cues, lang, readyHebrew = Language.isHebrew(lang), source = "OpenSubtitles hash match ($lang)")
        }
        // 6. The audio itself (§6.3) — derived from this file, so already in step (§7.2).
        val track = speechTrack(videoFile, base)
            ?: run { RunLog.log("transcription unavailable (no Deepgram key or it failed)"); return null }
        if (track.cues.isEmpty()) { RunLog.error("transcription produced no cues"); return null }
        return Acq(
            track.cues, Language.canonical(track.language),
            readyHebrew = Language.isHebrew(track.language), source = "audio transcription",
        )
    }

    /**
     * §6.2 — the subtitle file the user picked. It gets the same treatment as any
     * other source: parsed, translated when it is not already Hebrew, written in the
     * requested form. Its timing is kept as-is unless the user asked to sync (§7.1),
     * which is the only place in the pipeline that re-times anything.
     */
    private suspend fun chosenSubtitle(videoFile: File, base: String, options: RunOptions): Acq? {
        val path = options.subtitlePath ?: return null
        val chosen = File(path)
        val ext = chosen.extension.lowercase()
        RunLog.log("using chosen subtitle: ${chosen.name}")
        val raw = runCatching { chosen.readText(Charsets.UTF_8) }.getOrNull()
        if (raw.isNullOrBlank()) { RunLog.error("chosen subtitle is empty or unreadable"); return null }

        // Keep the original alongside the outputs for reference.
        runCatching { chosen.copyTo(File(outputDir, "chosen-$base.${ext.ifBlank { "srt" }}"), overwrite = true) }

        val parsed = if (ext == "ass" || ext == "ssa" || AssParser.looksLikeAss(raw)) AssParser.parse(raw)
                     else SrtParser.parse(raw)
        if (parsed.isEmpty()) { RunLog.error("chosen subtitle produced no cues"); return null }

        val lang = Language.detectScript(parsed.joinToString("\n") { it.text })
        val cues = if (options.syncUploaded) syncToAudio(videoFile, base, parsed) else parsed
        return Acq(
            cues, lang,
            readyHebrew = Language.isHebrew(lang),
            source = "chosen file ${chosen.name}" + if (options.syncUploaded) " (synced)" else " (source timing)",
        )
    }

    /**
     * Transcribe the audio ONCE per run and cache it. The same transcript serves two
     * purposes: the speech timeline used to align a subtitle the user asked to sync,
     * and — when every other source falls through — the transcription itself. Returns
     * null when transcription is unavailable or failed.
     */
    private suspend fun speechTrack(videoFile: File, base: String): SubtitleTrack? {
        if (asrAttempted) return asrTrack
        asrAttempted = true
        if (!asrEngine.available) { RunLog.log("speech: unavailable (no Deepgram key)"); return null }
        PipelineBus.update(PipelineState.Running("חילוץ פס הקול מהקובץ", null))
        val audio = File(outputDir, "$base.audio.m4a")
        if (!audio.exists() && !mediaTool.extractAudioForAsr(videoFile, audio)) {
            RunLog.error("speech: audio extraction failed"); return null
        }
        PipelineBus.update(PipelineState.Running("תמלול פס הקול", 0f))
        asrTrack = runCatching {
            asrEngine.transcribe(audio) { p -> PipelineBus.update(PipelineState.Running("תמלול פס הקול", p)) }
        }.getOrElse { RunLog.error("speech: transcription failed", it); null }
        RunLog.log("speech: segments=${asrTrack?.cues?.size ?: 0} language=${asrTrack?.language ?: "-"}")
        return asrTrack
    }

    /**
     * §7.1 — align the user's own subtitle to this film's speech. If there is no
     * transcript, or the alignment is not convincing, the file is used at its own
     * timing rather than being pushed somewhere the evidence does not support.
     */
    private suspend fun syncToAudio(videoFile: File, base: String, cues: List<SubtitleCue>): List<SubtitleCue> {
        val track = speechTrack(videoFile, base)
        if (track == null || track.cues.isEmpty()) {
            RunLog.log("  sync: no speech timeline — keeping the file's own timing")
            return cues
        }
        PipelineBus.update(PipelineState.Running("סנכרון הכתוביות לפס הקול", null))
        val speech = track.cues.map { SubtitleAligner.Speech(it.startMs, it.endMs) }
        val r = SubtitleAligner.align(cues, speech)
        RunLog.log(
            "  sync: offset=${r.offsetMs}ms scale=${"%.5f".format(r.scale)} " +
                "fit=${"%.3f".format(r.fit)} baselineFit=${"%.3f".format(r.baselineFit)} apply=${r.shouldApply}"
        )
        if (!r.isTrustworthy) {
            RunLog.log("  sync: fit ${"%.3f".format(r.fit)} < ${SubtitleAligner.MIN_FIT} — keeping the file's own timing")
            return cues
        }
        return if (r.shouldApply) SubtitleAligner.apply(cues, r) else cues
    }

    private suspend fun translate(acq: Acq): List<SubtitleCue> =
        if (settings.hasAnthropicKey) {
            RunLog.log("translating with Claude (${settings.claudeModel}) from ${acq.language}")
            PipelineBus.update(PipelineState.Running("תרגום חכם לעברית (ענן)", 0f))
            ClaudeCloudTranslator(settings.anthropicApiKey, settings.claudeModel)
                .translate(acq.cues, acq.language) { d, t -> PipelineBus.update(PipelineState.Running("תרגום חכם לעברית (ענן)", d.toFloat() / t)) }
        } else {
            RunLog.log("translating with ML Kit (on-device) from ${acq.language}")
            PipelineBus.update(PipelineState.Running("תרגום לעברית (מקומי)", 0f))
            MlKitTranslator().translate(acq.cues, acq.language) { d, t -> PipelineBus.update(PipelineState.Running("תרגום לעברית (מקומי)", d.toFloat() / t)) }
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
        PipelineBus.update(PipelineState.Running("חיפוש כתוביות תואמות לקובץ", null))
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
