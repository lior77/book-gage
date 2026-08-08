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
