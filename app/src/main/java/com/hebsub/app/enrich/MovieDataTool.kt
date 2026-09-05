package com.hebsub.app.enrich

import android.content.Context
import com.hebsub.app.data.SettingsRepository
import com.hebsub.app.io.MoviePdf
import com.hebsub.app.log.RunLog
import com.hebsub.app.media.MediaTool
import com.hebsub.app.provider.OmdbService
import com.hebsub.app.storage.HebSubStorage
import com.hebsub.app.translate.ClaudeText
import com.hebsub.core.provider.omdb.Omdb
import com.hebsub.core.provider.omdb.OmdbMovie
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File

/**
 * Spec §3.3 — "add data" on its own: the user points at a film already in HebSub
 * and gives its IMDb link, and this fills in everything *around* the video —
 * a bilingual PDF, the poster image, canonical file and folder names, and the
 * film's data written into the container with its cover.
 *
 * What it must never do is touch the subtitles. The container is rebuilt with
 * every stream mapped and copied verbatim, so the Hebrew track that is already
 * there comes out byte-identical; only the tags and the cover attachment are new.
 */
class MovieDataTool(
    private val context: Context,
    private val settings: SettingsRepository,
    private val mediaTool: MediaTool,
) {
    /** One film folder under HebSub, and the video file inside it. */
    data class Target(val dir: File, val video: File) {
        val title: String get() = dir.name
    }

    /** What the run produced, for the confirmation screen. */
    data class Result(
        val folder: File,
        val pdf: File?,
        val poster: File?,
        val video: File,
        val embedded: Boolean,
        val renamed: Boolean,
    )

    sealed interface Outcome {
        data class Ok(val result: Result) : Outcome
        /** [reason] is already a finished Hebrew sentence for the UI. */
        data class Failed(val reason: String) : Outcome
    }

    /** Film folders under HebSub that hold a video file. */
    fun findTargets(): List<Target> {
        val root = HebSubStorage(context).rootDir()
        return root.listFiles()?.filter { it.isDirectory }.orEmpty().mapNotNull { dir ->
            dir.listFiles()
                ?.filter { it.isFile && it.extension.lowercase() in VIDEO_EXTENSIONS }
                // Prefer the finished Hebrew MKV when a folder holds both.
                ?.maxByOrNull { if (it.name.endsWith(".he.mkv", ignoreCase = true)) 1 else 0 }
                ?.let { Target(dir, it) }
        }.sortedByDescending { it.video.lastModified() }
    }

    /**
     * Fetch the film's data and write it around [target]. Progress is reported
     * through [onStage] so the screen can say what is happening; the whole thing
     * is one pass, and a failure leaves the original file untouched.
     */
    suspend fun apply(
        target: Target,
        imdbUrl: String,
        onStage: (String) -> Unit = {},
    ): Outcome = withContext(Dispatchers.IO) {
        val imdbId = Omdb.imdbId(imdbUrl)
            ?: return@withContext Outcome.Failed("הקישור אינו נראה כמו קישור ל‑IMDb.")
        if (!settings.hasOmdbKey) {
            return@withContext Outcome.Failed("נדרש מפתח OMDb בהגדרות כדי לשלוף את נתוני הסרט.")
        }
        RunLog.log("data: target=${target.dir.name} video=${target.video.name} imdbId=$imdbId")

        onStage("שליפת נתוני הסרט מ‑IMDb")
        val movie = OmdbService(settings.omdbApiKey).fetch(imdbId)
            ?: return@withContext Outcome.Failed("לא נמצאו נתונים ל‑$imdbId.")

        // Canonical naming: the folder and every file in it take the film's own
        // title and year, so a folder named after a release ("…1080p.WEB") becomes
        // the film's name (§3.3).
        val storage = HebSubStorage(context)
        val title = movie.title.takeIf { it.isNotBlank() && it != "N/A" }?.let(storage::sanitize)
        val year = movie.year.filter { it.isDigit() }.take(4).ifBlank { null }
        val wanted = listOfNotNull(title, year).joinToString("-").ifBlank { target.dir.name }

        onStage("שינוי שמות הקבצים")
        val renamed = rename(target, wanted)
        val dir = renamed.dir
        val base = renamed.video.name.substringBeforeLast('.')

        onStage("תרגום תקציר הסרט")
        val hebrewPlot = if (settings.hasAnthropicKey)
            ClaudeText.toHebrew(settings.anthropicApiKey, settings.claudeModel, movie.plot) else null

        onStage("הורדת תמונת הסרט")
        var poster: File? = null
        if (movie.hasPoster) {
            val pf = File(dir, "$base.poster.jpg")
            if (OmdbService(settings.omdbApiKey).downloadPoster(movie.poster, pf)) poster = pf
        }

        onStage("יצירת קובץ ה‑PDF")
        val pdfFile = File(dir, "$base.pdf")
        val pdf = if (MoviePdf.create(pdfFile, movie, hebrewPlot, poster)) pdfFile else null

        // Decision (ב): the data is always written into the container too, not only
        // to files beside it — a player then shows the film's name and description.
        onStage("הטמעת הנתונים בקובץ הוידאו")
        val metadata = LinkedHashMap<String, String>()
        metadata["IMDB"] = imdbId
        fillMetadata(metadata, movie, hebrewPlot)
        val embedded = embed(renamed.video, metadata, poster)

        RunLog.log("data: done folder=${dir.name} pdf=${pdf != null} poster=${poster != null} embedded=$embedded")
        Outcome.Ok(
            Result(
                folder = dir, pdf = pdf, poster = poster, video = renamed.video,
                embedded = embedded, renamed = renamed.dir.name != target.dir.name,
            )
        )
    }

    /**
     * Rebuild the video with the film's data, then swap it over the original —
     * and only once the rebuilt file is known-good, so a failure costs nothing.
     */
    private suspend fun embed(video: File, metadata: Map<String, String>, poster: File?): Boolean {
        if (!mediaTool.canEmbed) { RunLog.log("data: no media tool — tags not embedded"); return false }
        val tmp = File(video.parentFile, "${video.nameWithoutExtension}.data.${video.extension}")
        runCatching { tmp.delete() }
        val ok = runCatching { mediaTool.applyMovieData(video, tmp, metadata, poster) }
            .getOrElse { RunLog.error("data: embedding failed", it); false }
        if (!ok || !tmp.exists() || tmp.length() <= 0L) {
            RunLog.error("data: embedding produced no file — the original is untouched")
            runCatching { tmp.delete() }
            return false
        }
        return runCatching {
            if (!video.delete()) throw IllegalStateException("could not delete ${video.name}")
            if (!tmp.renameTo(video)) throw IllegalStateException("could not rename ${tmp.name}")
            RunLog.log("data: ${video.name} rebuilt with the film's data (${video.length()} bytes)")
            true
        }.getOrElse { RunLog.error("data: replacing the original failed", it); false }
    }

    /**
     * Rename the folder and every file in it to [wanted], keeping each file's
     * suffix (".he.mkv", ".he.ass", ".poster.jpg", …). Anything that cannot be
     * renamed is left where it is, and the target is returned as it now stands.
     */
    private fun rename(target: Target, wanted: String): Target {
        val oldBase = target.dir.name
        var dir = target.dir
        if (wanted != oldBase) {
            val candidate = File(target.dir.parentFile, wanted)
            // Never rename onto an existing folder — that would merge two films.
            if (!candidate.exists() && target.dir.renameTo(candidate)) {
                dir = candidate
                RunLog.log("data: folder '$oldBase' → '$wanted'")
            } else {
                RunLog.log("data: keeping the folder name '$oldBase' (target exists or rename failed)")
            }
        }
        var video = File(dir, target.video.name)
        val newBase = dir.name
        dir.listFiles()?.forEach { f ->
            if (!f.isFile) return@forEach
            // Everything after the first dot is the suffix: "name.he.mkv" → ".he.mkv".
            val dot = f.name.indexOf('.')
            if (dot <= 0) return@forEach
            val stem = f.name.substring(0, dot)
            val suffix = f.name.substring(dot)
            if (stem == newBase) return@forEach
            val dest = File(dir, newBase + suffix)
            if (!dest.exists() && f.renameTo(dest)) {
                if (f.absolutePath == video.absolutePath) video = dest
                RunLog.log("data: ${f.name} → ${dest.name}")
            }
        }
        return Target(dir, video)
    }

    private fun fillMetadata(meta: MutableMap<String, String>, movie: OmdbMovie, hebrewPlot: String?) {
        fun put(k: String, v: String) { if (v.isNotBlank() && v != "N/A") meta[k] = v }
        put("title", movie.title)
        put("date", movie.year)
        put("description", hebrewPlot ?: movie.plot)
        put("synopsis", hebrewPlot ?: movie.plot)
        put("comment", movie.plot)
        put("genre", movie.genre)
        put("IMDB", movie.imdbId)
        put("DIRECTOR", movie.director)
        put("ACTORS", movie.actors)
        put("IMDB_RATING", movie.imdbRating)
    }

    private companion object {
        val VIDEO_EXTENSIONS = setOf("mkv", "mp4", "m4v", "avi", "mov", "webm", "ts")
    }
}
