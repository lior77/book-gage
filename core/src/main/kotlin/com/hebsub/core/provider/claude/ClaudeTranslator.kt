package com.hebsub.core.provider.claude

import com.hebsub.core.subtitle.SubtitleCue
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

/**
 * Builds Anthropic Messages API requests for high-quality Hebrew subtitle
 * translation and parses the responses. Pure and network-free: the app layer
 * takes [buildRequestBody] output, POSTs it, and feeds the raw JSON back into
 * [extractText] + [parseTranslations].
 *
 * Quality strategy (spec §3 — reflect intent, not a literal gloss):
 *  - Each request translates a batch of cues together, with a few preceding
 *    cues as read-only context, so the model keeps continuity and register.
 *  - The system prompt asks for faithful, idiom-aware Hebrew that preserves
 *    tone, humour and speaker intent, stays concise for on-screen reading, and
 *    never merges or splits cues.
 *  - Output is strict JSON keyed by cue id, so cues map back 1:1 and timing is
 *    never disturbed.
 */
object ClaudeTranslator {

    const val DEFAULT_BATCH_SIZE = 40
    const val DEFAULT_CONTEXT_SIZE = 6

    /** Thinking depth for a translation batch — see [buildRequestBody]. */
    const val DEFAULT_EFFORT = "medium"

    /** Thinking depth for the glossary pass: a list of names needs none. */
    const val GLOSSARY_EFFORT = "low"

    // Lenient: the model occasionally emits relaxed JSON; we still want the map.
    private val json = Json { ignoreUnknownKeys = true; isLenient = true }

    data class Batch(
        val cues: List<SubtitleCue>,
        val contextBefore: List<SubtitleCue>,
    )

    /** Split [cues] into batches, each carrying up to [contextSize] preceding cues as context. */
    fun buildBatches(
        cues: List<SubtitleCue>,
        batchSize: Int = DEFAULT_BATCH_SIZE,
        contextSize: Int = DEFAULT_CONTEXT_SIZE,
    ): List<Batch> {
        if (cues.isEmpty()) return emptyList()
        val size = batchSize.coerceAtLeast(1)
        val batches = ArrayList<Batch>()
        var start = 0
        while (start < cues.size) {
            val end = minOf(start + size, cues.size)
            val ctxStart = (start - contextSize).coerceAtLeast(0)
            batches.add(
                Batch(
                    cues = cues.subList(start, end).toList(),
                    contextBefore = cues.subList(ctxStart, start).toList(),
                )
            )
            start = end
        }
        return batches
    }

    /**
     * @param glossary agreed Hebrew spellings for names that recur in this film,
     *   as `Name = שם` lines. These come from the subtitle itself, not from a film
     *   database: a cast list names the ACTORS, not the characters, so feeding it
     *   in misleads the model instead of helping it.
     */
    fun systemPrompt(
        sourceLanguageName: String?,
        glossary: String? = null,
        machineTranscript: Boolean = false,
    ): String {
        val src = sourceLanguageName?.takeIf { it.isNotBlank() } ?: "the source language"
        val film = glossary?.takeIf { it.isNotBlank() }?.let {
            "\n\nUse EXACTLY these Hebrew spellings every time these names appear:\n$it"
        } ?: ""
        // A recogniser's transcript is not a script. Told this, the model reads a
        // line that makes no sense as a mishearing and renders what the scene means,
        // instead of faithfully translating a word nobody said.
        val transcript = if (machineTranscript) {
            "\n\nThe source lines are an AUTOMATIC SPEECH TRANSCRIPT of the soundtrack, not a written subtitle: " +
                "a word may be misheard for a similar-sounding one, punctuation is partial, and one line may " +
                "contain more than one speaker. Translate what was most plausibly SAID in the scene. When a " +
                "word makes no sense in context, prefer the reading a native listener would have understood " +
                "over a literal rendering of the transcript. Keep colloquial register; do not sanitise or soften."
        } else ""
        return """
            You are a professional film subtitle translator. Translate film/TV subtitles from $src into natural, fluent Modern Hebrew that reads like a real Israeli cinema/TV subtitle.

            Principles:
            - Translate MEANING and INTENT in context, never word-for-word. Read each line in light of the surrounding dialogue and the film's story; resolve ambiguity from context (who is speaking to whom, sarcasm, threats, jokes, flirting, formality).
            - Preserve tone, register, humour, sarcasm, slang and idiom — render idioms with the closest natural Hebrew equivalent, never a literal gloss.
            - Keep characters consistent: the same name, nickname, gendered forms and level of formality every time. Hebrew verbs/adjectives must agree with the speaker's and addressee's gender as implied by the dialogue.
            - Keep each subtitle concise and readable at a glance, as real subtitles are. Prefer everyday spoken Hebrew over stilted or overly formal phrasing.
            - Preserve proper nouns and established Hebrew renderings of names/places where they exist.
            - Do NOT merge, split, reorder, add, or omit lines. Return exactly one Hebrew translation per input id, and translate EVERY id you are given.
            - The preceding-context lines (and their Hebrew, when given) are for continuity only; do not translate them again.
            - Output Hebrew text only — no transliteration, no notes, no romanization.

            Return ONLY a single JSON object mapping each input id (as a string) to its Hebrew translation, e.g. {"12":"…","13":"…"}. Escape newlines inside a translation as \n. No markdown, no code fences, no extra text.$film$transcript
        """.trimIndent()
    }

