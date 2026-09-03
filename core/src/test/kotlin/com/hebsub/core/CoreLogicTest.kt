package com.hebsub.core

import com.hebsub.core.lang.Language
import com.hebsub.core.net.UrlValidator
import com.hebsub.core.pipeline.AcquisitionStep
import com.hebsub.core.pipeline.EmbeddedSubtitle
import com.hebsub.core.pipeline.SubtitleSourcePlanner
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.assertIs

class LanguageTest {
    @Test fun canonicalisesAliases() {
        assertEquals("he", Language.canonical("iw"))
        assertEquals("he", Language.canonical("HEB"))
        assertEquals("en", Language.canonical("en-US"))
        assertEquals("pt", Language.canonical("pt-BR"))
        assertEquals(null, Language.canonical("und"))
        assertEquals(null, Language.canonical(null))
    }

    @Test fun detectsHebrewAndEnglish() {
        assertEquals("he", Language.detectScript("שלום עולם מה שלומך היום"))
        assertEquals("en", Language.detectScript("The quick brown fox jumps"))
        assertTrue(Language.isHebrew("iw"))
        assertTrue(Language.isEnglish("eng"))
    }
}

class UrlValidatorTest {
    @Test fun acceptsHttpsUrl() {
        val r = UrlValidator.validate("https://example.com/path/movie.mp4?x=1")
        assertIs<UrlValidator.Result.Valid>(r)
        assertEquals("movie.mp4", r.suggestedFileName)
    }

    @Test fun rejectsBlank() {
        assertEquals(
            UrlValidator.Reason.BLANK,
            (UrlValidator.validate("  ") as UrlValidator.Result.Invalid).reason,
        )
    }

    @Test fun rejectsNonHttpScheme() {
        assertEquals(
            UrlValidator.Reason.UNSUPPORTED_SCHEME,
            (UrlValidator.validate("ftp://example.com/x") as UrlValidator.Result.Invalid).reason,
        )
    }

    @Test fun rejectsPrivateAndLocalHosts() {
        val hosts = listOf(
            "http://localhost/x",
            "http://127.0.0.1/x",
            "http://10.1.2.3/x",
            "http://192.168.0.1/x",
            "http://172.16.5.5/x",
            "http://169.254.1.1/x",
            "http://[::1]/x",
            "http://printer.local/x",
        )
        hosts.forEach {
            val r = UrlValidator.validate(it)
            assertIs<UrlValidator.Result.Invalid>(r, "expected invalid for $it")
            assertEquals(UrlValidator.Reason.PRIVATE_OR_LOCAL_HOST, r.reason, "for $it")
        }
    }

    @Test fun allowsPublicIp() {
        assertIs<UrlValidator.Result.Valid>(UrlValidator.validate("https://8.8.8.8/video.mkv"))
    }
}

class SubtitleSourcePlannerTest {
    @Test fun embeddedHebrewComesFirst() {
        val plan = SubtitleSourcePlanner.plan(
            embedded = listOf(
                EmbeddedSubtitle(0, "en"),
                EmbeddedSubtitle(1, "he"),
            ),
            audioLanguage = "en",
            onlineEnabled = true,
        )
        assertIs<AcquisitionStep.EmbeddedHebrew>(plan.first())
    }

    @Test fun fullPrecedenceWhenNoHebrew() {
        val plan = SubtitleSourcePlanner.plan(
            embedded = listOf(
                EmbeddedSubtitle(0, "fr"),   // other
                EmbeddedSubtitle(1, "en"),   // source (audio=en)
            ),
            audioLanguage = "en",
            onlineEnabled = true,
        )
        // Spec order: OnlineHebrew → OnlineSource → EmbeddedSource(en=source) → EmbeddedSource(fr) → Transcribe
        assertIs<AcquisitionStep.OnlineHebrew>(plan[0])
        assertIs<AcquisitionStep.OnlineSource>(plan[1])
        val embSrc = plan[2] as AcquisitionStep.EmbeddedSource
        assertEquals("en", Language.canonical(embSrc.language)) // source-language track prioritised
        assertIs<AcquisitionStep.EmbeddedSource>(plan[3])
        assertIs<AcquisitionStep.Transcribe>(plan[4])
    }

