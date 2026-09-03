package com.hebsub.app.translate

import com.hebsub.core.lang.Language
import com.hebsub.core.provider.claude.ClaudeApi
import com.hebsub.core.provider.claude.ClaudeTranslator
import com.hebsub.core.subtitle.SubtitleCue
import com.hebsub.core.text.Glossary
import com.hebsub.app.log.RunLog
import com.hebsub.app.net.PrivacyHttp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

/**
 * High-quality, context-aware Hebrew translation via the Anthropic Messages API
 * (spec §3). All request building / response parsing lives in the tested :core
 * module; this class performs the HTTPS POSTs with the user's own key and makes
 * the process robust:
 *
 *  - Every batch is checked for completeness; ids the model skipped are
 *    re-requested (up to [MAX_ATTEMPTS]) instead of silently falling back to
 *    the source text (which previously left whole batches untranslated).
 *  - Transient HTTP failures (429/5xx/529) are retried with backoff.
 *  - Before the batches, one small request pins the Hebrew spelling of the names
 *    that recur in this film, so batch 3 and batch 11 cannot spell the same
 *    character differently. The names come from the subtitle itself — a film
 *    database would give the ACTORS' names, which is not what is being said.
 *  - The Hebrew already produced for the preceding lines is sent with each batch,
 *    so gender, register and continuity carry across the whole film.
 *
 * Privacy: only subtitle text is sent — no device or user identifiers. The key is
 * read from encrypted settings and used solely as the `x-api-key` header.
 */
class ClaudeCloudTranslator(
    private val apiKey: String,
    private val model: String = ClaudeApi.DEFAULT_MODEL,
) : TranslationEngine {

    private val jsonMedia = "application/json".toMediaType()

    override suspend fun translate(
        cues: List<SubtitleCue>,
        sourceLang: String?,
        onProgress: (Int, Int) -> Unit,
    ): List<SubtitleCue> = withContext(Dispatchers.IO) {
        require(apiKey.isNotBlank()) { "Missing Anthropic API key" }
        val sourceName = Language.canonical(sourceLang)
        val glossary = buildGlossary(cues, sourceName)
        val system = ClaudeTranslator.systemPrompt(sourceName, glossary)
        val batches = ClaudeTranslator.buildBatches(cues)
        RunLog.log("Claude: model=$model batches=${batches.size} cues=${cues.size} glossary=${glossary.isNotBlank()}")

        val translations = HashMap<Int, String>()
        var done = 0
        for ((i, batch) in batches.withIndex()) {
            // Hebrew of the preceding-context cues (translated in the previous batch),
            // so the model keeps continuity of names, gender and tone.
            val precedingHebrew = batch.contextBefore.map { translations[it.index] ?: "" }
            var missing = ClaudeTranslator.missingIds(batch, translations)
            var attempt = 0
            while (missing.isNotEmpty() && attempt < MAX_ATTEMPTS) {
                attempt++
                val onlyIds = if (attempt == 1) null else missing
                val userContent = ClaudeTranslator.buildUserContent(batch, precedingHebrew, onlyIds)
                val text = post(system, userContent, i, attempt)
                // Keep only ids of this batch — never let a stray id pollute another batch.
                val parsed = ClaudeTranslator.parseTranslations(text).filterKeys { it in missing }
                translations.putAll(parsed)
                missing = ClaudeTranslator.missingIds(batch, translations)
                RunLog.log("Claude batch $i attempt $attempt: +${parsed.size} missing=${missing.size}")
            }
            if (missing.isNotEmpty()) {
                RunLog.error("Claude batch $i: ${missing.size} lines still untranslated after $MAX_ATTEMPTS attempts (ids ${missing.take(10)})")
            }
            done += batch.cues.size
            onProgress(done, cues.size)
        }
        ClaudeTranslator.applyTranslations(cues, translations)
    }

    /**
     * Agree the Hebrew spelling of this film's recurring names up front. A failure
     * here is not fatal — the batches simply run without pinned names, exactly as
     * they did before — so it never blocks a translation.
     */
    private fun buildGlossary(cues: List<SubtitleCue>, sourceName: String?): String {
        val terms = Glossary.extractTerms(cues)
        if (terms.isEmpty()) { RunLog.log("glossary: no recurring names found"); return "" }
        val pinned = runCatching {
            val text = post(
                ClaudeTranslator.glossarySystemPrompt(sourceName),
                ClaudeTranslator.buildGlossaryContent(terms),
                batchIdx = -1, attempt = 1,
            )
            ClaudeTranslator.parseGlossary(text)
        }.getOrElse { RunLog.error("glossary failed — continuing without it", it); emptyMap() }
        RunLog.log("glossary: terms=${terms.size} pinned=${pinned.size} ${terms.take(8)}")
        return Glossary.render(pinned)
    }

    /** POST one request and return the model text; retries transient HTTP failures with backoff. */
    private fun post(system: String, userContent: String, batchIdx: Int, attempt: Int): String {
        val body = ClaudeTranslator.buildRequestBody(model, system, userContent)
        val what = if (batchIdx < 0) "glossary" else "batch $batchIdx"
        var lastErr = ""
        for (tryNo in 1..3) {
            val request = Request.Builder()
                .url(ClaudeApi.ENDPOINT)
                .header(ClaudeApi.HEADER_API_KEY, apiKey)
                .header(ClaudeApi.HEADER_VERSION, ClaudeApi.VERSION)
                .post(body.toRequestBody(jsonMedia))
                .build()
            PrivacyHttp.client.newCall(request).execute().use { resp ->
                val respBody = resp.body?.string().orEmpty()
                if (resp.isSuccessful) return ClaudeTranslator.extractText(respBody)
                lastErr = "HTTP ${resp.code}: ${respBody.take(200)}"
                val transient = resp.code == 429 || resp.code == 529 || resp.code >= 500
                RunLog.error("Claude $what (attempt $attempt, try $tryNo) $lastErr")
                if (!transient) throw RuntimeException("Claude API error ${resp.code}: ${respBody.take(300)}")
            }
            Thread.sleep(1500L * tryNo)
        }
        throw RuntimeException("Claude API error after retries: $lastErr")
    }

    private companion object {
        const val MAX_ATTEMPTS = 3
    }
}