    /**
     * The user-turn content as JSON: preceding source context (with its Hebrew
     * when already translated, for continuity), then the id/text lines to
     * translate. [onlyIds] restricts the lines to a subset — used to re-request
     * ids the model skipped.
     */
    fun buildUserContent(
        batch: Batch,
        precedingHebrew: List<String> = emptyList(),
        onlyIds: Set<Int>? = null,
    ): String {
        val obj = buildJsonObject {
            put("context_preceding", buildJsonArray {
                batch.contextBefore.forEachIndexed { i, cue ->
                    val he = precedingHebrew.getOrNull(i)
                    if (he != null) {
                        add(buildJsonObject { put("text", cue.text); put("hebrew", he) })
                    } else {
                        add(JsonPrimitive(cue.text))
                    }
                }
            })
            put("lines", buildJsonArray {
                batch.cues.forEach { cue ->
                    if (onlyIds != null && cue.index !in onlyIds) return@forEach
                    add(buildJsonObject {
                        put("id", cue.index)
                        put("text", cue.text)
                    })
                }
            })
        }
        return json.encodeToString(JsonObject.serializer(), obj)
    }

    /**
     * One small request, made before the batches, that fixes the Hebrew spelling
     * of the names recurring in this film. Pinning them up front is what stops
     * batch 3 and batch 11 spelling the same character differently.
     */
    fun glossarySystemPrompt(sourceLanguageName: String?): String {
        val src = sourceLanguageName?.takeIf { it.isNotBlank() } ?: "the source language"
        return """
            You transliterate and translate proper nouns from film subtitles ($src) into Hebrew.

            For each term decide what it is and render it accordingly:
            - Personal and place names: transliterate into Hebrew script the way Israeli subtitles conventionally write them, keeping any established Hebrew form.
            - Words that are not proper nouns after all (a common noun that happened to be capitalised): translate them normally.

            Return ONLY a JSON object mapping each input term to its Hebrew form, e.g. {"Martin":"מרטין"}. No markdown, no notes.
        """.trimIndent()
    }

    fun buildGlossaryContent(terms: List<String>): String {
        val obj = buildJsonObject {
            put("terms", buildJsonArray { terms.forEach { add(JsonPrimitive(it)) } })
        }
        return json.encodeToString(JsonObject.serializer(), obj)
    }

    /** Parse the term→Hebrew map; tolerates fences and stray prose like [parseTranslations]. */
    fun parseGlossary(modelText: String): Map<String, String> {
        val cleaned = escapeControlCharsInStrings(modelText)
        val slice = extractBlock(cleaned, '{', '}') ?: return emptyMap()
        val obj = runCatching { json.parseToJsonElement(slice).jsonObject }.getOrNull() ?: return emptyMap()
        val out = LinkedHashMap<String, String>()
        for ((k, v) in obj) {
            val hebrew = (v as? JsonPrimitive)?.contentOrNull?.trim() ?: continue
            if (k.isNotBlank() && hebrew.isNotEmpty()) out[k] = hebrew
        }
        return out
    }