    @Test fun preferEmbeddedSourcePutsEmbeddedBeforeOnline() {
        // Updated spec §ב.3: embedded English/source subs are used before any
        // online search — so EmbeddedSource must precede the Online* steps.
        val plan = SubtitleSourcePlanner.plan(
            embedded = listOf(EmbeddedSubtitle(1, "en")),
            audioLanguage = "en",
            onlineEnabled = true,
            preferEmbeddedSource = true,
        )
        assertIs<AcquisitionStep.EmbeddedSource>(plan[0])
        assertIs<AcquisitionStep.OnlineHebrew>(plan[1])
        assertIs<AcquisitionStep.OnlineSource>(plan[2])
        assertIs<AcquisitionStep.Transcribe>(plan.last())
    }

    @Test fun cleanQueryStripsReleaseTagsAndSeparators() {
        val cleaned = com.hebsub.core.provider.opensubtitles.OpenSubtitlesQuery
            .cleanQuery("BBC.Zambezi.1965.1of3.Lord.of.the.Land.WebRip.MVGroup")
        // Dots become spaces and release tokens (1of3, WebRip, MVGroup) are removed.
        assertTrue(cleaned.contains("Zambezi"))
        assertTrue(cleaned.contains("Lord of the Land"))
        assertTrue(!cleaned.contains("WebRip", ignoreCase = true))
        assertTrue(!cleaned.contains("MVGroup", ignoreCase = true))
        assertTrue(!cleaned.contains("1of3", ignoreCase = true))
    }

    @Test fun buildSearchParamsCleansTitleAndAddsYear() {
        val p = com.hebsub.core.provider.opensubtitles.OpenSubtitlesQuery
            .buildSearchParams(listOf("he"), movieHash = null, title = "The.Matrix.1999.1080p.BluRay", year = "1999")
        assertEquals("he", p["languages"])
        assertEquals("1999", p["year"])
        assertTrue(p["query"]!!.contains("Matrix"))
        assertTrue(!p["query"]!!.contains("1080p"))
    }

    @Test fun parseToleratesNullBooleanFields() {
        // OpenSubtitles can return an explicit null for from_trusted/hearing_impaired;
        // parsing must not throw (regression: JsonDecodingException crashed a run).
        val raw = """
            {"total_count":1,"data":[{"id":"1","attributes":{
              "language":"en","download_count":7,
              "from_trusted":null,"hearing_impaired":null,"machine_translated":null,
              "foreign_parts_only":false,
              "files":[{"file_id":123,"file_name":"movie.en.srt"}]
            }}]}
        """.trimIndent()
        val resp = com.hebsub.core.provider.opensubtitles.OpenSubtitlesQuery.parse(raw)
        val ranked = com.hebsub.core.provider.opensubtitles.OpenSubtitlesQuery.rankCandidates(resp, listOf("en"))
        assertEquals(1, ranked.size)
        assertEquals(123L, ranked[0].fileId)
        assertEquals(false, ranked[0].fromTrusted) // null coerced to the default
    }

