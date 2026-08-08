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
