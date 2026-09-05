package com.hebsub.core.report

import java.io.ByteArrayOutputStream
import java.util.zip.ZipEntry
import java.util.zip.ZipInputStream
import java.util.zip.ZipOutputStream

/**
 * A minimal reader and writer for real `.xlsx` workbooks — one sheet, text cells.
 *
 * The app keeps a history of the films it has processed, and the user asked for
 * it as an Excel file, so it is one: an .xlsx is a ZIP of a few XML parts, and
 * writing those five parts by hand is a hundred lines of code against a library
 * (Apache POI) that is tens of megabytes and does not sit well on Android. There
 * are no formulas, no styles and no numbers here — every cell is text, which is
 * what a log of runs actually is.
 *
 * The reader exists because the history is updated, not rewritten from nothing.
 * It reads back what this writer produced **and** what Excel or Google Sheets
 * writes after a person opens the file and saves it — that pass converts the
 * inline strings this writer emits into a shared-string table, so both forms are
 * understood. Anything else in the workbook (styles, extra sheets, formatting a
 * user added) is not preserved: the file is regenerated from its rows on every
 * update, and that is the trade for having no dependency.
 */
object Xlsx {

    /** Build a one-sheet workbook whose first row is normally the header. */
    fun write(sheetName: String, rows: List<List<String>>): ByteArray {
        val out = ByteArrayOutputStream()
        ZipOutputStream(out).use { zip ->
            zip.put("[Content_Types].xml", CONTENT_TYPES)
            zip.put("_rels/.rels", ROOT_RELS)
            zip.put("xl/workbook.xml", workbook(sheetName))
            zip.put("xl/_rels/workbook.xml.rels", WORKBOOK_RELS)
            zip.put("xl/worksheets/sheet1.xml", sheet(rows))
        }
        return out.toByteArray()
    }

    /**
     * The rows of the workbook's first worksheet. Empty when [bytes] is not a
     * workbook this can read — the caller then starts a fresh history rather than
     * failing, which is the right answer for a file that is a convenience.
     */
    fun read(bytes: ByteArray): List<List<String>> = runCatching {
        var sheet: String? = null
        var shared: String? = null
        ZipInputStream(bytes.inputStream()).use { zip ->
            var entry: ZipEntry? = zip.nextEntry
            while (entry != null) {
                val name = entry.name
                when {
                    // The first worksheet part, whatever the producer named it.
                    sheet == null && name.startsWith("xl/worksheets/") && name.endsWith(".xml") ->
                        sheet = zip.readBytes().toString(Charsets.UTF_8)
                    name == "xl/sharedStrings.xml" -> shared = zip.readBytes().toString(Charsets.UTF_8)
                }
                entry = zip.nextEntry
            }
        }
        val doc = sheet ?: return emptyList()
        val strings = shared?.let { sharedStrings(it) } ?: emptyList()
        ROW.findAll(doc).map { m -> cells(m.value, strings) }.toList()
    }.getOrDefault(emptyList())

    // --- reading -------------------------------------------------------------