    @Test fun assWriterEmitsCoverBoxStyleAndDialogue() {
        val cues = listOf(
            com.hebsub.core.subtitle.SubtitleCue(1, 2480, 3699, listOf("שלום", "עולם")),
        )
        // 38% transparency → alpha 0x60 (38*255/100 = 96).
        val ass = com.hebsub.core.subtitle.AssWriter.write(cues, bgTransparencyPercent = 38)
        assertTrue(ass.contains("Style: Default,"))
        assertTrue(Regex(""",3,\d+,0,2,""").containsMatchIn(ass)) // BorderStyle=3
        // The plate colour must sit in the OutlineColour slot (libass fills the
        // opaque box from OutlineColour, not BackColour) — regression: the plate
        // was in BackColour only, so the box rendered opaque black.
        assertTrue(ass.contains("&H000000FF,&H601A1A1A,")) // secondary, then plate as OutlineColour
        assertTrue(ass.contains("Dialogue: 0,0:00:02.48,0:00:03.69,Default"))
        assertTrue(ass.contains("שלום\\Nעולם"))                    // lines joined with \N
    }

    @Test fun assWriterNamesRequestedFont() {
        // The embedded-font family must appear in the style so libass uses it
        // (fixes Hebrew rendering as boxes when Arial has no Hebrew glyphs).
        val ass = com.hebsub.core.subtitle.AssWriter.write(
            listOf(com.hebsub.core.subtitle.SubtitleCue(1, 0, 1000, listOf("שלום"))),
            bgTransparencyPercent = 50,
            fontName = "Alef",
        )
        assertTrue(ass.contains("Style: Default,Alef,"))
    }

    @Test fun assWriterPlainWhenFullyTransparent() {
        val ass = com.hebsub.core.subtitle.AssWriter.write(
            listOf(com.hebsub.core.subtitle.SubtitleCue(1, 0, 1000, listOf("א"))),
            bgTransparencyPercent = 100,
        )
        assertTrue(Regex(""",1,\d+,0,2,""").containsMatchIn(ass)) // BorderStyle=1 (no box)
    }

    @Test fun omdbImdbIdExtraction() {
        val o = com.hebsub.core.provider.omdb.Omdb
        assertEquals("tt1375666", o.imdbId("https://www.imdb.com/title/tt1375666/"))
        assertEquals("tt1375666", o.imdbId("tt1375666"))
        assertEquals(null, o.imdbId("https://example.com/no-id"))
    }

    @Test fun omdbParsesRecordAndRuntime() {
        val raw = """{"Title":"Inception","Year":"2010","Runtime":"148 min","Genre":"Action",
            "Director":"Christopher Nolan","Actors":"Leonardo DiCaprio","Plot":"A thief...",
            "Poster":"https://x/y.jpg","imdbRating":"8.8","imdbID":"tt1375666","Response":"True"}"""
        val m = com.hebsub.core.provider.omdb.Omdb.parse(raw)
        assertTrue(m.ok)
        assertEquals("Inception", m.title)
        assertEquals(148, m.runtimeMinutes)
        assertTrue(m.hasPoster)
    }

    @Test fun buildSearchParamsUsesImdbIdWhenPresent() {
        val p = com.hebsub.core.provider.opensubtitles.OpenSubtitlesQuery
            .buildSearchParams(listOf("he"), movieHash = null, title = "The Matrix", year = "1999", imdbId = "tt0133093")
        assertEquals("133093", p["imdb_id"]) // "tt" and leading zeros stripped
        assertEquals(null, p["query"])        // imdb id replaces the title/year query
        assertEquals(null, p["year"])
    }

