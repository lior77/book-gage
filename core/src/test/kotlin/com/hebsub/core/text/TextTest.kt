package com.hebsub.core.text

import com.hebsub.core.subtitle.SubtitleCue
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class LineWrapperTest {
    @Test fun shortTextStaysOneLine() {
        assertEquals(listOf("Hello there"), LineWrapper.wrap("Hello there", 42))
    }

    @Test fun longTextSplitsIntoTwoBalancedLines() {
        val text = "This is a fairly long subtitle line that should be split into two"
        val lines = LineWrapper.wrap(text, 40)
        assertEquals(2, lines.size)
        assertTrue(lines[0].length <= 40)
        // No word is broken and nothing is lost.
        assertEquals(text, lines.joinToString(" "))
    }

    @Test fun collapsesWhitespace() {
        assertEquals(listOf("a b c"), LineWrapper.wrap("a   b\nc", 42))
    }

    @Test fun singleLongWordNotBroken() {
        val w = "supercalifragilisticexpialidocious_and_then_some_more"
        assertEquals(listOf(w), LineWrapper.wrap(w, 20))
    }
}

class RtlFormatterTest {
    @Test fun wrapsHebrewLineWithRtlMarks() {
        val out = RtlFormatter.applyToLine("שלום עולם")
        assertTrue(out.startsWith("‫"))
        assertTrue(out.endsWith("‬"))
    }

    @Test fun leavesNonHebrewUntouched() {
        assertEquals("Hello", RtlFormatter.applyToLine("Hello"))
    }

    @Test fun doesNotDoubleWrap() {
        val once = RtlFormatter.applyToLine("שלום")
        val twice = RtlFormatter.applyToLine(once)
        assertEquals(once, twice)
    }

    @Test fun appliesToAllCueLines() {
        val cue = SubtitleCue(1, 0, 1000, listOf("שלום", "Hello"))
        val out = RtlFormatter.applyToCue(cue)
        assertTrue(out.lines[0].startsWith("‫"))
        assertEquals("Hello", out.lines[1])
    }
}

class SubtitlePostProcessorTest {
    @Test fun wrapsEnforcesMinDurationAndRenumbers() {
        val cues = listOf(
            SubtitleCue(10, 0, 200, listOf("שלום זו כתובית ארוכה מאוד שצריכה להתפצל לשתי שורות בבקשה")),
            SubtitleCue(11, 5000, 7000, listOf("עוד שורה")),
        )
        val out = SubtitlePostProcessor.process(cues, maxCharsPerLine = 30)
        assertEquals(1, out[0].index)
        assertEquals(2, out[1].index)
        // Min duration enforced on the first cue (was 200ms).
        assertTrue(out[0].durationMs >= SubtitlePostProcessor.MIN_DURATION_MS)
        // RTL applied.
        assertTrue(out[0].lines.first().startsWith("‫"))
    }

    @Test fun dropsBlankCues() {
        val cues = listOf(SubtitleCue(1, 0, 1000, listOf("")))
        assertTrue(SubtitlePostProcessor.process(cues).isEmpty())
    }
}

class CueSplitterTest {

    private fun cue(start: Long, end: Long, text: String) =
        SubtitleCue(1, start, end, listOf(text))

    @Test fun shortCueIsUntouched() {
        val one = cue(0, 2_000, "שורה קצרה")
        assertEquals(listOf(one), CueSplitter.split(listOf(one), 42, 2))
    }

    @Test fun paragraphBecomesSeveralCues() {
        // Four sentences, ~250 characters: far past the two-line budget.
        val text = "ארתורו. מה? חברים, חברים, התמונות של הקבוצה שלנו הן בשביל הקבוצה שלנו. " +
            "כשאתם שולחים בצחוק לאח שלכם, זה בסוף דולף. בבסיס, התמונה נכנסת לקבוצה " +
            "ויוצאת בלי שאף אחד יודע מי הוציא אותה. וזה כבר לא היה טוב."
        val out = CueSplitter.split(listOf(cue(10_000, 30_000, text)), 42, 2)
        assertTrue(out.size >= 3, "expected the paragraph to be split, got ${out.size}")
        // Every part fits two lines.
        assertTrue(out.all { it.text.length <= 84 }, out.map { it.text.length }.toString())
        // Nothing is lost and nothing is duplicated.
        assertEquals(text.replace(Regex("\\s+"), " "), out.joinToString(" ") { it.text })
    }

    @Test fun splitKeepsTheParentSpanAndStaysInOrder() {
        val text = "א".repeat(60) + ". " + "ב".repeat(60) + ". " + "ג".repeat(60) + "."
        val out = CueSplitter.split(listOf(cue(5_000, 20_000, text)), 42, 2)
        assertTrue(out.size >= 3)
        assertEquals(5_000, out.first().startMs)
        assertEquals(20_000, out.last().endMs)
        // Strictly increasing, never overlapping.
        out.zipWithNext().forEach { (a, b) ->
            assertTrue(a.endMs < b.startMs, "cue ${a.index} ends ${a.endMs} but ${b.index} starts ${b.startMs}")
        }
        assertEquals(listOf(1, 2, 3), out.map { it.index }.take(3))
    }

    @Test fun oneUnbreakableWordIsKeptWhole() {
        val word = "א".repeat(200)
        val out = CueSplitter.split(listOf(cue(0, 3_000, word)), 42, 2)
        assertEquals(1, out.size)
        assertEquals(word, out.first().text)
    }
}

class PostProcessorSplitTest {
    @Test fun processNeverEmitsMoreThanTwoLines() {
        val long = List(6) { "משפט מספר $it שממשיך ומתארך עוד ועוד ועוד." }.joinToString(" ")
        val out = SubtitlePostProcessor.process(
            listOf(SubtitleCue(1, 0, 12_000, listOf(long))),
            maxCharsPerLine = 42,
            applyRtl = false,
        )
        assertTrue(out.size > 1)
        assertTrue(out.all { it.lines.size <= 2 }, out.map { it.lines.size }.toString())
    }
}
