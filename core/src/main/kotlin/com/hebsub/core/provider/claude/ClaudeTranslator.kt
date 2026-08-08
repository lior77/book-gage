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
    const val DEFAULT_CONTEXT_SIZE = 3
    const val DEFAULT_MAX_TOKENS = 8192

    private val json = Json { ignoreUnknownKeys = true }

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

    fun systemPrompt(sourceLanguageName: String?): String {
        val src = sourceLanguageName?.takeIf { it.isNotBlank() } ?: "the source language"
        return """
            You are a professional subtitle translator. Translate film/TV subtitles from $src into natural, fluent Modern Hebrew.

            Principles:
            - Translate meaning and intent, not word-for-word. Preserve tone, register, humour, sarcasm, and idiom — render idioms with the closest natural Hebrew equivalent, never a literal gloss.
            - Keep each subtitle concise and readable at a glance, as real subtitles are. Prefer everyday spoken Hebrew over stilted or overly formal phrasing.
            - Preserve proper nouns and established Hebrew renderings of names/places where they exist.
            - Do NOT merge, split, reorder, add, or omit lines. Return exactly one Hebrew translation per input id.
            - Use the preceding-context lines only to stay consistent; do not translate them.
            - Output Hebrew text only — no transliteration, no notes, no romanization.

            Return ONLY a single JSON object mapping each input id (as a string) to its Hebrew translation, e.g. {"12":"…","13":"…"}. No markdown, no code fences, no extra text.
        """.trimIndent()
    }

    /** The user-turn content: preceding context plus the id/text lines to translate, as JSON. */
    fun buildUserContent(batch: Batch): String {
        val obj = buildJsonObject {
            put("context_preceding", buildJsonArray {
                batch.contextBefore.forEach { add(JsonPrimitive(it.text)) }
            })
            put("lines", buildJsonArray {
                batch.cues.forEach { cue ->
                    add(buildJsonObject {
                        put("id", cue.index)
                        put("text", cue.text)
                    })
                }
            })
        }
        return json.encodeToString(JsonObject.serializer(), obj)
    }

    /** Build the full Messages API request body as a JSON string. */
    fun buildRequestBody(
        model: String,
        system: String,
        userContent: String,
        maxTokens: Int = DEFAULT_MAX_TOKENS,
    ): String {
        val body = buildJsonObject {
            put("model", model)
            put("max_tokens", maxTokens)
            put("system", system)
            put("messages", buildJsonArray {
                add(buildJsonObject {
                    put("role", "user")
                    put("content", userContent)
                })
            })
        }
        return json.encodeToString(JsonObject.serializer(), body)
    }

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
        val jsonSlice = extractJsonObject(modelText) ?: return emptyMap()
        val obj = try {
            json.parseToJsonElement(jsonSlice).jsonObject
        } catch (_: Exception) {
            return emptyMap()
        }
        val result = LinkedHashMap<Int, String>()
        for ((key, value) in obj) {
            val id = key.toIntOrNull() ?: continue
            val text = value.jsonPrimitive.contentOrNull ?: continue
            result[id] = text
        }
        return result
    }

    /** Apply id→translation onto cues, keeping timing. Untranslated cues are kept as-is. */
    fun applyTranslations(cues: List<SubtitleCue>, translations: Map<Int, String>): List<SubtitleCue> =
        cues.map { cue -> translations[cue.index]?.let { cue.withText(it) } ?: cue }

    /** Extract the outermost {...} block from arbitrary text (handles code fences / preamble). */
    private fun extractJsonObject(text: String): String? {
        val start = text.indexOf('{')
        val end = text.lastIndexOf('}')
        if (start < 0 || end <= start) return null
        return text.substring(start, end + 1)
    }
}