    @Test fun alignerRecoversOffsetAndScale() {
        // Build an hour of random speech segments (audio time), then derive subtitles
        // that are offset by 12 s and time-scaled by 25/23.976 — a typical wrong-release
        // situation. The aligner must recover both and re-time the cues onto the speech.
        val rnd = java.util.Random(7)
        val speech = ArrayList<com.hebsub.core.subtitle.SubtitleAligner.Speech>()
        var t = 5_000L
        while (t < 60 * 60_000L) {
            val len = 1000L + rnd.nextInt(3000)
            speech.add(com.hebsub.core.subtitle.SubtitleAligner.Speech(t, t + len))
            t += len + 1000L + rnd.nextInt(6000)
        }
        val scale = 25.0 / 23.976
        val offset = 12_000L
        // audio = sub * scale + offset  →  sub = (audio − offset) / scale
        val subs = speech.mapIndexed { i, s ->
            com.hebsub.core.subtitle.SubtitleCue(i + 1, ((s.startMs - offset) / scale).toLong(), ((s.endMs - offset) / scale).toLong(), listOf("x"))
        }
        val r = com.hebsub.core.subtitle.SubtitleAligner.align(subs, speech)
        assertTrue(r.shouldApply, "expected an improvement, got $r")
        assertTrue(kotlin.math.abs(r.offsetMs - offset) <= 200, "offset=${r.offsetMs}")
        assertEquals(scale, r.scale, 1e-9)
        val fixed = com.hebsub.core.subtitle.SubtitleAligner.apply(subs, r)
        assertTrue(kotlin.math.abs(fixed[0].startMs - speech[0].startMs) <= 200)
        assertTrue(kotlin.math.abs(fixed.last().endMs - speech.last().endMs) <= 300)
    }

    @Test fun alignerLeavesSyncedSubtitlesAlone() {
        val speech = (0 until 300).map { com.hebsub.core.subtitle.SubtitleAligner.Speech(it * 6000L + 1000, it * 6000L + 3500) }
        val subs = speech.mapIndexed { i, s -> com.hebsub.core.subtitle.SubtitleCue(i + 1, s.startMs, s.endMs, listOf("x")) }
        val r = com.hebsub.core.subtitle.SubtitleAligner.align(subs, speech)
        assertTrue(!r.shouldApply, "already-synced subtitles must not be re-timed: $r")
    }

    @Test fun claudeParserAcceptsArrayFormAndRawNewlines() {
        val p = com.hebsub.core.provider.claude.ClaudeTranslator
        val arr = """[{"id":1,"text":"שלום"},{"id":2,"hebrew":"עולם"}]"""
        val m1 = p.parseTranslations(arr)
        assertEquals("שלום", m1[1]); assertEquals("עולם", m1[2])
        // A raw newline inside a string value is invalid JSON; it must still parse.
        val raw = "{\"3\": \"שורה\nשנייה\"}"
        assertEquals("שורה\nשנייה", p.parseTranslations(raw)[3])
    }

    @Test fun claudeMissingIdsAndSubsetRequest() {
        val p = com.hebsub.core.provider.claude.ClaudeTranslator
        val cues = (1..5).map { com.hebsub.core.subtitle.SubtitleCue(it, it * 1000L, it * 1000L + 500, listOf("l$it")) }
        val batch = p.buildBatches(cues).first()
        val missing = p.missingIds(batch, mapOf(1 to "א", 2 to "", 3 to "ג"))
        assertEquals(setOf(2, 4, 5), missing)
        val user = p.buildUserContent(batch, onlyIds = missing)
        assertTrue(user.contains("\"id\":2") && user.contains("\"id\":4") && !user.contains("\"id\":1"))
        assertTrue(p.systemPrompt("en", "Title: X\nSynopsis: Y").contains("Synopsis: Y"))
    }

    @Test fun matchRejectsWrongLengthAndFps() {
        val m = com.hebsub.core.subtitle.SubtitleMatch
        val video = 87 * 60_000L
        assertTrue(m.durationFits(85 * 60_000L, video))          // ends before the credits — fine
        assertTrue(!m.durationFits(95 * 60_000L, video))         // runs past the video — longer cut
        assertTrue(!m.durationFits(30 * 60_000L, video))         // covers a third — partial/wrong
        assertTrue(m.durationFits(1000L, 0L))                    // unknown duration → no opinion
        // fps
        assertTrue(m.fpsConflict(25.0, 23.976))                  // classic PAL/NTSC transfer
        assertTrue(!m.fpsConflict(23.976, 24.0))                 // within rounding tolerance
        assertTrue(!m.fpsConflict(0.0, 25.0))                    // unknown → no opinion
    }

