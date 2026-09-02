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
import com.hebsub.core.provider.omdb.Omdb
import com.hebsub.core.provider.omdb.OmdbMovie
import com.hebsub.core.subtitle.AssWriter
import com.hebsub.core.subtitle.SrtParser
import com.hebsub.core.subtitle.SrtWriter
import com.hebsub.core.subtitle.SubtitleCue
import com.hebsub.core.text.SubtitlePostProcessor
import java.io.File

/**
 * Executes the full flow for one video (updated spec §1–§5):
 *   chosen subtitle → embedded Hebrew → online Hebrew (hash) → embedded/online
 *   source (hash, translated) → transcribe (translated). Online matches now
 *   require an OpenSubtitles moviehash match (exact file), which stops unrelated
 *   subtitles being picked. Optionally enriches with OMDb (metadata + poster +
 *   bilingual PDF), embeds the Hebrew track in an MKV with a configurable
 *   background plate, and deletes intermediate files.
 */
class SubtitlePipeline(
    private val context: Context,
    private val settings: SettingsRepository,
    private val mediaTool: MediaTool,
    private val asrEngine: AsrEngine,
    private val outputDir: File,
) {
    private data class Acq(val cues: List<SubtitleCue>, val language: String?, val readyHebrew: Boolean)

    suspend fun run(
        videoFile: File,
        base: String,
        year: String?,
        imdbUrl: String? = null,
        subtitlePath: String? = null,
        bgTransparency: Int = 100,
        deleteData: Boolean = true,
    ) {
        try {
            PipelineBus.update(PipelineState.Running("קריאת נתוני הקובץ", null))
            val probe = runCatching { mediaTool.probe(videoFile) }
                .getOrElse { RunLog.error("probe failed", it); MediaProbe(emptyList(), null, 0) }
            RunLog.log("probe: subs=${probe.subtitleCount} audioLang=${probe.audioLanguage} durationMs=${probe.durationMs} embedded=${probe.embeddedSubtitles.map { it.index to it.language }}")
            RunLog.log("options: imdb=${imdbUrl ?: "-"} chosenSub=${subtitlePath ?: "-"} bgTransparency=$bgTransparency deleteData=$deleteData")

            // Build the subtitle file that will be muxed, plus a sidecar .srt.
            val built = buildSubtitle(videoFile, base, probe, subtitlePath, bgTransparency)
                ?: run {
                    RunLog.error("no subtitle produced")
                    PipelineBus.update(PipelineState.Failed("לא נמצאו כתוביות תואמות ולא ניתן היה ליצור אותן."))
                    return
                }

            // §2 — IMDb/OMDb enrichment (best-effort).
            var poster: File? = null
            val metadata = LinkedHashMap<String, String>()
            var pdf: File? = null
            val imdbId = Omdb.imdbId(imdbUrl)
            if (imdbId != null && settings.hasOmdbKey) {
                PipelineBus.update(PipelineState.Running("שליפת נתוני הסרט מ‑IMDb", null))
                val movie = OmdbService(settings.omdbApiKey).fetch(imdbId)
                if (movie != null) {
                    RunLog.log("OMDb: ${movie.title} (${movie.year}) runtime=${movie.runtime}")
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
                } else RunLog.error("OMDb: no data for $imdbId")
            } else if (imdbId != null) {
                RunLog.log("IMDb link given but no OMDb key — skipping enrichment")
            }

            // Build the MKV with the Hebrew track (+ metadata + poster).
            var mediaName: String? = null
            if (mediaTool.canEmbed) {
                PipelineBus.update(PipelineState.Running("יצירת קובץ מדיה עם מסלול עברית", null))
                val outMkv = File(outputDir, "$base.he.mkv")
                val muxed = runCatching {
                    mediaTool.remuxWithHebrewAndMeta(videoFile, built, probe.subtitleCount, outMkv, metadata, poster)
                }.getOrElse { RunLog.error("remux failed", it); false }
                if (muxed && outMkv.exists()) {
                    mediaName = outMkv.name
                    RunLog.log("wrote media file: ${outMkv.absolutePath} (${outMkv.length()} bytes)")
                    // §5 — keep only the MKV and the PDF (+ the run log, written later).
                    if (deleteData) cleanIntermediates(keep = setOfNotNull(outMkv.name, pdf?.name), video = videoFile)
                } else {
                    RunLog.log("media file not created (muxed=$muxed exists=${outMkv.exists()})")
                }
            }

            PipelineBus.update(PipelineState.Success(outputDir.absolutePath, "he-$base.srt", mediaName))
            RunLog.log("run finished OK")
        } catch (t: Throwable) {
            RunLog.error("run failed", t)
            val detail = "${t::class.java.simpleName}: ${t.message.orEmpty()}".trim().take(300)
            PipelineBus.update(PipelineState.Failed("שגיאה בעיבוד — $detail"))
        }
    }

    /**
     * Produce the subtitle file to mux (ASS with a plate when [bgTransparency] < 100,
     * else SRT) plus a `he-<base>.srt` sidecar. Returns null if nothing could be made.
     */
    private suspend fun buildSubtitle(
        videoFile: File, base: String, probe: MediaProbe, subtitlePath: String?, bgTransparency: Int,
    ): File? {
        // §4 — the user picked a subtitle: attach it as-is (parse to apply a plate if requested).
        if (subtitlePath != null) {
            val chosen = File(subtitlePath)
            RunLog.log("using chosen subtitle: ${chosen.name}")
            val ext = chosen.extension.lowercase()
            if (bgTransparency < 100 && (ext == "srt" || ext == "vtt")) {
                val cues = runCatching { SrtParser.parse(chosen.readText(Charsets.UTF_8)) }.getOrDefault(emptyList())
                if (cues.isNotEmpty()) return writeSubs(cues, base, bgTransparency)
            }
            // Copy verbatim into the folder and mux that.
            val dest = File(outputDir, "chosen-$base.${ext.ifBlank { "srt" }}")
            runCatching { chosen.copyTo(dest, overwrite = true) }
            if (ext == "srt") runCatching { chosen.copyTo(File(outputDir, "he-$base.srt"), overwrite = true) }
            return if (dest.exists()) dest else null
        }

        val acq = acquire(videoFile, base, probe) ?: return null
        RunLog.log("source acquired: cues=${acq.cues.size} lang=${acq.language} readyHebrew=${acq.readyHebrew}")
        val hebrewCues = if (acq.readyHebrew) acq.cues else translate(acq)
        val finalCues = SubtitlePostProcessor.process(hebrewCues)
        return writeSubs(finalCues, base, bgTransparency)
    }

    /** Writes the Hebrew sidecar + returns the file to mux (ASS if a plate is wanted). */
    private fun writeSubs(cues: List<SubtitleCue>, base: String, bgTransparency: Int): File {
        val srtText = SrtWriter.write(cues)
        File(outputDir, "he-$base.srt").writeText(srtText, Charsets.UTF_8)
        return if (bgTransparency < 100) {
            File(outputDir, "$base.he.ass").apply {
                writeText(AssWriter.write(cues, bgTransparency), Charsets.UTF_8)
                RunLog.log("wrote ASS plate (transparency=$bgTransparency%)")
            }
        } else {
            File(outputDir, "he-$base.srt")
        }
    }

    /** §4.1–§4.3: embedded Hebrew → online-hash Hebrew → embedded source → online-hash English → transcribe. */
    private suspend fun acquire(videoFile: File, base: String, probe: MediaProbe): Acq? {
        val onlineEnabled = settings.onlineSearchEnabled && settings.hasOpenSubtitlesKey
        val os = if (onlineEnabled) OpenSubtitlesService(settings.openSubtitlesApiKey) else null
        val hash = runCatching { OpenSubtitlesService.computeMovieHash(videoFile) }.getOrNull()
        RunLog.log("acquire: onlineEnabled=$onlineEnabled movieHash=${hash ?: "-"}")

        val hebrew = probe.embeddedSubtitles.filter { Language.isHebrew(it.language) }
        val source = probe.embeddedSubtitles.filterNot { Language.isHebrew(it.language) }

        // 1. Embedded Hebrew.
        for (t in hebrew) {
            PipelineBus.update(PipelineState.Running("חילוץ כתוביות עברית מהקובץ", null))
            parseEmbedded(videoFile, t.index, base, "he")?.let { return Acq(it, "he", true) }
        }
        // 2. Online Hebrew — hash match only.
        PipelineBus.update(PipelineState.Running("חיפוש כתוביות עברית (התאמת hash)", null))
        fetchHashMatch(os, listOf("he"), hash, base, base)?.let { return Acq(it.first, "he", true) }
        // 3. Embedded source (translate).
        for (t in source) {
            PipelineBus.update(PipelineState.Running("חילוץ כתוביות מהקובץ", null))
            val lang = Language.canonical(t.language) ?: "src"
            parseEmbedded(videoFile, t.index, base, lang)?.let { return Acq(it, Language.canonical(t.language), false) }
        }
        // 4. Online English — hash match only (translate).
        PipelineBus.update(PipelineState.Running("חיפוש כתוביות אנגלית (התאמת hash)", null))
        fetchHashMatch(os, listOf("en"), hash, base, base)?.let { return Acq(it.first, it.second, Language.isHebrew(it.second)) }
        // 5. Transcribe.
        if (!asrEngine.available) { RunLog.log("transcription unavailable (no Deepgram key)"); return null }
        PipelineBus.update(PipelineState.Running("חילוץ פס הקול מהקובץ", null))
        val audio = File(outputDir, "$base.audio.m4a")
        if (!mediaTool.extractAudioForAsr(videoFile, audio)) { RunLog.error("audio extraction failed"); return null }
        PipelineBus.update(PipelineState.Running("תמלול פס הקול", 0f))
        val track = asrEngine.transcribe(audio) { p -> PipelineBus.update(PipelineState.Running("תמלול פס הקול", p)) }
        return Acq(track.cues, Language.canonical(track.language), Language.isHebrew(track.language))
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

    /** Download the best HASH-MATCHED candidate for the languages, or null (spec §4.1). */
    private suspend fun fetchHashMatch(
        os: OpenSubtitlesService?, langs: List<String>, hash: String?, title: String, base: String,
    ): Pair<List<SubtitleCue>, String?>? {
        if (os == null || hash == null) return null
        val candidates = os.findCandidates(langs, hash, title, null).filter { it.hashMatch }
        RunLog.log("  hash-match candidates for $langs: ${candidates.size}")
        for (c in candidates.take(4)) {
            val srt = os.download(c.fileId) ?: continue
            val cues = SrtParser.parse(srt)
            if (cues.isEmpty()) continue
            val langTag = c.language?.takeIf { it.isNotBlank() } ?: "src"
            runCatching { File(outputDir, "$langTag-$base.srt").writeText(srt, Charsets.UTF_8) }
            RunLog.log("  accept hash-match fileId=${c.fileId} lang=${c.language} cues=${cues.size}")
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

    /** §5 — remove everything the run created except [keep] (and the video, replaced by the MKV). */
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
