package com.hebsub.core.subtitle

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class TimeCodeTest {
    @Test fun parsesSrtTimestamp() {
        assertEquals(3_723_456L, TimeCode.parseOrNull("01:02:03,456"))
    }

    @Test fun parsesVttDotSeparator() {
        assertEquals(3_723_456L, TimeCode.parseOrNull("01:02:03.456"))
    }

    @Test fun parsesWithoutHours() {
        assertEquals(62_500L, TimeCode.parseOrNull("01:02.500"))
    }

    @Test fun normalisesShortFraction() {
        assertEquals(500L, TimeCode.parseOrNull("00:00:00,5"))
    }

    @Test fun rejectsGarbage() {
        assertEquals(null, TimeCode.parseOrNull("not a time"))
        assertEquals(null, TimeCode.parseOrNull("00:70:00,000"))
    }

    @Test fun formatsCanonicalSrt() {
        assertEquals("01:02:03,456", TimeCode.formatSrt(3_723_456L))
        assertEquals("00:00:00,000", TimeCode.formatSrt(-5L))
    }
}

class SrtParserTest {
    private val sample = """
        1
        00:00:01,000 --> 00:00:03,000
        Hello world

        2
        00:00:04,000 --> 00:00:06,000
        <i>Second</i> line
        second row
    """.trimIndent()

    @Test fun parsesTwoCues() {
        val cues = SrtParser.parse(sample)
        assertEquals(2, cues.size)
        assertEquals(1000L, cues[0].startMs)
        assertEquals(3000L, cues[0].endMs)
        assertEquals("Hello world", cues[0].text)
    }

    @Test fun stripsFormattingTags() {
        val cues = SrtParser.parse(sample)
        assertEquals("Second line\nsecond row", cues[1].text)
    }

    @Test fun stripsAssOverrideBlocks() {
        val srt = "1\n00:00:01,000 --> 00:00:02,000\n{\\an8}Hola {\\i1}amigo{\\i0}\n"
        val cues = SrtParser.parse(srt)
        assertEquals(1, cues.size)
        assertEquals("Hola amigo", cues[0].text)
    }

    @Test fun handlesBomAndCrlf() {
        val srt = "﻿1\r\n00:00:01,000 --> 00:00:02,000\r\nHi\r\n\r\n"
        val cues = SrtParser.parse(srt)
        assertEquals(1, cues.size)
        assertEquals("Hi", cues[0].text)
    }

    @Test fun parsesVttWithHeader() {
        val vtt = """
            WEBVTT

            00:00:01.000 --> 00:00:02.000
            Subtitle
        """.trimIndent()
        val cues = SrtParser.parse(vtt)
        assertEquals(1, cues.size)
        assertEquals("Subtitle", cues[0].text)
    }

    @Test fun emptyInputYieldsNoCues() {
        assertTrue(SrtParser.parse("").isEmpty())
        assertTrue(SrtParser.parse("   \n  ").isEmpty())
    }

    @Test fun roundTripThroughWriter() {
        val cues = SrtParser.parse(sample)
        val written = SrtWriter.write(cues)
        val reparsed = SrtParser.parse(written)
        assertEquals(cues.map { it.text }, reparsed.map { it.text })
        assertEquals(cues.map { it.startMs }, reparsed.map { it.startMs })
        assertEquals(cues.map { it.endMs }, reparsed.map { it.endMs })
    }

    @Test fun writerRenumbersFromOne() {
        val cues = listOf(
            SubtitleCue(99, 0, 1000, listOf("a")),
            SubtitleCue(5, 2000, 3000, listOf("b")),
        )
        val out = SrtWriter.write(cues)
        assertTrue(out.startsWith("1\n"))
        assertTrue(out.contains("\n2\n"))
    }
}

class ReadingSpeedTest {
    private fun cue(i: Int, start: Long, end: Long, text: String) =
        SubtitleCue(i, start, end, listOf(text))

    @Test fun extendsALineIntoTheSilenceThatFollowsIt() {
        // 32 non-space characters at 17 cps needs ~1880 ms; the cue has 900 and the
        // next line is far away, so it may have the time.
        val text = "אבגדהוזחטיכלמנסעפצקרשתאבגדהוזחטי"
        val out = SubtitleTiming.ensureReadingSpeed(
            listOf(cue(1, 0, 900, text), cue(2, 60_000, 61_000, "ב")),
        )
        assertTrue(out[0].durationMs >= 1800, "got ${out[0].durationMs}ms for ${text.length} chars")
        assertEquals(0L, out[0].startMs, "a start time is never moved")
    }

    @Test fun neverEncroachesOnTheNextCue() {
        val out = SubtitleTiming.ensureReadingSpeed(
            listOf(cue(1, 0, 900, "א".repeat(80)), cue(2, 1_500, 3_000, "ב")),
        )
        assertTrue(out[0].endMs <= 1_500 - SubtitleTiming.GUARD_MS, "ends at ${out[0].endMs}")
    }

    @Test fun countsTheCuesTheDialogueLeavesNoRoomFor() {
        val cues = listOf(cue(1, 0, 900, "א".repeat(80)), cue(2, 1_500, 3_000, "ב"))
        val out = SubtitleTiming.ensureReadingSpeed(cues)
        assertEquals(1, SubtitleTiming.tooFast(out))
    }
}
