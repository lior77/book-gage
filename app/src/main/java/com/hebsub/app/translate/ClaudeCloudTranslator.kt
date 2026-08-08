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
 * High-quality Hebrew translation via the Anthropic Messages API (spec §3).
 * All request building / response parsing lives in the tested :core module;
 * this class only performs the HTTPS POST with the user's own key.
 *
 * Privacy: only subtitle text is sent — no device or user identifiers. The key
 * is read from encrypted settings and used solely as the `x-api-key` header.
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
        val system = ClaudeTranslator.systemPrompt(sourceName)
        val batches = ClaudeTranslator.buildBatches(cues)
        RunLog.log("Claude: model=$model batches=${batches.size} cues=${cues.size}")

        val translations = HashMap<Int, String>()
        var done = 0
        for ((i, batch) in batches.withIndex()) {
            val userContent = ClaudeTranslator.buildUserContent(batch)
            val body = ClaudeTranslator.buildRequestBody(model, system, userContent)
            val request = Request.Builder()
                .url(ClaudeApi.ENDPOINT)
                .header(ClaudeApi.HEADER_API_KEY, apiKey)
                .header(ClaudeApi.HEADER_VERSION, ClaudeApi.VERSION)
                .post(body.toRequestBody(jsonMedia))
                .build()

            PrivacyHttp.client.newCall(request).execute().use { resp ->
                val respBody = resp.body?.string().orEmpty()
                if (!resp.isSuccessful) {
                    RunLog.error("Claude batch $i HTTP ${resp.code}: ${respBody.take(200)}")
                    throw RuntimeException("Claude API error ${resp.code}: ${respBody.take(300)}")
                }
                val text = ClaudeTranslator.extractText(respBody)
                val parsed = ClaudeTranslator.parseTranslations(text)
                translations.putAll(parsed)
                RunLog.log("Claude batch $i ok: +${parsed.size}")
            }
            done += batch.cues.size
            onProgress(done, cues.size)
        }
        ClaudeTranslator.applyTranslations(cues, translations)
    }
}