    /** Ids in [batch] that have no translation yet. */
    fun missingIds(batch: Batch, translations: Map<Int, String>): Set<Int> =
        batch.cues.map { it.index }.filter { it !in translations || translations[it].isNullOrBlank() }.toSet()

    /**
     * Build the full Messages API request body as a JSON string.
     *
     * [effort] decides how much the model thinks before answering. It is not a
     * quality dial to be left at maximum: thinking tokens are drawn from the same
     * [maxTokens] budget as the answer, so on a batch the model finds hard, the
     * reasoning can consume the budget and leave the JSON cut off — or absent. That
     * is what happened to this app on Sonnet 5, which thinks adaptively at effort
     * `high` unless told otherwise. Translating subtitles is bounded work, not a
     * puzzle, so it asks for a moderate amount and keeps the room for the Hebrew.
     */
    fun buildRequestBody(
        model: String,
        system: String,
        userContent: String,
        maxTokens: Int = ClaudeApi.maxOutputTokens(model),
        effort: String? = DEFAULT_EFFORT,
    ): String {
        val body = buildJsonObject {
            put("model", model)
            put("max_tokens", maxTokens)
            put("system", system)
            if (effort != null && ClaudeApi.supportsEffort(model)) {
                put("output_config", buildJsonObject { put("effort", effort) })
            }
            put("messages", buildJsonArray {
                add(buildJsonObject {
                    put("role", "user")
                    put("content", userContent)
                })
            })
        }
        return json.encodeToString(JsonObject.serializer(), body)
    }

    /** `in=… out=…` from a response's usage block, for the log. */
    fun usageSummary(responseBody: String): String =
        runCatching {
            val u = json.parseToJsonElement(responseBody).jsonObject["usage"]?.jsonObject ?: return "-"
            val inTok = u["input_tokens"]?.jsonPrimitive?.contentOrNull ?: "?"
            val outTok = u["output_tokens"]?.jsonPrimitive?.contentOrNull ?: "?"
            "in=$inTok out=$outTok"
        }.getOrDefault("-")

    /**
     * The API's own account of why generation stopped ("end_turn", "max_tokens",
     * "refusal", …). Worth logging on a failed batch: an empty reply, a reply cut
     * off mid-sentence and a reply the model declined to write are indistinguishable
     * from the text alone, and they call for different responses.
     */
    fun stopReason(responseBody: String): String? =
        runCatching {
            json.parseToJsonElement(responseBody).jsonObject["stop_reason"]?.jsonPrimitive?.contentOrNull
        }.getOrNull()

    /** Concatenate the text blocks from a Messages API response. */
    fun extractText(responseBody: String): String {
        val root = json.parseToJsonElement(responseBody).jsonObject
        val content = root["content"]?.jsonArray ?: return ""
        return content.joinToString("") { block ->
            val o = block.jsonObject
            if (o["type"]?.jsonPrimitive?.contentOrNull == "text") {
                o["text"]?.jsonPrimitive?.contentOrNull ?: ""
            } else ""
        }
    }

