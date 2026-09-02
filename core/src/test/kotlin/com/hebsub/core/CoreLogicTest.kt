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
        assertTrue(ass.contains("&H60303030"))                    // gray, alpha 0x60
        assertTrue(ass.contains("Dialogue: 0,0:00:02.48,0:00:03.69,Default"))
        assertTrue(ass.contains("שלום\\Nעולם"))                    // lines joined with \N
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
