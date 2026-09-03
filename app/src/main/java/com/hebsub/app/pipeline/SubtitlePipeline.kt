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
import com.hebsub.core.provider.opensubtitles.OsCandidate
import com.hebsub.core.subtitle.AssWriter
import com.hebsub.core.subtitle.SubtitleAligner
import com.hebsub.core.subtitle.SubtitleMatch
import com.hebsub.core.subtitle.SubtitleTrack
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

    /** An online subtitle match; [hashMatch] = verified against this exact file. */
    private data class Fetched(val cues: List<SubtitleCue>, val language: String?, val hashMatch: Boolean)

    /** Title/synopsis of the film for context-aware translation (from OMDb), if known. */
    private var filmContext: String? = null

    /** The ORIGINAL file name (with its release tags) — compared to a subtitle's `release`. */
    private var releaseName: String? = null

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
        subtitlePath: String? = null,
        bgTransparency: Int = 100,
        deleteData: Boolean = true,
        releaseName: String? = null,
    ) {
        this.releaseName = releaseName
        try {
            PipelineBus.update(PipelineState.Running("קריאת נתוני הקובץ", null))
            val probe = runCatching { mediaTool.probe(videoFile) }
                .getOrElse { RunLog.error("probe failed", it); MediaProbe(emptyList(), null, 0) }
            RunLog.log("probe: subs=${probe.subtitleCount} audioLang=${probe.audioLanguage} durationMs=${probe.durationMs} embedded=${probe.embeddedSubtitles.map { it.index to it.language }}")
            RunLog.log("options: imdbId=${imdbId ?: "-"} omdb=${movie != null} chosenSub=${subtitlePath ?: "-"} bgTransparency=$bgTransparency deleteData=$deleteData")
            filmContext = buildFilmContext(movie, year)

            // Build the subtitle file that will be muxed, plus a sidecar .srt.
            // The IMDb id (when present) makes the online search pin the exact film.
            val built = buildSubtitle(videoFile, base, probe, subtitlePath, bgTransparency, imdbId)
                ?: run {
                    RunLog.error("no subtitle produced")
                    PipelineBus.update(PipelineState.Failed("לא נמצאו כתוביות תואמות ולא ניתן היה ליצור אותן."))
                    return
                }

            // §2 — metadata + poster + PDF from the OMDb record fetched by the service.
            var poster: File? = null
            val metadata = LinkedHashMap<String, String>()
            var pdf: File? = null
            if (imdbId != null) metadata["IMDB"] = "tt$imdbId"   // embed the id even without OMDb
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
                // When the primary track is a styled ASS plate, also mux the plain
                // SRT sidecar as a second, universally-selectable Hebrew track, and
                // embed the bundled Hebrew font so libass renders the ASS correctly.
                val isAss = built.extension.equals("ass", ignoreCase = true)
                val srtSidecar = File(outputDir, "he-$base.srt")
                val secondary = if (isAss && srtSidecar.exists()) srtSidecar else null
                val font = if (isAss) ensureHebrewFont() else null
                val muxed = runCatching {
                    mediaTool.remuxWithHebrewAndMeta(videoFile, built, secondary, probe.subtitleCount, outMkv, metadata, poster, font)
                }.getOrElse { RunLog.error("remux failed", it); false }
                if (muxed && outMkv.exists()) {
                    mediaName = outMkv.name
                    RunLog.log("wrote media file: ${outMkv.absolutePath} (${outMkv.length()} bytes)")
                    // §5 — keep the MKV, the PDF and the poster image (+ the run log,
                    // written later); the poster file is preserved for the user (§1.1).
                    if (deleteData) cleanIntermediates(keep = setOfNotNull(outMkv.name, pdf?.name, poster?.name), video = videoFile)
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
     * Produce the subtitle file to mux (ASS with a plate when [bgTransparency] < 100,
     * else SRT) plus a `he-<base>.srt` sidecar. Returns null if nothing could be made.
     */
    private suspend fun buildSubtitle(
        videoFile: File, base: String, probe: MediaProbe, subtitlePath: String?, bgTransparency: Int, imdbId: String?,
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

        val acq = acquire(videoFile, base, probe, imdbId) ?: return null
        RunLog.log("source acquired: cues=${acq.cues.size} lang=${acq.language} readyHebrew=${acq.readyHebrew}")
        val hebrewCues = if (acq.readyHebrew) acq.cues else translate(acq)
        val finalCues = SubtitlePostProcessor.process(hebrewCues)
        return writeSubs(finalCues, base, bgTransparency)
    }

    /**
     * Writes the Hebrew subtitle to mux. When a plate is requested we emit ONLY
     * the styled ASS (no parallel SRT file/track) — the ASS renders Hebrew
     * correctly thanks to the embedded font. Without a plate we emit the plain SRT.
     */
    private fun writeSubs(cues: List<SubtitleCue>, base: String, bgTransparency: Int): File {
        return if (bgTransparency < 100) {
            File(outputDir, "$base.he.ass").apply {
                // Name the embedded Hebrew font in the style so libass uses it.
                writeText(AssWriter.write(cues, bgTransparency, fontName = HEBREW_FONT_FAMILY), Charsets.UTF_8)
                RunLog.log("wrote ASS plate (transparency=$bgTransparency%, font=$HEBREW_FONT_FAMILY) — SRT sidecar skipped")
            }
        } else {
            File(outputDir, "he-$base.srt").apply {
                writeText(SrtWriter.write(cues), Charsets.UTF_8)
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

    /** §4.1–§4.3: embedded Hebrew → online Hebrew → embedded source → online English → transcribe. */
    private suspend fun acquire(videoFile: File, base: String, probe: MediaProbe, imdbId: String?): Acq? {
        val onlineEnabled = settings.onlineSearchEnabled && settings.hasOpenSubtitlesKey
        val os = if (onlineEnabled) OpenSubtitlesService(settings.openSubtitlesApiKey) else null
        val hash = runCatching { OpenSubtitlesService.computeMovieHash(videoFile) }.getOrNull()
        RunLog.log("acquire: onlineEnabled=$onlineEnabled movieHash=${hash ?: "-"} imdbId=${imdbId ?: "-"}")

        val hebrew = probe.embeddedSubtitles.filter { Language.isHebrew(it.language) }
        val source = probe.embeddedSubtitles.filterNot { Language.isHebrew(it.language) }

        // 1. Embedded Hebrew.
        for (t in hebrew) {
            PipelineBus.update(PipelineState.Running("חילוץ כתוביות עברית מהקובץ", null))
            parseEmbedded(videoFile, t.index, base, "he")?.let { return Acq(it, "he", true) }
        }
        // 2. Online Hebrew — by IMDb id (exact film) or hash match.
        PipelineBus.update(PipelineState.Running("חיפוש כתוביות עברית ברשת", null))
        fetchMatch(os, listOf("he"), hash, imdbId, base, probe, videoFile)?.let { return Acq(it.cues, "he", true) }
        // 3. Embedded source (translate). Timing is inherently correct — it ships
        //    inside this very file — so it beats any non-hash-matched download.
        for (t in source) {
            PipelineBus.update(PipelineState.Running("חילוץ כתוביות מהקובץ", null))
            val lang = Language.canonical(t.language) ?: "src"
            parseEmbedded(videoFile, t.index, base, lang)?.let { return Acq(it, Language.canonical(t.language), false) }
        }
        // 4. Online English — by IMDb id or hash match (translate).
        PipelineBus.update(PipelineState.Running("חיפוש כתוביות אנגלית ברשת", null))
        fetchMatch(os, listOf("en"), hash, imdbId, base, probe, videoFile)?.let { return Acq(it.cues, it.language, Language.isHebrew(it.language)) }
        // 5. Transcribe — reuses the transcript already made for verification, if any.
        val track = speechTrack(videoFile, base)
            ?: run { RunLog.log("transcription unavailable (no Deepgram key or it failed)"); return null }
        if (track.cues.isEmpty()) { RunLog.error("transcription produced no cues"); return null }
        return Acq(track.cues, Language.canonical(track.language), Language.isHebrew(track.language))
    }

    /**
     * Transcribe the audio ONCE per run and cache it. The same transcript serves
     * two purposes: the speech timeline used to verify/re-time downloaded
     * subtitles, and — if every subtitle source falls through — the transcription
     * itself. So Deepgram is called at most once even when several candidates are
     * checked. Returns null when transcription is unavailable or failed.
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
     * Verify a non-hash-matched subtitle against this film's actual audio, and
     * re-time it when it is merely offset/drifting. Returns the corrected cues, or
     * null when the subtitle simply does not belong to this audio — in which case
     * the caller moves on to the next candidate or source.
     */
    private suspend fun verifyAndSync(videoFile: File, base: String, cues: List<SubtitleCue>, tag: String): List<SubtitleCue>? {
        val track = speechTrack(videoFile, base)
        if (track == null || track.cues.isEmpty()) {
            RunLog.log("  $tag: no speech timeline — accepting with UNVERIFIED timing")
            return cues
        }
        PipelineBus.update(PipelineState.Running("סנכרון הכתוביות לפס הקול", null))
        val speech = track.cues.map { SubtitleAligner.Speech(it.startMs, it.endMs) }
        val r = SubtitleAligner.align(cues, speech)
        RunLog.log(
            "  $tag: align offset=${r.offsetMs}ms scale=${"%.5f".format(r.scale)} " +
                "fit=${"%.3f".format(r.fit)} baselineFit=${"%.3f".format(r.baselineFit)} apply=${r.shouldApply}"
        )
        if (!r.isTrustworthy) {
            RunLog.log("  $tag: REJECTED — fit ${"%.3f".format(r.fit)} < ${SubtitleAligner.MIN_FIT}; does not match this audio")
            return null
        }
        return if (r.shouldApply) SubtitleAligner.apply(cues, r) else cues
    }

    private suspend fun translate(acq: Acq): List<SubtitleCue> =
        if (settings.hasAnthropicKey) {
            RunLog.log("translating with Claude (${settings.claudeModel}) from ${acq.language}")
            PipelineBus.update(PipelineState.Running("תרגום חכם לעברית (ענן)", 0f))
            ClaudeCloudTranslator(settings.anthropicApiKey, settings.claudeModel, filmContext)
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
     * Find subtitles that genuinely belong to THIS file, in three tiers:
     *
     *  1. **Hash match** — the subtitle was uploaded for this exact file. Accepted
     *     outright; its timing is correct by construction.
     *  2. **Metadata screen** — plausible running length, and (when we cannot
     *     verify against audio) a non-conflicting frame rate. Candidates are tried
     *     in order of how well their `release` matches our original file name.
     *  3. **Audio verification** — the candidate is aligned against this film's own
     *     speech timeline; it is accepted only if the cues really land on speech,
     *     and is re-timed when it was merely offset or drifting.
     *
     * A candidate that fails is skipped, so the pipeline falls through to the next
     * candidate and ultimately to transcription instead of silently using
     * subtitles from the wrong cut.
     */
    private suspend fun fetchMatch(
        os: OpenSubtitlesService?, langs: List<String>, hash: String?, imdbId: String?,
        base: String, probe: MediaProbe, videoFile: File,
    ): Fetched? {
        if (os == null || (hash == null && imdbId == null)) return null
        val found = os.findCandidates(langs, hash, null, null, imdbId)
        // Prefer an exact-file match, then the release that looks most like ours.
        val candidates = found.sortedWith(
            compareByDescending<OsCandidate> { it.hashMatch }
                .thenByDescending { SubtitleMatch.releaseSimilarity(releaseName, it.release) }
        )
        RunLog.log("  candidates for $langs (imdbId=${imdbId ?: "-"} hash=${hash ?: "-"}): ${candidates.size} videoFps=${"%.3f".format(probe.videoFps)}")

        fun save(srt: String, lang: String?) {
            val langTag = lang?.takeIf { it.isNotBlank() } ?: "src"
            runCatching { File(outputDir, "$langTag-$base.srt").writeText(srt, Charsets.UTF_8) }
        }

        for (c in candidates.take(6)) {
            val sim = SubtitleMatch.releaseSimilarity(releaseName, c.release)
            val srt = os.download(c.fileId) ?: continue
            val cues = SrtParser.parse(srt)
            if (cues.isEmpty()) continue
            val span = cues.maxOf { it.endMs }
            val tag = "fileId=${c.fileId} lang=${c.language}"
            RunLog.log(
                "  candidate $tag hash=${c.hashMatch} fps=${c.fps} release='${c.release ?: "-"}' " +
                    "releaseSim=${"%.2f".format(sim)} cues=${cues.size} span=${span}ms video=${probe.durationMs}ms"
            )

            // Tier 1 — made for this exact file.
            if (c.hashMatch) {
                save(srt, c.language)
                RunLog.log("  accept $tag — hash match (timing trusted)")
                return Fetched(cues, c.language, true)
            }

            // Tier 2 — cheap metadata screen.
            if (!SubtitleMatch.durationFits(span, probe.durationMs)) {
                RunLog.log("  reject $tag — implausible length for this video"); continue
            }
            val fpsBad = SubtitleMatch.fpsConflict(c.fps, probe.videoFps)
            if (fpsBad && !asrEngine.available) {
                // We could not fix or verify the resulting drift, so don't risk it.
                RunLog.log("  reject $tag — fps ${c.fps} vs video ${"%.3f".format(probe.videoFps)} and no audio verification available"); continue
            }
            if (fpsBad) RunLog.log("  $tag: fps differs — audio alignment will correct the scale")

            // Tier 3 — prove it against this film's audio.
            val synced = verifyAndSync(videoFile, base, cues, tag) ?: continue
            save(srt, c.language)
            RunLog.log("  accept $tag — verified against audio")
            return Fetched(synced, c.language, false)
        }
        RunLog.log("  no candidate for $langs passed verification")
        return null
    }


    /** Film description for the translator (title, year, genre, people, synopsis) — null when OMDb is absent. */
    private fun buildFilmContext(movie: OmdbMovie?, year: String?): String? {
        if (movie == null) return null
        fun ok(v: String) = v.isNotBlank() && v != "N/A"
        val sb = StringBuilder()
        if (ok(movie.title)) sb.append("Title: ").append(movie.title)
        (year ?: movie.year).takeIf { ok(it) }?.let { sb.append(" (").append(it).append(')') }
        sb.append('\n')
        if (ok(movie.genre)) sb.append("Genre: ").append(movie.genre).append('\n')
        if (ok(movie.director)) sb.append("Director: ").append(movie.director).append('\n')
        if (ok(movie.actors)) sb.append("Cast: ").append(movie.actors).append('\n')
        if (ok(movie.plot)) sb.append("Synopsis: ").append(movie.plot).append('\n')
        return sb.toString().trim().ifBlank { null }
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
