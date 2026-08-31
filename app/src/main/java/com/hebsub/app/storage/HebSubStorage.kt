package com.hebsub.app.storage

import android.content.Context
import android.os.Build
import android.os.Environment
import java.io.File

/**
 * Owns the on-device folder layout introduced in the updated spec (§ב.1, §ב.2):
 *
 *   <primary shared storage>/HebSub/            ← created once, reused every run
 *       <video base name>/                       ← one folder per processed video
 *           <video file>                         ← the moved/downloaded video
 *           <video base>.<lang>.srt              ← extracted / downloaded source subs
 *           <video base>.he.srt                  ← the finished Hebrew subtitles
 *           <video base>.audio.m4a               ← extracted audio (ASR fallback)
 *           HebSub-log-*.txt                     ← the detailed run log (§ב.6)
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
     * named after the video inside HebSub, and return the new locations.
     */
    fun placeVideo(src: File, displayName: String): Placed {
        ensureRoot()
        val base = sanitize(displayName.substringBeforeLast('.').ifBlank { displayName })
        val dir = File(rootDir(), base).apply { mkdirs() }
        val dest = File(dir, sanitize(displayName))
        if (src.absolutePath != dest.absolutePath) {
            src.copyTo(dest, overwrite = true)
            runCatching { src.delete() }
        }
        return Placed(dir, dest, base)
    }

    private fun sanitize(name: String): String =
        name.replace(Regex("""[/\\:*?"<>|]"""), "_").trim().ifBlank { "video" }.take(120)

    companion object {
        const val ROOT_NAME = "HebSub"
    }
}