    private val ROW = Regex("""<row\b[^>]*>(.*?)</row>""", RegexOption.DOT_MATCHES_ALL)
    private val CELL = Regex("""<c\b([^>]*)(?:/>|>(.*?)</c>)""", RegexOption.DOT_MATCHES_ALL)
    private val TEXT = Regex("""<t\b[^>]*>(.*?)</t>""", RegexOption.DOT_MATCHES_ALL)
    private val VALUE = Regex("""<v>(.*?)</v>""", RegexOption.DOT_MATCHES_ALL)
    private val SI = Regex("""<si\b[^>]*>(.*?)</si>""", RegexOption.DOT_MATCHES_ALL)
    private val REF = Regex("""r="([A-Z]+)\d+"""")
    private val TYPE = Regex("""t="([a-zA-Z]+)"""")

    /** The shared-string table Excel writes when it re-saves the file. */
    private fun sharedStrings(xml: String): List<String> =
        SI.findAll(xml).map { si ->
            // A shared string can be split into several runs; join their <t> parts.
            TEXT.findAll(si.groupValues[1]).joinToString("") { unescape(it.groupValues[1]) }
        }.toList()

    /** One row's cells, placed by their column letters so a blank cell cannot shift the rest. */
    private fun cells(row: String, shared: List<String>): List<String> {
        val byColumn = HashMap<Int, String>()
        var widest = -1
        for (m in CELL.findAll(row)) {
            val attrs = m.groupValues[1]
            val body = m.groupValues[2]
            val column = REF.find(attrs)?.groupValues?.get(1)?.let(::columnIndex) ?: (widest + 1)
            val type = TYPE.find(attrs)?.groupValues?.get(1)
            val text = when (type) {
                "inlineStr" -> TEXT.findAll(body).joinToString("") { unescape(it.groupValues[1]) }
                "s" -> VALUE.find(body)?.groupValues?.get(1)?.toIntOrNull()?.let { shared.getOrNull(it) }.orEmpty()
                "str" -> VALUE.find(body)?.groupValues?.get(1)?.let(::unescape).orEmpty()
                else -> VALUE.find(body)?.groupValues?.get(1)?.let(::unescape).orEmpty()
            }
            byColumn[column] = text
            if (column > widest) widest = column
        }
        return (0..widest).map { byColumn[it].orEmpty() }
    }

    /** "A" -> 0, "Z" -> 25, "AA" -> 26. */
    private fun columnIndex(letters: String): Int {
        var n = 0
        for (c in letters) n = n * 26 + (c - 'A' + 1)
        return n - 1
    }

    // --- writing -------------------------------------------------------------

    /** 0 -> "A", 25 -> "Z", 26 -> "AA". */
    internal fun columnName(index: Int): String {
        var n = index + 1
        val sb = StringBuilder()
        while (n > 0) {
            val rem = (n - 1) % 26
            sb.append(('A' + rem))
            n = (n - 1) / 26
        }
        return sb.reverse().toString()
    }

    private fun sheet(rows: List<List<String>>): String = buildString {
        append("""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>""")
        append("""<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>""")
        rows.forEachIndexed { r, row ->
            append("""<row r="${r + 1}">""")
            row.forEachIndexed { c, value ->
                // Every cell is an inline string: no shared-string table to keep in
                // step, and a number-shaped value (a year, a hash) is never
                // reinterpreted as a number and reformatted.
                append("""<c r="${columnName(c)}${r + 1}" t="inlineStr"><is><t xml:space="preserve">""")
                append(escape(value))
                append("""</t></is></c>""")
            }
            append("</row>")
        }
        append("</sheetData></worksheet>")
    }

    private fun workbook(sheetName: String): String =
        """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>""" +
            """<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" """ +
            """xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">""" +
            """<sheets><sheet name="${escape(sheetName.take(31))}" sheetId="1" r:id="rId1"/></sheets></workbook>"""

    private const val CONTENT_TYPES =
        """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>""" +
            """<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">""" +
            """<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>""" +
            """<Default Extension="xml" ContentType="application/xml"/>""" +
            """<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>""" +
            """<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>""" +
            """</Types>"""

    private const val ROOT_RELS =
        """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>""" +
            """<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">""" +
            """<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>""" +
            """</Relationships>"""

    private const val WORKBOOK_RELS =
        """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>""" +
            """<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">""" +
            """<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>""" +
            """</Relationships>"""

    private fun ZipOutputStream.put(name: String, content: String) {
        putNextEntry(ZipEntry(name))
        write(content.toByteArray(Charsets.UTF_8))
        closeEntry()
    }

    private fun escape(s: String): String {
        val sb = StringBuilder(s.length + 16)
        for (c in s) when {
            c == '&' -> sb.append("&amp;")
            c == '<' -> sb.append("&lt;")
            c == '>' -> sb.append("&gt;")
            c == '"' -> sb.append("&quot;")
            // Control characters are illegal in XML 1.0 and would make the file
            // unopenable; tab, newline and carriage return are the exceptions.
            c.code < 0x20 && c != '\t' && c != '\n' && c != '\r' -> sb.append(' ')
            else -> sb.append(c)
        }
        return sb.toString()
    }

    private fun unescape(s: String): String = s
        .replace("&lt;", "<").replace("&gt;", ">")
        .replace("&quot;", "\"").replace("&apos;", "'")
        .replace("&#10;", "\n").replace("&#13;", "\r").replace("&#9;", "\t")
        .replace("&amp;", "&")
}
