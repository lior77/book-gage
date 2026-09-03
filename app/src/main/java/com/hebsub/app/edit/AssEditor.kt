package com.hebsub.app.edit

import android.content.Context
import com.hebsub.app.data.SettingsRepository
import com.hebsub.app.log.RunLog
import com.hebsub.app.media.MediaTool
import com.hebsub.app.storage.HebSubStorage
import com.hebsub.core.subtitle.AssParser
import com.hebsub.core.subtitle.AssStyleOptions
import com.hebsub.core.subtitle.AssStyler
import com.hebsub.core.subtitle.AssWriter
import com.hebsub.core.subtitle.SrtParser
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File

/**
 * Restyles the Hebrew subtitle track of an MKV this app already produced, without
 * re-translating anything: the track is read back, its `[V4+ Styles]` line is
 * rewritten with the user's settings, and the container is rebuilt with video and
 * audio copied verbatim. The rebuilt file then replaces the original.
 */
class AssEditor(
    private val context: Context,
    private val mediaTool: MediaTool,
) {

    /** One editable movie: the folder HebSub created for it and its finished MKV. */
    data class Target(val dir: File, val mkv: File) {
        val title: String get() = dir.name
    }

    /** Everything the editor needs about a track it has loaded. */
    data class Loaded(
        val target: Target,
        val options: AssStyleOptions,
        /** The ASS document, or null when the track was a plain SRT we must convert. */
        val ass: String?,
        /** Set when the existing track is SRT — we build an ASS (and attach the font). */
        val srt: String?,
    )

    /** Movie folders under HebSub that contain a finished `*.he.mkv`. */
    fun findTargets(): List<Target> {
        val root = HebSubStorage(context).rootDir()
        val dirs = root.listFiles()?.filter { it.isDirectory }.orEmpty()
        return dirs.mapNotNull { dir ->
            dir.listFiles()
                ?.firstOrNull { it.isFile && it.name.endsWith(".he.mkv", ignoreCase = true) }
                ?.let { Target(dir, it) }
        }.sortedByDescending { it.mkv.lastModified() }
    }

    /**
     * Read the current subtitle track and its display settings. Prefers the `.he.ass`
     * left in the folder; otherwise pulls the track straight out of the MKV.
     */
    suspend fun load(target: Target): Loaded? = withContext(Dispatchers.IO) {
        val sidecar = target.dir.listFiles()
            ?.firstOrNull { it.isFile && it.name.endsWith(".he.ass", ignoreCase = true) }
        var text = sidecar?.let { runCatching { it.readText(Charsets.UTF_8) }.getOrNull() }

        if (text.isNullOrBlank()) {
            val tmp = File(context.cacheDir, "edit-extract.ass")
            runCatching { tmp.delete() }
            if (!mediaTool.extractSubtitleRaw(target.mkv, tmp)) {
                RunLog.error("edit: could not extract the subtitle track from ${target.mkv.name}")
                return@withContext null
            }
            text = runCatching { tmp.readText(Charsets.UTF_8) }.getOrNull()
        }
        if (text.isNullOrBlank()) {
            RunLog.error("edit: the extracted subtitle track was empty")
            return@withContext null
        }

        // What an unstyled or unreadable track starts from: the user's saved
        // defaults (§10) if they have any, else the §9.1 look.
        val fallback = SettingsRepository(context).assStyleDefaults
        val isAss = text.contains("[V4+ Styles]") || text.contains("[Script Info]")
        if (isAss) {
            val opts = AssStyler.read(text) ?: fallback
            RunLog.log("edit: loaded ASS from ${target.mkv.name} — $opts")
            Loaded(target, opts, ass = text, srt = null)
        } else {
            RunLog.log("edit: track in ${target.mkv.name} is SRT — it will be converted to a styled ASS")
            Loaded(target, fallback, ass = null, srt = text)
        }
    }

    /**
     * Write the new style and rebuild the MKV, replacing the original file.
     * Returns true when the replacement is on disk.
     */
    suspend fun apply(loaded: Loaded, options: AssStyleOptions): Boolean = withContext(Dispatchers.IO) {
        val target = loaded.target
        val base = target.mkv.name.removeSuffix(".he.mkv")

        // Build the restyled ASS. Converting from SRT also needs the font attached.
        val convertingFromSrt = loaded.ass == null
        val ass = if (convertingFromSrt) {
            val cues = SrtParser.parse(loaded.srt.orEmpty())
            if (cues.isEmpty()) { RunLog.error("edit: SRT track had no cues"); return@withContext false }
            AssWriter.write(cues, fontName = HEBREW_FONT_FAMILY, options = options)
        } else {
            AssStyler.restyle(loaded.ass!!, options, fontName = AssStyler.fontOf(loaded.ass) ?: HEBREW_FONT_FAMILY)
        }

        val assFile = File(target.dir, "$base.he.ass")
        runCatching { assFile.writeText(ass, Charsets.UTF_8) }
            .onFailure { RunLog.error("edit: could not write ${assFile.name}", it); return@withContext false }

        // ALWAYS re-attach the font: an ASS whose font is missing renders as nothing
        // at all (missing glyphs collapse the text and its plate to zero width).
        val font = ensureHebrewFont()
        if (font == null) RunLog.error("edit: the Hebrew font is unavailable — subtitles may not render")
        // Re-attach the cover too, since we no longer copy the source's attachments.
        val poster = target.dir.listFiles()
            ?.firstOrNull { it.isFile && it.name.endsWith(".poster.jpg", ignoreCase = true) }

        val tmpOut = File(target.dir, "$base.he.restyled.mkv")
        runCatching { tmpOut.delete() }

        RunLog.log("edit: rebuilding ${target.mkv.name} with $options (convertFromSrt=$convertingFromSrt font=${font?.name ?: "-"} poster=${poster?.name ?: "-"})")
        val ok = runCatching {
            mediaTool.replaceSubtitleTrack(
                inputMkv = target.mkv,
                sub = assFile,
                outMkv = tmpOut,
                title = if (options.hasPlate) "עברית עם רקע" else "עברית",
                font = font,
                poster = poster,
            )
        }.getOrElse { RunLog.error("edit: remux failed", it); false }

        if (!ok || !tmpOut.exists() || tmpOut.length() <= 0L) {
            RunLog.error("edit: rebuild produced no file")
            runCatching { tmpOut.delete() }
            return@withContext false
        }

        // Swap the rebuilt file over the original only once it is known-good.
        val original = target.mkv
        val ok2 = runCatching {
            if (!original.delete()) throw IllegalStateException("could not delete ${original.name}")
            if (!tmpOut.renameTo(original)) throw IllegalStateException("could not rename ${tmpOut.name}")
            true
        }.getOrElse { RunLog.error("edit: replacing the original failed", it); false }

        if (ok2) RunLog.log("edit: ${original.name} replaced (${original.length()} bytes)")
        ok2
    }

    /**
     * Render one frame of the film with [options] applied, so the settings can be
     * judged against the actual picture instead of after a full rebuild. Returns
     * the image, or null when this FFmpeg build cannot burn subtitles in — the
     * editor then simply carries on without a preview.
     */
    suspend fun preview(loaded: Loaded, options: AssStyleOptions): File? = withContext(Dispatchers.IO) {
        val ass = if (loaded.ass != null) {
            AssStyler.restyle(loaded.ass, options, fontName = AssStyler.fontOf(loaded.ass) ?: HEBREW_FONT_FAMILY)
        } else {
            val cues = SrtParser.parse(loaded.srt.orEmpty())
            if (cues.isEmpty()) return@withContext null
            AssWriter.write(cues, fontName = HEBREW_FONT_FAMILY, options = options)
        }
        val at = previewTimeMs(ass) ?: return@withContext null

        val font = ensureHebrewFont()
        val tmpAss = File(context.cacheDir, "preview.ass")
        val out = File(context.cacheDir, "preview.jpg")
        runCatching { tmpAss.writeText(ass, Charsets.UTF_8); out.delete() }

        val ok = runCatching {
            mediaTool.renderStyledFrame(loaded.target.mkv, tmpAss, font?.parentFile, at, out)
        }.getOrElse { RunLog.error("preview failed", it); false }
        if (!ok) return@withContext null
        RunLog.log("preview: rendered at ${at}ms (${out.length()} bytes)")
        // A fresh name each time, or Compose reuses the previous bitmap for the
        // unchanged path and the preview appears not to update.
        val stamped = File(context.cacheDir, "preview-${System.currentTimeMillis()}.jpg")
        if (out.renameTo(stamped)) stamped else out
    }

    /**
     * A timestamp worth previewing: a two-line cue if the film has one, since only
     * then is the line spacing visible; otherwise the longest cue, which shows the
     * plate at its widest. Both are taken from the middle of the film, where a
     * frame is likely to be a real scene rather than a title card.
     */
    private fun previewTimeMs(ass: String): Long? {
        val cues = AssParser.parse(ass).ifEmpty { return null }
        val middle = cues.drop(cues.size / 4).take(cues.size / 2).ifEmpty { cues }
        val cue = middle.firstOrNull { it.lines.size > 1 }
            ?: middle.maxByOrNull { it.text.length }
            ?: return null
        return (cue.startMs + cue.endMs) / 2
    }

    /** Copy the bundled Hebrew TTF out of assets so FFmpeg can attach it. */
    private fun ensureHebrewFont(): File? = runCatching {
        val out = File(context.cacheDir, HEBREW_FONT_FILE)
        if (!out.exists() || out.length() == 0L) {
            context.assets.open("fonts/$HEBREW_FONT_FILE").use { input ->
                out.outputStream().use { input.copyTo(it) }
            }
        }
        out.takeIf { it.exists() && it.length() > 0 }
    }.getOrElse { RunLog.error("edit: hebrew font extract failed", it); null }

    private companion object {
        const val HEBREW_FONT_FAMILY = "Alef"
        const val HEBREW_FONT_FILE = "Alef-Regular.ttf"
    }
}
