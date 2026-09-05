package com.hebsub.app

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.os.Build
import android.os.Environment
import android.util.Log
import com.hebsub.app.data.SettingsRepository
import com.hebsub.app.log.InstallLog
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Process-wide setup, done once. Three things only:
 *
 *  1. The notification channel [ProcessingService][com.hebsub.app.service.ProcessingService]
 *     posts on while a run is in progress — Android will not let a foreground
 *     service start without one.
 *  2. A last-resort crash handler that writes `HebSub/crash-<timestamp>.txt` so an
 *     uncaught exception on the phone can be read the next day without a PC.
 *  3. [InstallLog], which records an install or an update into the HebSub folder
 *     the first time a new version runs.
 *
 * There is deliberately no dependency injection framework, no analytics SDK and
 * no crash-reporting service (§12: nothing about the device leaves it). Objects
 * are constructed where they are used; the shared singletons are `PipelineBus`
 * (pipeline ↔ UI state) and `RunLog` (the run's diagnostic log).
 */
class HebSubApp : Application() {

    override fun onCreate() {
        super.onCreate()
        installCrashHandler()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                NOTIFICATION_CHANNEL_ID,
                getString(R.string.notif_channel),
                NotificationManager.IMPORTANCE_LOW,
            )
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
        // On a background thread: opening the encrypted settings and writing a file
        // are both too slow to put in front of the first frame, and nothing on
        // screen depends on the result.
        Thread {
            runCatching { InstallLog.recordIfNewVersion(this, SettingsRepository(this)) }
        }.start()
    }

    /**
     * Write a crash report to /HebSub/crash-<timestamp>.txt before the process
     * dies, so an uncaught JVM exception anywhere in the app is diagnosable
     * without a PC. (Native SIGSEGV crashes still can't be caught here, but most
     * "the app stopped" cases are ordinary exceptions this captures.) The
     * previous default handler is still invoked so the OS shows its dialog.
     */
    private fun installCrashHandler() {
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->
            runCatching {
                val dir = File(Environment.getExternalStorageDirectory(), "HebSub").apply { mkdirs() }
                val ts = SimpleDateFormat("yyyyMMdd-HHmmss", Locale.US).format(Date())
                val header = buildString {
                    appendLine("=== HebSub crash ===")
                    val version = runCatching {
                        packageManager.getPackageInfo(packageName, 0).versionName
                    }.getOrNull() ?: "?"
                    appendLine("app=$version device=${Build.MANUFACTURER} ${Build.MODEL} android=${Build.VERSION.RELEASE} (SDK ${Build.VERSION.SDK_INT})")
                    appendLine("thread=${thread.name}")
                    appendLine()
                }
                File(dir, "crash-$ts.txt").writeText(header + Log.getStackTraceString(throwable))
            }
            previous?.uncaughtException(thread, throwable)
        }
    }

    companion object {
        const val NOTIFICATION_CHANNEL_ID = "hebsub_processing"
    }
}
