package com.hebsub.core.report

import com.hebsub.core.lang.Language
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import java.io.ByteArrayOutputStream
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

class XlsxTest {

    @Test
    fun `writes a zip that reads back row for row`() {
        val rows = listOf(
            listOf("תאריך", "שם הסרט", "תוצאה"),
            listOf("2026-09-05 14:39", "História Essencial de Portugal", "הצלחה"),
            listOf("2026-09-04 18:15", "Plan B", "כשלון"),
        )
        val back = Xlsx.read(Xlsx.write("HebSub", rows))
        assertEquals(rows, back)
    }

    @Test
    fun `is a real zip package with the parts a workbook needs`() {
        val bytes = Xlsx.write("HebSub", listOf(listOf("a")))
        val names = ArrayList<String>()
        java.util.zip.ZipInputStream(bytes.inputStream()).use { zip ->
            var e = zip.nextEntry
            while (e != null) { names += e.name; e = zip.nextEntry }
        }
        assertTrue(names.containsAll(listOf(
            "[Content_Types].xml", "_rels/.rels", "xl/workbook.xml",
            "xl/_rels/workbook.xml.rels", "xl/worksheets/sheet1.xml",
        )))
    }

    @Test
    fun `text that would break the XML survives the round trip`() {
        val rows = listOf(listOf("a & b", "<tag>", "\"quoted\"", "line\nbreak", "פסיק, ו'גרש'"))
        assertEquals(rows, Xlsx.read(Xlsx.write("s", rows)))
    }

    @Test
    fun `a control character is replaced rather than making the file unopenable`() {
        val back = Xlsx.read(Xlsx.write("s", listOf(listOf("bad\u0001char"))))
        assertEquals(listOf(listOf("bad char")), back)
    }

    @Test
    fun `an empty cell keeps the columns after it in place`() {
        val rows = listOf(listOf("a", "", "c"))
        assertEquals(rows, Xlsx.read(Xlsx.write("s", rows)))
    }

    @Test
    fun `column names run past Z`() {
        assertEquals("A", Xlsx.columnName(0))
        assertEquals("Z", Xlsx.columnName(25))
        assertEquals("AA", Xlsx.columnName(26))
        assertEquals("AB", Xlsx.columnName(27))
    }

    @Test
    fun `reads the shared strings Excel writes when it re-saves the file`() {
        // What the file looks like after a person opens it in Excel and saves:
        // inline strings become a shared-string table.
        val shared = """<?xml version="1.0"?><sst xmlns="x"><si><t>שם</t></si><si><t>הצלחה</t></si></sst>"""
        val sheet = """<?xml version="1.0"?><worksheet xmlns="x"><sheetData>""" +
            """<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>""" +
            """</sheetData></worksheet>"""
        val out = ByteArrayOutputStream()
        ZipOutputStream(out).use { zip ->
            zip.putNextEntry(ZipEntry("xl/sharedStrings.xml")); zip.write(shared.toByteArray()); zip.closeEntry()
            zip.putNextEntry(ZipEntry("xl/worksheets/sheet1.xml")); zip.write(sheet.toByteArray()); zip.closeEntry()
        }
        assertEquals(listOf(listOf("שם", "הצלחה")), Xlsx.read(out.toByteArray()))
    }

    @Test
    fun `something that is not a workbook reads as no rows instead of throwing`() {
        assertEquals(emptyList<List<String>>(), Xlsx.read(byteArrayOf(1, 2, 3)))
        assertEquals(emptyList<List<String>>(), Xlsx.read(ByteArray(0)))
    }
}

class RunHistoryTest {

    private fun entry(hash: String, status: RunHistory.Status = RunHistory.Status.SUCCESS) =
        RunHistory.Entry(
            date = "2026-09-05 14:39", title = "Plan B", year = "2009", hash = hash,
            fileName = "Plan B-2009.mp4", sizeMb = "1400", status = status,
        )

    @Test
    fun `a new film is appended under the header`() {
        val rows = RunHistory.upsert(emptyList(), entry("abc"))
        assertEquals(RunHistory.HEADERS, rows.first())
        assertEquals(2, rows.size)
        assertEquals("Plan B", RunHistory.fromRow(rows[1])!!.title)
    }