    @Test fun releaseSimilarityPrefersTheMatchingRelease() {
        val m = com.hebsub.core.subtitle.SubtitleMatch
        val video = "Absent.2011.1080p.BluRay.x264-AMIABLE"
        val same = m.releaseSimilarity(video, "Absent 2011 1080p BluRay x264-AMIABLE")
        val other = m.releaseSimilarity(video, "Absent 2011 DVDRip XviD-NoGroup")
        assertTrue(same > other, "same release ($same) must outrank a different one ($other)")
        assertTrue(same > 0.7, "near-identical release should score high, was $same")
        assertEquals(-1.0, m.releaseSimilarity(video, null))     // unknown → no opinion
    }

    @Test fun alignerFitRejectsAnUnrelatedSubtitle() {
        // Speech every 6 s; a subtitle from a different film lands at random times
        // and must not be trusted, however we shift or scale it.
        val speech = (0 until 400).map { com.hebsub.core.subtitle.SubtitleAligner.Speech(it * 6000L + 1000, it * 6000L + 3000) }
        val rnd = java.util.Random(11)
        val unrelated = (1..300).map {
            val s = (rnd.nextDouble() * 2_400_000L).toLong()
            com.hebsub.core.subtitle.SubtitleCue(it, s, s + 1500, listOf("x"))
        }.sortedBy { it.startMs }.mapIndexed { i, c -> c.copy(index = i + 1) }
        val bad = com.hebsub.core.subtitle.SubtitleAligner.align(unrelated, speech)
        assertTrue(!bad.isTrustworthy, "unrelated subtitle must be rejected, fit=${bad.fit}")

        // A correctly-timed subtitle for the same audio must be trusted.
        val good = com.hebsub.core.subtitle.SubtitleAligner.align(
            speech.mapIndexed { i, s -> com.hebsub.core.subtitle.SubtitleCue(i + 1, s.startMs, s.endMs, listOf("x")) },
            speech,
        )
        assertTrue(good.isTrustworthy, "matching subtitle must be trusted, fit=${good.fit}")
    }

    @Test fun assStylerRoundTripsTheFourSettings() {
        val styler = com.hebsub.core.subtitle.AssStyler
        val cues = listOf(com.hebsub.core.subtitle.SubtitleCue(1, 1000, 2000, listOf("שורה", "שנייה")))
        val original = com.hebsub.core.subtitle.AssWriter.write(cues, bgTransparencyPercent = 50, fontName = "Alef")

        val wanted = com.hebsub.core.subtitle.AssStyleOptions(
            bgTransparencyPercent = 30, platePadding = 9, plateSidePadding = 22,
            marginV = 64, extraLineSpacing = 12, fontSize = 34,
        )
        val restyled = styler.restyle(original, wanted)
        val read = styler.read(restyled)!!

        assertEquals(30, read.bgTransparencyPercent)
        assertEquals(9, read.platePadding)
        assertEquals(22, read.plateSidePadding)      // horizontal extent, independent
        assertEquals(64, read.marginV)
        assertEquals(12, read.extraLineSpacing)
        assertEquals(34, read.fontSize)              // font size is editable
        assertEquals("Alef", styler.fontOf(restyled))            // font preserved
        assertTrue(restyled.contains("Dialogue: 0,0:00:01.00,0:00:02.00,Default"))  // timing untouched

        // Re-editing replaces the previous spacer/override rather than stacking them.
        val again = styler.restyle(restyled, wanted.copy(extraLineSpacing = 4, plateSidePadding = 5))
        assertEquals(4, styler.read(again)!!.extraLineSpacing)
        assertEquals(5, styler.read(again)!!.plateSidePadding)
        assertTrue(!again.contains("{\\fs12}"), "the old spacer must be gone")
        assertEquals(1, com.hebsub.core.subtitle.AssStyler.XBORD.findAll(again).count(),
            "exactly one xbord override per cue — they must not stack")
        // …and removing it entirely returns the plain two-line form.
        val none = styler.restyle(again, wanted.copy(extraLineSpacing = 0))
        assertEquals(0, styler.read(none)!!.extraLineSpacing)
        assertTrue(none.contains("שורה\\Nשנייה"))
    }

