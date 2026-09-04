package com.hebsub.app.storage

import android.content.Context
import android.os.Build
import android.os.Environment
import java.io.File

/**
 * Owns the on-device folder layout (spec §ב.1, §ב.2):
 *
 *   <primary shared storage>/HebSub/            ← created once, reused every run
 *       HebSub-keys.json                         ← keys backup (Settings → save)
 *       crash-<timestamp>.txt                    ← only if the app crashed
 *       <name>-<year>/                           ← one folder per processed video
 *           <name>-<year>.he.mkv                 ← the video with the Hebrew track
 *           <name>-<year>.he.srt                 ← the Hebrew track as SRT (always)
 *           <name>-<year>.he.ass                 ← the styled track (when ASS chosen)
 *           <name>-<year>.deepgram.jsonl         ← raw recogniser replies (source 1.6)
 *           <name>-<year>.pdf / .poster.jpg      ← with an IMDb link only
 *           <name>-<year>.txt                    ← the detailed run log (§ב.6)
 *
 * While a run is in progress the folder also holds the original video, the
 * extracted/downloaded source subtitles (`<lang>-<name>.srt`), the dialogue audio
 * (`.dialogue.flac`) and its pieces; `SubtitlePipeline.cleanIntermediates` removes
 * them at the end unless the user unticked "delete intermediate files".
 *
 * The folder lives at the root ("home directory") of primary shared storage so
 * the user can browse it in any file manager, and — crucially — it survives an
 * app uninstall/reinstall (§א.1: reinstalling replaces the app but must not
 * delete the media it produced). Freely creating a top-level folder and moving
 * the user's video into it needs All-files access (MANAGE_EXTERNAL_STORAGE) on
 * Android 11+, which the onboarding screen requests.
 */
class HebSubStorage(private val context: Context) {

    data class Placed(val dir: File, val video: File, val base: String)

    /** True when we may freely read/write the shared-storage root. */
    fun hasAllFilesAccess(): Boolean =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            Environment.isExternalStorageManager()
        } else {
            context.checkSelfPermission(android.Manifest.permission.WRITE_EXTERNAL_STORAGE) ==
                android.content.pm.PackageManager.PERMISSION_GRANTED
        }

    /** `<shared storage>/HebSub`. */
    fun rootDir(): File = File(Environment.getExternalStorageDirectory(), ROOT_NAME)

    /** Ensure the HebSub root exists, creating it if needed (§ב.1). */
    fun ensureRoot(): File = rootDir().apply { if (!exists()) mkdirs() }

    /**
     * Move [src] (a temporary copy/download of the video) into a fresh folder
     * named [folderName] inside HebSub, storing the video as [videoFileName]
     * (spec §2.2/§2.3 — folder and video share the confirmed name). Returns the
     * new locations.
     */
    fun placeVideo(src: File, folderName: String, videoFileName: String): Placed {
        ensureRoot()
        val base = sanitize(folderName)
        val dir = File(rootDir(), base).apply { mkdirs() }
        val dest = File(dir, sanitize(videoFileName))
        if (src.absolutePath != dest.absolutePath) {
            src.copyTo(dest, overwrite = true)
            runCatching { src.delete() }
        }
        return Placed(dir, dest, base)
    }

    /** Keep spaces and hyphens (the folder is `<name>-<year>`); drop only path-hostile chars. */
    fun sanitize(name: String): String =
        name.replace(Regex("""[/\\:*?"<>|]"""), "_").trim().ifBlank { "video" }.take(120)

    companion object {
        const val ROOT_NAME = "HebSub"
    }
}
