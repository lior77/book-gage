package com.hebsub.app.history

import android.content.Context
import com.hebsub.app.log.RunLog
import com.hebsub.app.storage.HebSubStorage
import com.hebsub.core.report.RunHistory
import com.hebsub.core.report.Xlsx
import java.io.File

/**
 * Reads and writes `HebSub/HebSub-history.xlsx` — the spreadsheet of every film
 * the app has processed.
 *
 * It is consulted once, before a run starts, to say "you have done this file
 * before, and here is how it went", and written once, when the run ends, whether
 * it ended well or badly. Both are best-effort: a history that cannot be read is
 * treated as empty and a history that cannot be written is a logged line, never
 * a failed run. A convenience must not be able to stop the work.
 *
 * The shape of the sheet and the matching live in the tested `:core` module
 * ([RunHistory]); this class only owns the file.
 */
class RunHistoryStore(context: Context) {

    private val storage = HebSubStorage(context)

    private fun file(): File = File(storage.rootDir(), FILE_NAME)

    /** What happened the last time this exact file was processed, or null. */
    fun find(key: String): RunHistory.Entry? {
        if (key.isBlank()) return null
        return runCatching {
            val f = file()
            if (!f.exists() || f.length() == 0L) return null
            RunHistory.find(Xlsx.read(f.readBytes()), key)
        }.getOrElse { RunLog.error("history: could not read ${FILE_NAME}", it); null }
    }

    /** Add [entry], replacing any earlier row for the same film. */
    fun record(entry: RunHistory.Entry) {
        runCatching {
            storage.ensureRoot()
            val f = file()
            val existing = if (f.exists() && f.length() > 0) Xlsx.read(f.readBytes()) else emptyList()
            val rows = RunHistory.upsert(existing, entry)
            // Written whole every time: the sheet is small (one row per film) and
            // rewriting it is what keeps the reader and the writer honest about
            // the same format.
            f.writeBytes(Xlsx.write(RunHistory.SHEET_NAME, rows))
            RunLog.log("history: recorded '${entry.title}' as ${entry.status.label} in $FILE_NAME (${rows.size - 1} films)")
        }.onFailure { RunLog.error("history: could not write $FILE_NAME", it) }
    }

    companion object {
        const val FILE_NAME = "HebSub-history.xlsx"
    }
}
