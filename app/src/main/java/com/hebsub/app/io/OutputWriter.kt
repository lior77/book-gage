package com.hebsub.app.io

import android.content.ContentValues
import android.content.Context
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File

/**
 * Publishes files to shared storage through MediaStore, which needs **no storage
 * permission** on Android 10+.
 *
 * History note: this was how the finished MKV and SRT reached the user before
 * the spec moved every output into the `HebSub/<film>/` folder that
 * [HebSubStorage][com.hebsub.app.storage.HebSubStorage] owns (which needs
 * All-files access, granted at onboarding). Today the only caller is the
 * Settings screen, which drops its connection-test log into Download/HebSub via
 * [publishLog]; [publishVideo] and [publishSrt] are kept as the permission-free
 * fallback path should All-files access ever be withdrawn.
 */
class OutputWriter(private val context: Context) {

    suspend fun publishVideo(source: File, displayName: String): Boolean =
        copyToMediaStore(source, displayName, "video/x-matroska", MediaStore.Video.Media.EXTERNAL_CONTENT_URI, Environment.DIRECTORY_MOVIES)

    suspend fun publishSrt(source: File, displayName: String): Boolean =
        copyToMediaStore(source, displayName, "application/x-subrip", MediaStore.Downloads.EXTERNAL_CONTENT_URI, Environment.DIRECTORY_DOWNLOADS)

    /** Write a plain-text diagnostic log to Download/HebSub. Local only. */
    suspend fun publishLog(content: String, displayName: String): Boolean = withContext(Dispatchers.IO) {
        val tmp = File(context.cacheDir, displayName)
        runCatching { tmp.writeText(content) }.getOrElse { return@withContext false }
        val ok = copyToMediaStore(tmp, displayName, "text/plain", MediaStore.Downloads.EXTERNAL_CONTENT_URI, Environment.DIRECTORY_DOWNLOADS)
        runCatching { tmp.delete() }
        ok
    }

    private suspend fun copyToMediaStore(
        source: File,
        displayName: String,
        mime: String,
        collection: android.net.Uri,
        topDir: String,
    ): Boolean = withContext(Dispatchers.IO) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            // Fallback for API 26–28: app-scoped external files dir (no permission).
            val dir = File(context.getExternalFilesDir(topDir), "HebSub").apply { mkdirs() }
            return@withContext runCatching { source.copyTo(File(dir, displayName), overwrite = true) }.isSuccess
        }
        val values = ContentValues().apply {
            put(MediaStore.MediaColumns.DISPLAY_NAME, displayName)
            put(MediaStore.MediaColumns.MIME_TYPE, mime)
            put(MediaStore.MediaColumns.RELATIVE_PATH, "$topDir/HebSub")
            put(MediaStore.MediaColumns.IS_PENDING, 1)
        }
        val resolver = context.contentResolver
        val uri = resolver.insert(collection, values) ?: return@withContext false
        try {
            resolver.openOutputStream(uri)?.use { out -> source.inputStream().use { it.copyTo(out) } }
                ?: return@withContext false
            values.clear()
            values.put(MediaStore.MediaColumns.IS_PENDING, 0)
            resolver.update(uri, values, null, null)
            true
        } catch (_: Exception) {
            resolver.delete(uri, null, null)
            false
        }
    }
}
