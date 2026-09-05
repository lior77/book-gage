package com.hebsub.app.log

import android.content.Context
import android.os.Build
import com.hebsub.app.data.SettingsRepository
import com.hebsub.app.storage.HebSubStorage
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Records an install or an update, once, into the HebSub folder.
 *
 * There was no way to answer "which version is actually on the phone, when did
 * it get there, and did the update keep the API keys?" without opening the app
 * and reading the screens. Now the first launch of a new version drops
 * `HebSub/HebSub-install-<version>-<date>.txt` beside the films, next to the run
 * logs and the crash reports, so the state of an installation can be read from a
 * file manager.
 *
 * What it records: which version replaced which, the device and Android build,
 * the permissions the app actually holds, and **whether** each API key is
 * configured — never a key itself, and nothing that leaves the device (§12).
 */
object InstallLog {

    /**
     * Write the log when the running version differs from the one last seen.
     * Silent and best-effort: a first launch has no All-files access yet, so the
     * write simply fails and the next launch after the permission is granted
     * writes it instead.
     */
    fun recordIfNewVersion(context: Context, settings: SettingsRepository) {
        val version = runCatching {
            context.packageManager.getPackageInfo(context.packageName, 0).versionName
        }.getOrNull() ?: return
        val previous = settings.lastSeenVersion
        if (previous == version) return

        val storage = HebSubStorage(context)
        val ok = runCatching {
            val dir = storage.ensureRoot()
            val stamp = SimpleDateFormat("yyyyMMdd-HHmm", Locale.US).format(Date())
            File(dir, "HebSub-install-$version-$stamp.txt")
                .writeText(report(context, settings, version, previous), Charsets.UTF_8)
            true
        }.getOrDefault(false)

        // Only remember the version once the log is on disk, so a first launch
        // that happens before the storage permission is granted tries again.
        if (ok) settings.lastSeenVersion = version
    }

    private fun report(
        context: Context,
        settings: SettingsRepository,
        version: String,
        previous: String,
    ): String = buildString {
        val storage = HebSubStorage(context)
        appendLine("=== HebSub install ===")
        appendLine("date=${SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US).format(Date())}")
        appendLine(if (previous.isBlank()) "fresh install of $version" else "updated $previous -> $version")
        appendLine("package=${context.packageName}")
        appendLine("device=${Build.MANUFACTURER} ${Build.MODEL}  android=${Build.VERSION.RELEASE} (SDK ${Build.VERSION.SDK_INT})")
        appendLine("abis=${Build.SUPPORTED_ABIS.joinToString(",")}")
        appendLine("all-files access=${storage.hasAllFilesAccess()}")
        appendLine("HebSub folder=${storage.rootDir().absolutePath}")
        appendLine()
        // Presence only. A key never appears in a log, a file or the network.
        appendLine("API keys configured:")
        appendLine("  Anthropic (translation)   = ${yesNo(settings.hasAnthropicKey)}")
        appendLine("  OpenSubtitles (hash match)= ${yesNo(settings.hasOpenSubtitlesKey)}")
        appendLine("  Deepgram (transcription)  = ${yesNo(settings.hasDeepgramKey)}")
        appendLine("  OMDb (movie data)         = ${yesNo(settings.hasOmdbKey)}")
        appendLine("  translation model         = ${settings.claudeModel}")
        appendLine()
        if (previous.isNotBlank() && !settings.hasAnthropicKey && !settings.hasOpenSubtitlesKey &&
            !settings.hasDeepgramKey && !settings.hasOmdbKey
        ) {
            // The 3.7 symptom, stated plainly instead of surfacing as "no subtitles found".
            appendLine("NOTE: no API key is configured after this update. If the update required")
            appendLine("uninstalling the previous version, its encrypted settings were wiped with it.")
            appendLine("Restore them in Settings from HebSub-keys.json.")
            appendLine()
        }
        appendLine("Other logs: <film folder>/<film folder>.txt per run,")
        appendLine("HebSub-run-*.txt for a run that failed before its folder existed,")
        appendLine("crash-*.txt after a crash, HebSub-history.xlsx for the films processed.")
    }

    private fun yesNo(b: Boolean) = if (b) "yes" else "no"
}