    @Test
    fun `running the same film again replaces its row instead of adding one`() {
        var rows = RunHistory.upsert(emptyList(), entry("abc"))
        rows = RunHistory.upsert(rows, entry("other"))
        rows = RunHistory.upsert(rows, entry("abc", RunHistory.Status.FAILED))
        assertEquals(3, rows.size)   // header + two films
        val found = RunHistory.find(rows, "abc")
        assertEquals(RunHistory.Status.FAILED, found!!.status)
    }

    @Test
    fun `a film is recognised by its content hash, not its name`() {
        val rows = RunHistory.upsert(emptyList(), entry("abc").copy(fileName = "old name.mp4"))
        assertNotNull(RunHistory.find(rows, "abc"))
        assertNull(RunHistory.find(rows, "def"))
        assertNull(RunHistory.find(rows, ""))
    }

    @Test
    fun `a file too small to hash falls back to its name and size`() {
        val e = RunHistory.Entry(date = "d", title = "t", fileName = "clip.mp4", sizeMb = "3")
        assertEquals("clip.mp4|3", e.key)
    }

    @Test
    fun `the header row is never read back as an entry`() {
        assertNull(RunHistory.fromRow(RunHistory.HEADERS))
        assertNull(RunHistory.fromRow(emptyList()))
        assertNull(RunHistory.fromRow(listOf("", "", "")))
    }

    @Test
    fun `a row survives a trip through the spreadsheet`() {
        val rows = RunHistory.upsert(emptyList(), entry("abc"))
        val back = Xlsx.read(Xlsx.write(RunHistory.SHEET_NAME, rows))
        val found = RunHistory.find(back, "abc")!!
        assertEquals("Plan B", found.title)
        assertEquals("2009", found.year)
        assertEquals(RunHistory.Status.SUCCESS, found.status)
    }
}

class LanguageFromFileNameTest {

    @Test
    fun `reads the tag subtitle sites put before the extension`() {
        assertEquals("pt", Language.fromFileName("Hermano Saraiva.pt-PT.srt"))
        assertEquals("en", Language.fromFileName("Some.Film.2019.1080p.en.srt"))
        assertEquals("he", Language.fromFileName("Some.Film.he.ass"))
        assertEquals("he", Language.fromFileName("Some Film-heb.srt"))
        assertEquals("pt", Language.fromFileName("Film.pt-BR.srt"))
        assertEquals("es", Language.fromFileName("Film_es.srt"))
        assertEquals("he", Language.fromFileName("/data/cache/picked_Film.hebrew.srt"))
    }

    @Test
    fun `looks past a marker that is not a language`() {
        assertEquals("en", Language.fromFileName("Film.en.forced.srt"))
        assertEquals("es", Language.fromFileName("Film.es.sdh.srt"))
    }

    @Test
    fun `a name that only looks like a tag is not believed`() {
        assertNull(Language.fromFileName("Film.2002.srt"))
        assertNull(Language.fromFileName("Film.1080p.srt"))
        assertNull(Language.fromFileName("Untitled.srt"))
        assertNull(Language.fromFileName("Alberto Andrade - Historia Essencial.srt"))
        assertNull(Language.fromFileName(null))
        assertNull(Language.fromFileName(""))
    }

    @Test
    fun `the real file from the Portugal run gives Portuguese, not English`() {
        val name = "picked_Alberto Andrade - História Essencial De Portugal VOL 3 " +
            "Hermano Saraiva.pt-PT.srt"
        assertEquals("pt", Language.fromFileName(name))
        // …whereas the text itself can only say "Latin script", which is exactly
        // the confusion this replaces.
        assertEquals("en", Language.detectScript("Dom Duarte é uma das figuras mais interessantes"))
    }

    @Test
    fun `display names are what the translator prompt should say`() {
        assertEquals("Portuguese", Language.displayName("pt-PT"))
        assertEquals("Spanish", Language.displayName("spa"))
        assertEquals("Hebrew", Language.displayName("iw"))
        assertNull(Language.displayName(null))
        assertNull(Language.displayName("und"))
    }
}
