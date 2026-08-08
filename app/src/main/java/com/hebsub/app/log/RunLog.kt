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
 * Two outputs:
 *  - [tail] — the last few lines, surfaced live in the UI ("behind the scenes").
 *  - [dump] — the full text, written to Download/HebSub at the end of the run.
 *
 * Privacy (spec §12): the log stays entirely on the device — it is written to
 * the user's own Downloads folder and never sent anywhere. Device/build details
 * are recorded only to make local debugging possible.
 */
object RunLog {

    private const val MAX_TAIL = 8

    private val lines = Collections.synchronizedList(ArrayList<String>())
    private val _tail = MutableStateFlow<List<String>>(emptyList())
    val tail = _tail.asStateFlow()

    private val clock = SimpleDateFormat("HH:mm:ss.SSS", Locale.US)

    fun start() {
        synchronized(lines) { lines.clear() }
        _tail.value = emptyList()
    }

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
