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
 *  - A batch that still fails is then narrowed: the remaining ids are asked for
 *    in small groups and finally one at a time. A batch rarely fails because all
 *    forty lines are unanswerable — it is usually a few, and asking for them
 *    together loses the rest with them.
 *  - A reply that is cut off mid-JSON is salvaged for whatever it did contain
 *    rather than discarded whole, and the API's own stop_reason is logged, so a
 *    refusal, a truncation and a parse failure are told apart in the log.
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
        machineTranscript: Boolean,
        onProgress: (Int, Int) -> Unit,
    ): List<SubtitleCue> = withContext(Dispatchers.IO) {
        require(apiKey.isNotBlank()) { "Missing Anthropic API key" }
        val sourceName = Language.canonical(sourceLang)
        val glossary = buildGlossary(cues, sourceName)
        val system = ClaudeTranslator.systemPrompt(sourceName, glossary, machineTranscript)
        if (machineTranscript) RunLog.log("Claude: source is a machine transcript — translating for the scene, not the letter")
        val batches = ClaudeTranslator.buildBatches(cues)
        RunLog.log("Claude: model=$model batches=${batches.size} cues=${cues.size} glossary=${glossary.isNotBlank()}")

        val translations = HashMap<Int, String>()
        var done = 0
        var untranslated = 0
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
                val reply = request(system, userContent, i, "attempt $attempt")
                // Keep only ids of this batch — never let a stray id pollute another batch.
                val parsed = ClaudeTranslator.parseTranslations(reply.text).filterKeys { it in missing }
                translations.putAll(parsed)
                missing = ClaudeTranslator.missingIds(batch, translations)
                RunLog.log(
                    "Claude batch $i attempt $attempt: +${parsed.size} missing=${missing.size} " +
                        "stop=${reply.stopReason ?: "-"} ${reply.usage}"
                )
                // The budget is shared between thinking and the answer, so a batch that
                // stops on max_tokens is the request's fault, not the model's.
                if (reply.stopReason == "max_tokens") {
                    RunLog.error("Claude batch $i attempt $attempt: hit the output ceiling (${reply.usage}) — reply truncated")
                    RunLog.issue("תקרת הפלט של המתרגם הושגה (אצווה $i) — תשובה נקטעה")
                }

                // §3 — when an attempt yields nothing, record what actually came back.
                // Without this a repeated "+0" is undiagnosable after the fact: an empty
                // reply, a refusal and unparseable JSON all look identical in the log.
                if (parsed.isEmpty()) {
                    RunLog.error(
                        "Claude batch $i attempt $attempt: no usable translations. " +
                            "stop=${reply.stopReason ?: "-"} ${reply.usage} " +
                            "reply=${reply.text.length} chars: ${sample(reply.text)}"
                    )
                }
            }

            // Narrowing. A batch that keeps coming back empty is not usually 40 bad
            // lines — it is a handful the model will not write, taking the other 30-odd
            // down with them. Asking for small groups, and then for single lines,
            // isolates the ones that actually fail and rescues the rest.
            if (missing.isNotEmpty()) {
                for (chunk in NARROW_CHUNKS) {
                    if (missing.isEmpty()) break
                    if (chunk == 1 && missing.size > MAX_SINGLE_RETRIES) break
                    val before = missing.size
                    missing = narrow(system, batch, precedingHebrew, missing, translations, i, chunk)
                    RunLog.log("Claude batch $i narrowing(size=$chunk): recovered=${before - missing.size} still=${missing.size}")
                }
            }

            if (missing.isNotEmpty()) {
                untranslated += missing.size
                RunLog.error("Claude batch $i: ${missing.size} lines still untranslated after every retry (ids ${missing.take(10)})")
                // The source text of the first few, so the log shows WHAT failed and not
                // only that something did — a refusal usually has a visible cause.
                batch.cues.filter { it.index in missing }.take(3).forEach {
                    RunLog.error("  untranslated id=${it.index}: ${it.text.replace('\n', ' ').take(120)}")
                }
            }
            done += batch.cues.size
            onProgress(done, cues.size)
        }
        if (untranslated > 0) {
            RunLog.error("TRANSLATION INCOMPLETE: $untranslated of ${cues.size} lines stayed in the source language")
            RunLog.issue("$untranslated מתוך ${cues.size} שורות לא תורגמו על ידי Claude")
        } else {
            RunLog.log("translation complete: ${cues.size}/${cues.size} lines")
        }
        ClaudeTranslator.applyTranslations(cues, translations)
    }

    /**
     * Re-ask for [missing] in groups of [chunk] ids and return what is still
     * missing afterwards. Each group is one request, so a group the model will not
     * answer costs only its own ids.
     */
    private fun narrow(
        system: String,
        batch: ClaudeTranslator.Batch,
        precedingHebrew: List<String>,
        missing: Set<Int>,
        translations: MutableMap<Int, String>,
        batchIdx: Int,
        chunk: Int,
    ): Set<Int> {
        for (group in missing.chunked(chunk)) {
            val ids = group.toSet()
            val content = ClaudeTranslator.buildUserContent(batch, precedingHebrew, ids)
            val reply = request(system, content, batchIdx, "narrow ${ids.size}")
            val parsed = ClaudeTranslator.parseTranslations(reply.text).filterKeys { it in ids }
            translations.putAll(parsed)
        }
        return ClaudeTranslator.missingIds(batch, translations)
    }

    /** One request, with the failure turned into an empty reply rather than an exception. */
    private fun request(system: String, userContent: String, batchIdx: Int, what: String): Reply =
        runCatching { post(system, userContent, batchIdx, what) }
            .getOrElse { e ->
                // A request that never came back at all is itself a finding.
                RunLog.error("Claude batch $batchIdx $what: request failed — ${e.message.orEmpty().take(200)}")
                Reply("", null)
            }

    /** The model's text plus the API's own reason for stopping and what it spent. */
    private data class Reply(val text: String, val stopReason: String?, val usage: String = "-")

    /** A single-line, length-capped excerpt of a model reply, safe to put in a log. */
    private fun sample(text: String): String =
        if (text.isBlank()) "<empty>"
        else text.replace('\n', ' ').replace('\r', ' ').trim().take(300)

    /**
     * Agree the Hebrew spelling of this film's recurring names up front. A failure
     * here is not fatal — the batches simply run without pinned names, exactly as
     * they did before — so it never blocks a translation.
     */
    private fun buildGlossary(cues: List<SubtitleCue>, sourceName: String?): String {
        val terms = Glossary.extractTerms(cues)
        if (terms.isEmpty()) { RunLog.log("glossary: no recurring names found"); return "" }
        val pinned = runCatching {
            val reply = post(
                ClaudeTranslator.glossarySystemPrompt(sourceName),
                ClaudeTranslator.buildGlossaryContent(terms),
                batchIdx = -1, attempt = "attempt 1",
            )
            ClaudeTranslator.parseGlossary(reply.text)
        }.getOrElse { RunLog.error("glossary failed — continuing without it", it); emptyMap() }
        RunLog.log("glossary: terms=${terms.size} pinned=${pinned.size} ${terms.take(8)}")
        return Glossary.render(pinned)
    }

    /** POST one request and return the model text; retries transient HTTP failures with backoff. */
    private fun post(system: String, userContent: String, batchIdx: Int, attempt: String): Reply {
        val effort = if (batchIdx < 0) ClaudeTranslator.GLOSSARY_EFFORT else ClaudeTranslator.DEFAULT_EFFORT
        val body = ClaudeTranslator.buildRequestBody(model, system, userContent, effort = effort)
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
                if (resp.isSuccessful) {
                    return Reply(
                        text = ClaudeTranslator.extractText(respBody),
                        stopReason = ClaudeTranslator.stopReason(respBody),
                        usage = ClaudeTranslator.usageSummary(respBody),
                    )
                }
                lastErr = "HTTP ${resp.code}: ${respBody.take(200)}"
                val transient = resp.code == 429 || resp.code == 529 || resp.code >= 500
                RunLog.error("Claude $what ($attempt, try $tryNo) $lastErr")
                if (!transient) throw RuntimeException("Claude API error ${resp.code}: ${respBody.take(300)}")
            }
            Thread.sleep(1500L * tryNo)
        }
        throw RuntimeException("Claude API error after retries: $lastErr")
    }

    private companion object {
        const val MAX_ATTEMPTS = 2

        /** Group sizes for the narrowing pass, from coarse to one line at a time. */
        val NARROW_CHUNKS = listOf(8, 1)

        /** Never fire more than this many single-line requests for one batch. */
        const val MAX_SINGLE_RETRIES = 16
    }
}
