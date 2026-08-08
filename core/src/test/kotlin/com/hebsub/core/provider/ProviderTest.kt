package com.hebsub.core.provider

import com.hebsub.core.provider.claude.ClaudeTranslator
import com.hebsub.core.provider.opensubtitles.OpenSubtitlesQuery
import com.hebsub.core.subtitle.SubtitleCue
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class OpenSubtitlesQueryTest {
    @Test fun buildsSortedLanguageParam() {
        val params = OpenSubtitlesQuery.buildSearchParams(
            languages = listOf("he", "en"),
            movieHash = "ABC123",
            title = "The Movie",
        )
        assertEquals("en,he", params["languages"])   // canonical + alphabetical
        assertEquals("abc123", params["moviehash"])   // lowercased
        assertEquals("The Movie", params["query"])
    }

    private val response = """
        {"total_count":3,"data":[
          {"id":"1","attributes":{"language":"he","download_count":100,"hearing_impaired":true,
            "machine_translated":false,"from_trusted":true,"files":[{"file_id":11}]}},
          {"id":"2","attributes":{"language":"he","download_count":50,"hearing_impaired":false,
            "machine_translated":false,"from_trusted":false,"files":[{"file_id":22}]}},
          {"id":"3","attributes":{"language":"en","download_count":9999,"hearing_impaired":false,
            "machine_translated":false,"from_trusted":true,"files":[{"file_id":33}]}}
        ]}
    """.trimIndent()

    @Test fun selectsNonHearingImpairedHebrewOverPopularHi() {
        val parsed = OpenSubtitlesQuery.parse(response)
        val best = OpenSubtitlesQuery.selectBest(parsed, listOf("he"), excludeHearingImpaired = true)
        assertNotNull(best)
        assertEquals(22L, best.fileId) // non-HI Hebrew wins even though the HI one has more downloads
    }

    @Test fun honoursLanguagePriorityOrder() {
        val parsed = OpenSubtitlesQuery.parse(response)
        val best = OpenSubtitlesQuery.selectBest(parsed, listOf("en", "he"))
        assertNotNull(best)
        assertEquals(33L, best.fileId)
    }

    @Test fun returnsNullWhenPriorityLanguageAbsent() {
        val parsed = OpenSubtitlesQuery.parse(response)
        assertNull(OpenSubtitlesQuery.selectBest(parsed, listOf("de")))
    }

    @Test fun emptyPriorityPicksGlobalBest() {
        val parsed = OpenSubtitlesQuery.parse(response)
        val best = OpenSubtitlesQuery.selectBest(parsed, emptyList())
        assertNotNull(best)
        assertEquals(33L, best.fileId) // highest downloads among non-HI
    }
}

class ClaudeTranslatorTest {
    private val cues = (1..90).map { SubtitleCue(it, it * 1000L, it * 1000L + 900, listOf("line $it")) }

    @Test fun batchesWithContext() {
        val batches = ClaudeTranslator.buildBatches(cues, batchSize = 40, contextSize = 3)
        assertEquals(3, batches.size)
        assertEquals(40, batches[0].cues.size)
        assertTrue(batches[0].contextBefore.isEmpty())
        assertEquals(3, batches[1].contextBefore.size)      // three preceding cues
        assertEquals(10, batches[2].cues.size)              // remainder
    }

    @Test fun requestBodyHasModelAndUserMessage() {
        val batch = ClaudeTranslator.buildBatches(cues.take(2), batchSize = 40).first()
        val user = ClaudeTranslator.buildUserContent(batch)
        val body = ClaudeTranslator.buildRequestBody("claude-sonnet-5", "sys", user, maxTokens = 4096)
        assertTrue(body.contains("\"model\":\"claude-sonnet-5\""))
        assertTrue(body.contains("\"max_tokens\":4096"))
        assertTrue(body.contains("\"role\":\"user\""))
        assertTrue(user.contains("\"lines\""))
        assertTrue(user.contains("\"id\":1"))
    }

    @Test fun extractsTextFromResponse() {
        val resp = """{"content":[{"type":"text","text":"{\"1\":\"שלום\"}"}],"stop_reason":"end_turn"}"""
        assertEquals("""{"1":"שלום"}""", ClaudeTranslator.extractText(resp))
    }

    @Test fun parsesTranslationsToleratingFences() {
        val text = "Here you go:\n```json\n{\"1\": \"שלום\", \"2\": \"עולם\"}\n```"
        val map = ClaudeTranslator.parseTranslations(text)
        assertEquals("שלום", map[1])
        assertEquals("עולם", map[2])
    }

    @Test fun appliesTranslationsKeepingTiming() {
        val out = ClaudeTranslator.applyTranslations(
            cues.take(2),
            mapOf(1 to "שלום"),
        )
        assertEquals("שלום", out[0].text)
        assertEquals(1000L, out[0].startMs)          // timing untouched
        assertEquals("line 2", out[1].text)          // untranslated kept as-is
    }
}