    @Test fun assStylerReadsAPlainNoPlateStyleAsFullyTransparent() {
        val styler = com.hebsub.core.subtitle.AssStyler
        val plain = com.hebsub.core.subtitle.AssWriter.write(
            listOf(com.hebsub.core.subtitle.SubtitleCue(1, 0, 1000, listOf("א"))),
            bgTransparencyPercent = 100,
        )
        assertEquals(100, styler.read(plain)!!.bgTransparencyPercent)   // BorderStyle 1 → no plate
    }

    @Test fun assParserRecoversCuesFromAStyledFile() {
        val p = com.hebsub.core.subtitle.AssParser
        // A file this app produced: per-axis override, a line-spacing spacer, \N break.
        val ass = """
            [Script Info]
            ScriptType: v4.00+

            [V4+ Styles]
            Style: Default,Alef,26,&H00FFFFFF,&H000000FF,&H4C1A1A1A,&H4C1A1A1A,0,0,0,0,100,100,0,0,3,6,0,2,20,20,16,1

            [Events]
            Dialogue: 0,0:02:26.28,0:02:27.77,Default,,0,0,0,,{\xbord8\ybord4}Hello there.
            Dialogue: 0,0:00:01.50,0:00:03.00,Default,,0,0,0,,First line\NSecond line
        """.trimIndent()
        assertTrue(p.looksLikeAss(ass))
        val cues = p.parse(ass)
        assertEquals(2, cues.size)
        // Sorted by time and re-indexed, overrides stripped.
        assertEquals(1500L, cues[0].startMs)
        assertEquals(3000L, cues[0].endMs)
        assertEquals(listOf("First line", "Second line"), cues[0].lines)
        assertEquals(1, cues[0].index)
        assertEquals(146280L, cues[1].startMs)          // 2:26.28
        assertEquals("Hello there.", cues[1].text)      // {\xbord…} gone
    }

    @Test fun assParserSurvivesOurOwnWriterOutput() {
        // What the app writes must be readable back — this is the path an uploaded
        // .ass takes when it has to be re-translated.
        val original = listOf(
            com.hebsub.core.subtitle.SubtitleCue(1, 2480, 3699, listOf("hello", "world")),
        )
        val written = com.hebsub.core.subtitle.AssWriter.write(
            original, bgTransparencyPercent = 40, fontName = "Alef",
            options = com.hebsub.core.subtitle.AssStyleOptions(
                bgTransparencyPercent = 40, extraLineSpacing = 8, plateSidePadding = 12,
            ),
        )
        val back = com.hebsub.core.subtitle.AssParser.parse(written)
        assertEquals(1, back.size)
        assertEquals(2480L, back[0].startMs)
        assertEquals(listOf("hello", "world"), back[0].lines)  // spacer + override removed
    }

    @Test fun offlineOnlyOmitsOnlineSteps() {
        val plan = SubtitleSourcePlanner.plan(
            embedded = emptyList(),
            audioLanguage = null,
            onlineEnabled = false,
        )
        assertTrue(plan.none { it is AcquisitionStep.OnlineHebrew || it is AcquisitionStep.OnlineSource })
        assertIs<AcquisitionStep.Transcribe>(plan.last())
    }

    @Test fun onlineSourcePrefersSourceLanguage() {
        val plan = SubtitleSourcePlanner.plan(emptyList(), audioLanguage = "fr", onlineEnabled = true)
        val onlineSrc = plan.filterIsInstance<AcquisitionStep.OnlineSource>().first()
        assertEquals(listOf("fr"), onlineSrc.preferredLanguages)
    }
}
