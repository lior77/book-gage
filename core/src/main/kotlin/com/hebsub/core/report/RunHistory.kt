package com.hebsub.core.report

/**
 * The record of every film the app has processed, kept as one spreadsheet in the
 * HebSub folder.
 *
 * Its job is to answer one question before a run starts: **have I done this file
 * before, and how did it go?** Two hours of transcription and translation are
 * worth a moment's warning that the same file already succeeded last week — or
 * that it failed, and why, so the user can fix the cause instead of watching it
 * fail again. The answer is offered, never enforced: the pre-run screen shows
 * what happened last time and the user decides whether to go on.
 *
 * A film is identified by its [Entry.key] — the OpenSubtitles movie hash, which
 * is derived from the file's own bytes, so the same film recognises itself after
 * being renamed or moved, and two different cuts of one film do not collide. A
 * file too small to hash falls back to its name and size.
 *
 * Pure and I/O-free, so the shape of the sheet and the upsert are unit-tested;
 * the app layer only reads and writes the bytes.
 */
object RunHistory {

    const val SHEET_NAME = "HebSub"

    /** Column headings, in order. Hebrew: the file is for the user to read. */
    val HEADERS = listOf(
        "תאריך",
        "שם הסרט",
        "שנה",
        "IMDb",
        "קובץ הוידאו",
        "גודל (MB)",
        "אורך (דק')",
        "מזהה הקובץ (hash)",
        "מקור הכתוביות",
        "שורות",
        "מסלול",
        "תוצאה",
        "בעיות",
        "הערות",
        "גרסה",
    )

    /** How a run ended, in the words the sheet and the warning use. */
    enum class Status(val label: String) {
        SUCCESS("הצלחה"),
        FAILED("כשלון"),
        CANCELLED("בוטל");

        companion object {
            fun of(label: String): Status = entries.firstOrNull { it.label == label } ?: FAILED
        }
    }

    /** One processed film: one row of the sheet. */
    data class Entry(
        val date: String,
        val title: String,
        val year: String = "",
        val imdb: String = "",
        val fileName: String = "",
        val sizeMb: String = "",
        val durationMin: String = "",
        val hash: String = "",
        val source: String = "",
        val cues: String = "",
        val track: String = "",
        val status: Status = Status.FAILED,
        val issues: String = "",
        val note: String = "",
        val appVersion: String = "",
    ) {
        /**
         * What makes two runs "the same film": the content hash when there is one,
         * otherwise the file's name and size. Never the folder name — the whole
         * point is to recognise a file the user renamed.
         */
        val key: String get() = if (hash.isNotBlank()) hash else "$fileName|$sizeMb"
    }

    fun toRow(e: Entry): List<String> = listOf(
        e.date, e.title, e.year, e.imdb, e.fileName, e.sizeMb, e.durationMin,
        e.hash, e.source, e.cues, e.track, e.status.label, e.issues, e.note, e.appVersion,
    )

    fun fromRow(row: List<String>): Entry? {
        if (row.isEmpty()) return null
        fun at(i: Int) = row.getOrNull(i).orEmpty().trim()
        val date = at(0)
        // The header row and any blank row are not entries.
        if (date.isBlank() || date == HEADERS[0]) return null
        return Entry(
            date = date, title = at(1), year = at(2), imdb = at(3), fileName = at(4),
            sizeMb = at(5), durationMin = at(6), hash = at(7), source = at(8), cues = at(9),
            track = at(10), status = Status.of(at(11)), issues = at(12), note = at(13),
            appVersion = at(14),
        )
    }

    /** Every entry in [rows], newest last, ignoring the header. */
    fun entries(rows: List<List<String>>): List<Entry> = rows.mapNotNull(::fromRow)

    /** The most recent run of the film with this [key], or null if it is new. */
    fun find(rows: List<List<String>>, key: String): Entry? {
        if (key.isBlank()) return null
        return entries(rows).lastOrNull { it.key == key }
    }

    /**
     * [rows] with [entry] written in: replacing the row for the same film when
     * there is one — the sheet holds the LATEST outcome per film, not a log of
     * attempts — and appended otherwise. The header is always the first row.
     */
    fun upsert(rows: List<List<String>>, entry: Entry): List<List<String>> {
        val kept = entries(rows).filterNot { it.key == entry.key }
        return listOf(HEADERS) + kept.map(::toRow) + listOf(toRow(entry))
    }
}
