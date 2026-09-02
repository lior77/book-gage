package com.hebsub.app.translate

import com.hebsub.app.log.RunLog
import com.hebsub.app.net.PrivacyHttp
import com.hebsub.core.provider.claude.ClaudeApi
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject

/**
 * One-off, context-aware translation of a free-text paragraph (e.g. a movie plot)
 * to Hebrew via the Anthropic Messages API. Returns null on any failure so the
 * caller can fall back to the original text.
 */
object ClaudeText {

    suspend fun toHebrew(apiKey: String, model: String, text: String): String? = withContext(Dispatchers.IO) {
        if (apiKey.isBlank() || text.isBlank()) return@withContext null
        val system = "You are a professional translator. Translate the user's movie synopsis into natural, fluent Hebrew. " +
            "Reflect meaning and tone, not a literal word-for-word rendering. Output ONLY the Hebrew translation, no preamble."
        val payload = JSONObject()
            .put("model", model)
            .put("max_tokens", 1024)
            .put("system", system)
            .put("messages", JSONArray().put(JSONObject().put("role", "user").put("content", text)))
            .toString()
        val req = Request.Builder()
            .url(ClaudeApi.ENDPOINT)
            .header(ClaudeApi.HEADER_API_KEY, apiKey)
            .header(ClaudeApi.HEADER_VERSION, ClaudeApi.VERSION)
            .header("content-type", "application/json")
            .post(payload.toRequestBody("application/json".toMediaType()))
            .build()
        runCatching {
            PrivacyHttp.client.newCall(req).execute().use { resp ->
                if (!resp.isSuccessful) { RunLog.error("ClaudeText HTTP ${resp.code}"); return@withContext null }
                val json = JSONObject(resp.body?.string().orEmpty())
                val content = json.optJSONArray("content") ?: return@withContext null
                buildString {
                    for (i in 0 until content.length()) {
                        val part = content.optJSONObject(i) ?: continue
                        if (part.optString("type") == "text") append(part.optString("text"))
                    }
                }.trim().ifBlank { null }
            }
        }.getOrElse { RunLog.error("ClaudeText failed", it); null }
    }
}
