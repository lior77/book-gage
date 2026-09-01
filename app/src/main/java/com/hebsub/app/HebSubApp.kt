package com.hebsub.app

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.os.Build
import android.os.Environment
import android.util.Log
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

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