    /**
     * Parse the model's JSON id→translation map, tolerating stray prose or code
     * fences around it. Returns id→Hebrew text for every id it could recover.
     */
    fun parseTranslations(modelText: String): Map<Int, String> {
        // Raw newlines inside string values are the most common way the model
        // produces invalid JSON; escape them before parsing.
        val cleaned = escapeControlCharsInStrings(modelText)

        // 1) {"12":"…","13":"…"}
        extractBlock(cleaned, '{', '}')?.let { slice ->
            runCatching { json.parseToJsonElement(slice).jsonObject }.getOrNull()?.let { obj ->
                val result = LinkedHashMap<Int, String>()
                for ((key, value) in obj) {
                    val id = key.toIntOrNull() ?: continue
                    val text = (value as? JsonPrimitive)?.contentOrNull ?: continue
                    result[id] = text
                }
                if (result.isNotEmpty()) return result
            }
        }
        // 2) [{"id":12,"text":"…"}, …]  (also accepts "hebrew"/"he"/"translation")
        extractBlock(cleaned, '[', ']')?.let { slice ->
            runCatching { json.parseToJsonElement(slice).jsonArray }.getOrNull()?.let { arr ->
                val result = LinkedHashMap<Int, String>()
                for (el in arr) {
                    val o = el as? JsonObject ?: continue
                    val id = (o["id"] as? JsonPrimitive)?.contentOrNull?.toIntOrNull() ?: continue
                    val text = listOf("text", "hebrew", "he", "translation")
                        .firstNotNullOfOrNull { (o[it] as? JsonPrimitive)?.contentOrNull } ?: continue
                    result[id] = text
                }
                if (result.isNotEmpty()) return result
            }
        }
        // 3) Salvage. Both parsers above need the document to be well-formed, so a
        //    reply that stops in the middle — hitting the token ceiling, or being
        //    cut short — yields nothing at all, and the lines that DID come back are
        //    thrown away with the ones that did not. Scan for the pairs directly and
        //    keep whatever is complete.
        return salvagePairs(cleaned)
    }

    /** Recover `"id":"text"` pairs from a reply that is not valid JSON as a whole. */
    private fun salvagePairs(text: String): Map<Int, String> {
        val result = LinkedHashMap<Int, String>()
        for (m in PAIR.findAll(text)) {
            val id = m.groupValues[1].toIntOrNull() ?: continue
            val value = unescapeJsonString(m.groupValues[2]).trim()
            if (value.isNotEmpty()) result[id] = value
        }
        return result
    }

    private val PAIR = Regex("""["'](\d{1,6})["']\s*:\s*"((?:[^"\\]|\\.)*)"""")

    private fun unescapeJsonString(s: String): String {
        if ('\\' !in s) return s
        val sb = StringBuilder(s.length)
        var i = 0
        while (i < s.length) {
            val c = s[i]
            if (c != '\\' || i == s.length - 1) { sb.append(c); i++; continue }
            when (val e = s[i + 1]) {
                'n' -> { sb.append('\n'); i += 2 }
                'r' -> { sb.append('\r'); i += 2 }
                't' -> { sb.append('\t'); i += 2 }
                'b' -> { sb.append('\b'); i += 2 }
                'f' -> { sb.append('\u000C'); i += 2 }
                'u' -> {
                    val hex = s.substring(i + 2, minOf(i + 6, s.length))
                    val code = hex.takeIf { it.length == 4 }?.toIntOrNull(16)
                    if (code != null) { sb.append(code.toChar()); i += 6 } else { sb.append(e); i += 2 }
                }
                else -> { sb.append(e); i += 2 }   // \" \\ \/ and anything unexpected
            }
        }
        return sb.toString()
    }

    /** Apply id→translation onto cues, keeping timing. Untranslated cues are kept as-is. */
    fun applyTranslations(cues: List<SubtitleCue>, translations: Map<Int, String>): List<SubtitleCue> =
        cues.map { cue -> translations[cue.index]?.let { cue.withText(it) } ?: cue }

    /** Extract the outermost open…close block from arbitrary text (handles code fences / preamble). */
    private fun extractBlock(text: String, open: Char, close: Char): String? {
        val start = text.indexOf(open)
        val end = text.lastIndexOf(close)
        if (start < 0 || end <= start) return null
        return text.substring(start, end + 1)
    }

    /** Escape raw newline/tab characters that appear INSIDE JSON string literals. */
    private fun escapeControlCharsInStrings(s: String): String {
        val sb = StringBuilder(s.length + 16)
        var inStr = false
        var esc = false
        for (ch in s) {
            if (inStr) {
                when {
                    esc -> { sb.append(ch); esc = false }
                    ch == '\\' -> { sb.append(ch); esc = true }
                    ch == '"' -> { sb.append(ch); inStr = false }
                    ch == '\n' -> sb.append("\\n")
                    ch == '\r' -> sb.append("\\r")
                    ch == '\t' -> sb.append("\\t")
                    else -> sb.append(ch)
                }
            } else {
                sb.append(ch)
                if (ch == '"') inStr = true
            }
        }
        return sb.toString()
    }
}
