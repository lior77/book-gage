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

class SpeechSegmenterTest {
    private fun w(startMs: Long, text: String, durMs: Long = 400) =
        com.hebsub.core.speech.SpeechWord(startMs, startMs + durMs, text)

    @Test fun slowSpeechIsNotChoppedIntoSingleWords() {
        // "No… me… creas. Da… igual." — one word a second. This used to be five cues.
        val words = listOf(w(0, "No"), w(1000, "me"), w(2000, "creas."), w(3000, "Da"), w(4000, "igual."))
        val out = com.hebsub.core.speech.SpeechSegmenter.segment(words)
        assertEquals(1, out.size, out.map { it.text }.toString())
        assertEquals("No me creas. Da igual.", out[0].text)
        assertEquals(0L, out[0].startMs)
        assertEquals(4400L, out[0].endMs)
    }

    @Test fun aLongSilenceStillEndsTheCue() {
        val words = listOf(w(0, "Sí."), w(2500, "Bueno, entonces vamos a la casa de mi madre ahora mismo."))
        val out = com.hebsub.core.speech.SpeechSegmenter.segment(words)
        assertEquals(2, out.size, "text must not hang over a 2.5 s silence")
        assertEquals("Sí.", out[0].text)
    }

    @Test fun aSentenceEndsACueOnceThereIsEnoughText() {
        val words = listOf(
            w(0, "Nunca"), w(300, "seguiste"), w(600, "una"), w(900, "compañera"), w(1200, "de"), w(1500, "la"), w(1800, "facultad?"),
            w(2300, "Sí,"), w(2600, "obvio."),
        )
        val out = com.hebsub.core.speech.SpeechSegmenter.segment(words)
        assertEquals(2, out.size, out.map { it.text }.toString())
        assertTrue(out[0].text.endsWith("facultad?"))
    }

    @Test fun neverExceedsTwoLinesOfText() {
        val words = (0 until 60).map { w(it * 300L, "palabra$it") }
        val out = com.hebsub.core.speech.SpeechSegmenter.segment(words)
        assertTrue(out.size > 1)
        assertTrue(out.all { it.text.length <= com.hebsub.core.speech.SpeechSegmenter.MAX_CHARS })
    }
}

class SpeechChunksTest {
    @Test fun plansOverlappingPiecesCoveringTheWholeFilm() {
        val plan = com.hebsub.core.speech.SpeechChunks.plan(1_250_000, chunkMs = 600_000, overlapMs = 5_000)
        assertEquals(3, plan.size)
        assertEquals(0L, plan[0].fromMs); assertEquals(605_000L, plan[0].toMs)
        assertEquals(595_000L, plan[1].fromMs); assertEquals(1_205_000L, plan[1].toMs)
        assertEquals(1_195_000L, plan[2].fromMs); assertEquals(1_250_000L, plan[2].toMs)
        // Keep windows tile the film with no hole and no double coverage.
        assertEquals(0L, plan[0].keepFromMs); assertEquals(597_500L, plan[0].keepToMs)
        assertEquals(597_500L, plan[1].keepFromMs); assertEquals(1_197_500L, plan[1].keepToMs)
        assertEquals(1_197_500L, plan[2].keepFromMs); assertEquals(Long.MAX_VALUE, plan[2].keepToMs)
    }

    @Test fun placesWordsOnTheFilmClockAndDropsOverlapDuplicates() {
        val plan = com.hebsub.core.speech.SpeechChunks.plan(1_250_000)
        // Second chunk starts at 595 s; a word 3 s into it is at 598 s absolute — inside its keep window.
        val a = com.hebsub.core.speech.SpeechChunks.place(plan[0], listOf(com.hebsub.core.speech.SpeechWord(597_900, 598_300, "hola")))
        val b = com.hebsub.core.speech.SpeechChunks.place(plan[1], listOf(com.hebsub.core.speech.SpeechWord(3_050, 3_450, "hola")))
        assertEquals(0, a.size, "598 s is past chunk 0's keep window")
        assertEquals(1, b.size); assertEquals(598_050L, b[0].startMs)
        val merged = com.hebsub.core.speech.SpeechChunks.merge(listOf(a, b, listOf(com.hebsub.core.speech.SpeechWord(598_100, 598_400, "Hola"))))
        assertEquals(1, merged.size, "the same word at the same moment is one word")
    }

    @Test fun findsTheGapsIncludingHeadAndTail() {
        val words = listOf(com.hebsub.core.speech.SpeechWord(60_000, 61_000, "a"), com.hebsub.core.speech.SpeechWord(200_000, 201_000, "b"))
        val gaps = com.hebsub.core.speech.SpeechChunks.gaps(words, 300_000, minGapMs = 45_000)
        assertEquals(listOf(0L until 60_000L, 61_000L until 200_000L, 201_000L until 300_000L), gaps)
    }
}

class OverlapTest {
    @Test fun pullsAnEndBackBeforeTheNextStart() {
        // Cue 89 in the Plan B run ended 240 ms after cue 90 had begun.
        val cues = listOf(
            SubtitleCue(1, 815_665, 821_430, listOf("א")),
            SubtitleCue(2, 821_190, 823_989, listOf("ב")),
        )
        val out = SubtitleTiming.removeOverlaps(cues)
        assertEquals(821_190L - SubtitleTiming.GUARD_MS, out[0].endMs)
        assertEquals(815_665L, out[0].startMs, "starts are never moved")
        assertEquals(cues[1], out[1])
    }

    @Test fun leavesSeparatedCuesAlone() {
        val cues = listOf(SubtitleCue(1, 0, 1000, listOf("א")), SubtitleCue(2, 2000, 3000, listOf("ב")))
        assertEquals(cues, SubtitleTiming.removeOverlaps(cues))
    }
}
