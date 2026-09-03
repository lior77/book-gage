package com.hebsub.app.translate

import com.hebsub.core.lang.Language
import com.hebsub.core.provider.claude.ClaudeApi
import com.hebsub.core.provider.claude.ClaudeTranslator
import com.hebsub.core.subtitle.SubtitleCue
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
 *  - The film's title/synopsis ([filmContext]) and the Hebrew already produced
 *    for the preceding lines are sent with each batch, so the model translates
 *    with an understanding of the story and keeps names/gender/register
 *    consistent across the whole film.
 *
 * Privacy: only subtitle text and the film description are sent — no device or
 * user identifiers. The key is read from encrypted settings and used solely as
 * the `x-api-key` header.
 */
class ClaudeCloudTranslator(
    private val apiKey: String,
    private val model: String = ClaudeApi.DEFAULT_MODEL,
    private val filmContext: String? = null,
) : TranslationEngine {

    private val jsonMedia = "application/json".toMediaType()

    override suspend fun translate(
        cues: List<SubtitleCue>,
        sourceLang: String?,
        onProgress: (Int, Int) -> Unit,
    ): List<SubtitleCue> = withContext(Dispatchers.IO) {
        require(apiKey.isNotBlank()) { "Missing Anthropic API key" }
        val sourceName = Language.canonical(sourceLang)
        val system = ClaudeTranslator.systemPrompt(sourceName, filmContext)
        val batches = ClaudeTranslator.buildBatches(cues)
        RunLog.log("Claude: model=$model batches=${batches.size} cues=${cues.size} filmContext=${filmContext != null}")

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

    /** POST one request and return the model text; retries transient HTTP failures with backoff. */
    private fun post(system: String, userContent: String, batchIdx: Int, attempt: Int): String {
        val body = ClaudeTranslator.buildRequestBody(model, system, userContent)
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
                RunLog.error("Claude batch $batchIdx (attempt $attempt, try $tryNo) $lastErr")
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
