package com.hebsub.app.log

import android.content.Context
import android.os.Build
import android.util.Log
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.text.SimpleDateFormat
import java.util.Collections
import java.util.Date
import java.util.Locale

/**
 * Collects a detailed, timestamped diagnostic log for one processing run.
 *
 * Three outputs:
 *  - [tail] — the last few lines, surfaced live on the progress overlay.
 *  - [dump] — the full text, written by `ProcessingService` (always, in its
 *    `finally`) to `<movie folder>/<folder name>.txt`.
 *  - [issues] — the short Hebrew list shown on the success dialog.
 *
 * A process-wide singleton because one run happens at a time and every layer
 * (FFmpeg wrapper, HTTP clients, pipeline, UI) needs to write to it without
 * being handed a logger. [start] clears it at the beginning of each run.
 *
 * Privacy (spec §12): the log stays entirely on the device and is never sent
 * anywhere. Device/build details are recorded only to make local debugging
 * possible; API keys are never logged.
 */
object RunLog {

    private const val MAX_TAIL = 8

    private val lines = Collections.synchronizedList(ArrayList<String>())
    private val _tail = MutableStateFlow<List<String>>(emptyList())
    val tail = _tail.asStateFlow()

    /**
     * Problems worth telling the user about at the end of the run, in Hebrew.
     * The log records everything; this is the short list of what went wrong with
     * the finished file — untranslated lines, a track the container lost, a
     * fallback that lowered quality — so the user knows WHEN the log is worth
     * reading rather than having to read it every time.
     */
    private val issues = Collections.synchronizedList(ArrayList<String>())

    private val clock = SimpleDateFormat("HH:mm:ss.SSS", Locale.US)

    fun start() {
        synchronized(lines) { lines.clear() }
        synchronized(issues) { issues.clear() }
        _tail.value = emptyList()
    }

    /** Record a user-facing problem (also logged). Duplicates are kept once. */
    fun issue(message: String) {
        synchronized(issues) { if (message !in issues) issues.add(message) }
        log("ISSUE: $message")
    }

    fun issues(): List<String> = synchronized(issues) { issues.toList() }

    fun log(message: String) {
        val line = "${clock.format(Date())}  $message"
        synchronized(lines) {
            lines.add(line)
            _tail.value = lines.takeLast(MAX_TAIL)
        }
        Log.i("HebSub", message)
    }

    fun error(message: String, t: Throwable? = null) {
        log("ERROR: $message" + (t?.let { " — ${it::class.java.simpleName}: ${it.message}" }.orEmpty()))
        if (t != null) synchronized(lines) { lines.add(Log.getStackTraceString(t)) }
    }

    /** Record device/build/app metadata at the top of the log. */
    fun header(context: Context) {
        val version = runCatching {
            context.packageManager.getPackageInfo(context.packageName, 0).versionName
        }.getOrNull() ?: "?"
        log("=== HebSub run log ===")
        log("app=$version  device=${Build.MANUFACTURER} ${Build.MODEL}  android=${Build.VERSION.RELEASE} (SDK ${Build.VERSION.SDK_INT})")
        log("abis=${Build.SUPPORTED_ABIS.joinToString(",")}")
    }

    fun dump(): String = synchronized(lines) { lines.joinToString("\n") }
}
