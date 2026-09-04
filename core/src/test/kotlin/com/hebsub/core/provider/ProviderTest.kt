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
    @Test fun searchesByHashOnly() {
        val params = OpenSubtitlesQuery.buildSearchParams(listOf("he", "en"), movieHash = "ABC123")
        assertEquals("en,he", params["languages"])   // canonical + alphabetical
        assertEquals("abc123", params["moviehash"])   // lowercased
        // Title/year/imdb lookups are gone: they find the right film, not the right cut.
        assertNull(params["query"])
        assertNull(params["imdb_id"])
        assertNull(params["year"])
    }

    private val response = """
        {"total_count":4,"data":[
          {"id":"1","attributes":{"language":"he","download_count":100,"hearing_impaired":true,
            "machine_translated":false,"from_trusted":true,"moviehash_match":true,"files":[{"file_id":11}]}},
          {"id":"2","attributes":{"language":"he","download_count":50,"hearing_impaired":false,
            "machine_translated":false,"from_trusted":false,"moviehash_match":true,"files":[{"file_id":22}]}},
          {"id":"3","attributes":{"language":"en","download_count":9999,"hearing_impaired":false,
            "machine_translated":false,"from_trusted":true,"moviehash_match":true,"files":[{"file_id":33}]}},
          {"id":"4","attributes":{"language":"he","download_count":99999,"hearing_impaired":false,
            "machine_translated":false,"from_trusted":true,"moviehash_match":false,"files":[{"file_id":44}]}}
        ]}
    """.trimIndent()

    @Test fun keepsOnlyHashMatches() {
        val ranked = OpenSubtitlesQuery.rankCandidates(OpenSubtitlesQuery.parse(response), listOf("he"))
        // The wildly popular non-hash match is dropped, however attractive it looks.
        assertTrue(ranked.none { it.fileId == 44L }, "a non-hash match must never be offered")
        assertTrue(ranked.all { it.hashMatch })
    }

    @Test fun ranksNonHearingImpairedHebrewFirst() {
        val ranked = OpenSubtitlesQuery.rankCandidates(OpenSubtitlesQuery.parse(response), listOf("he"))
        assertEquals(22L, ranked.first().fileId) // non-SDH Hebrew beats the more popular SDH one
    }

    @Test fun honoursLanguagePriorityOrder() {
        val ranked = OpenSubtitlesQuery.rankCandidates(OpenSubtitlesQuery.parse(response), listOf("en", "he"))
        assertEquals(33L, ranked.first().fileId)
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

    @Test fun salvagesTranslationsFromATruncatedReply() {
        // Exactly the shape seen in the Horseplay run: valid JSON that stops in the
        // middle of a value. Everything complete before the cut must survive.
        val text = """{"201":"יותר חכם","202":"מהשמן הגמגם.","203":"כדי לזיין אותה.","204":"ואתה חושב שהבחור"""
        val map = ClaudeTranslator.parseTranslations(text)
        assertEquals("יותר חכם", map[201])
        assertEquals("מהשמן הגמגם.", map[202])
        assertEquals("כדי לזיין אותה.", map[203])
        assertEquals(3, map.size, "the value cut in half must not be kept")
    }

    @Test fun salvageUnescapesAndKeepsQuotes() {
        val text = """{"7":"הוא אמר \"די\"\nוהלך""" + "\"" + ", \"8\":\"בסדר\""
        val map = ClaudeTranslator.parseTranslations(text)
        assertEquals("הוא אמר \"די\"\nוהלך", map[7])
        assertEquals("בסדר", map[8])
    }

    @Test fun readsTheStopReason() {
        val resp = """{"content":[{"type":"text","text":""}],"stop_reason":"refusal"}"""
        assertEquals("refusal", ClaudeTranslator.stopReason(resp))
        assertEquals(null, ClaudeTranslator.stopReason("not json at all"))
    }

    @Test fun glossaryPinsSpellingsInTheSystemPrompt() {
        val prompt = ClaudeTranslator.systemPrompt("en", "Martin = מרטין\nQuinn = קווין")
        assertTrue(prompt.contains("Martin = מרטין"))
        assertTrue(prompt.contains("EXACTLY"), "the model must be told these are binding")
        // Without a glossary the prompt carries no film blurb at all — the cast list
        // names the actors, not the characters, so it only misleads.
        assertTrue(!ClaudeTranslator.systemPrompt("en").contains("EXACTLY these Hebrew spellings"))
    }

    @Test fun parsesGlossaryToleratingFences() {
        val map = ClaudeTranslator.parseGlossary("```json\n{\"Martin\": \"מרטין\", \"Quinn\": \"\"}\n```")
        assertEquals("מרטין", map["Martin"])
        assertTrue("Quinn" !in map, "an empty rendering pins nothing")
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

class ClaudeRequestBudgetTest {
    @Test fun sendsEffortAndARealCeilingToModelsThatUnderstandIt() {
        val body = ClaudeTranslator.buildRequestBody("claude-sonnet-5", "sys", """{"lines":[]}""")
        assertTrue(body.contains("\"output_config\":{\"effort\":\"medium\"}"), body)
        assertTrue(body.contains("\"max_tokens\":16000"), body)
    }

    @Test fun omitsEffortForHaikuWhichRejectsIt() {
        val body = ClaudeTranslator.buildRequestBody("claude-haiku-4-5", "sys", """{"lines":[]}""")
        assertTrue(!body.contains("output_config"), "haiku 4.5 returns 400 for output_config.effort")
        assertTrue(body.contains("\"max_tokens\":8192"), body)
    }

    @Test fun readsUsageForTheLog() {
        val resp = """{"content":[],"stop_reason":"max_tokens","usage":{"input_tokens":1200,"output_tokens":8192}}"""
        assertEquals("in=1200 out=8192", ClaudeTranslator.usageSummary(resp))
        assertEquals("-", ClaudeTranslator.usageSummary("nonsense"))
    }
}
