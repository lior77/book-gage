package com.hebsub.app.net

import com.hebsub.app.log.RunLog
import com.hebsub.core.provider.claude.ClaudeApi
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject

/**
 * Lightweight "does this key actually work?" checks, run when the user saves a
 * key in Settings. Each performs the smallest possible authenticated request to
 * the service and reports a human-readable Hebrew result, so the user gets an
 * immediate indication of success or the exact reason for failure.
 *
 * Every step is written to [RunLog] (all actions are logged). Privacy (spec
 * §12): only the key itself is sent, over the shared privacy-hardened client —
 * no device or user identifiers, no video/subtitle content.
 */
object ConnectionTester {

    data class Result(val ok: Boolean, val message: String)

    /** OpenSubtitles: a tiny authenticated search — 200 means the Api-Key is valid. */
    suspend fun testOpenSubtitles(apiKey: String): Result = withContext(Dispatchers.IO) {
        if (apiKey.isBlank()) return@withContext Result(false, "לא הוזן מפתח")
        RunLog.log("conn-test OpenSubtitles: start")
        val url = "https://api.opensubtitles.com/api/v1/subtitles".toHttpUrl().newBuilder()
            .addQueryParameter("query", "the matrix")
            .addQueryParameter("languages", "en")
            .build()
        val req = Request.Builder()
            .url(url)
            .header("Api-Key", apiKey)
            .header("Accept", "application/json")
            .get()
            .build()
        runCatching {
            PrivacyHttp.client.newCall(req).execute().use { resp ->
                val body = resp.body?.string().orEmpty()
                if (resp.isSuccessful) {
                    val total = runCatching { JSONObject(body).optInt("total_count", -1) }.getOrDefault(-1)
                    RunLog.log("conn-test OpenSubtitles: OK ${resp.code} total=$total")
                    Result(true, "החיבור הצליח — המפתח תקין")
                } else {
                    val msg = failureMessage("OpenSubtitles", resp.code, body)
                    RunLog.error("conn-test OpenSubtitles: $msg")
                    Result(false, msg)
                }
            }
        }.getOrElse { networkError("OpenSubtitles", it) }
    }

    /** Anthropic: a 1-token message — validates both the key and the chosen model. */
    suspend fun testAnthropic(apiKey: String, model: String): Result = withContext(Dispatchers.IO) {
        if (apiKey.isBlank()) return@withContext Result(false, "לא הוזן מפתח")
        RunLog.log("conn-test Anthropic: start model=$model")
        val payload = JSONObject()
            .put("model", model)
            .put("max_tokens", 1)
            .put("messages", JSONArray().put(JSONObject().put("role", "user").put("content", "hi")))
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
                val body = resp.body?.string().orEmpty()
                // A 200 (or even a max_tokens "stop" 200) means the key + model are good.
                if (resp.isSuccessful) {
                    RunLog.log("conn-test Anthropic: OK ${resp.code}")
                    Result(true, "החיבור הצליח — המפתח והמודל ($model) תקינים")
                } else {
                    val msg = failureMessage("Anthropic", resp.code, body)
                    RunLog.error("conn-test Anthropic: $msg")
                    Result(false, msg)
                }
            }
        }.getOrElse { networkError("Anthropic", it) }
    }

    /** Deepgram: list projects — 200 means the token is valid (no audio uploaded). */
    suspend fun testDeepgram(apiKey: String): Result = withContext(Dispatchers.IO) {
        if (apiKey.isBlank()) return@withContext Result(false, "לא הוזן מפתח")
        RunLog.log("conn-test Deepgram: start")
        val req = Request.Builder()
            .url("https://api.deepgram.com/v1/projects")
            .header("Authorization", "Token $apiKey")
            .header("Accept", "application/json")
            .get()
            .build()
        runCatching {
            PrivacyHttp.client.newCall(req).execute().use { resp ->
                val body = resp.body?.string().orEmpty()
                if (resp.isSuccessful) {
                    RunLog.log("conn-test Deepgram: OK ${resp.code}")
                    Result(true, "החיבור הצליח — המפתח תקין")
                } else {
                    val msg = failureMessage("Deepgram", resp.code, body)
                    RunLog.error("conn-test Deepgram: $msg")
                    Result(false, msg)
                }
            }
        }.getOrElse { networkError("Deepgram", it) }
    }

    /** OMDb: look up a known title — 200 with Response:True means the key works. */
    suspend fun testOmdb(apiKey: String): Result = withContext(Dispatchers.IO) {
        if (apiKey.isBlank()) return@withContext Result(false, "לא הוזן מפתח")
        RunLog.log("conn-test OMDb: start")
        val url = "https://www.omdbapi.com/".toHttpUrl().newBuilder()
            .addQueryParameter("apikey", apiKey)
            .addQueryParameter("i", "tt1375666")
            .build()
        val req = Request.Builder().url(url).header("Accept", "application/json").get().build()
        runCatching {
            PrivacyHttp.client.newCall(req).execute().use { resp ->
                val body = resp.body?.string().orEmpty()
                val trueResp = runCatching { JSONObject(body).optString("Response") }.getOrNull()
                if (resp.isSuccessful && trueResp.equals("True", ignoreCase = true)) {
                    RunLog.log("conn-test OMDb: OK ${resp.code}")
                    Result(true, "החיבור הצליח — המפתח תקין")
                } else {
                    val detail = runCatching { JSONObject(body).optString("Error") }.getOrNull()
                    val msg = if (!detail.isNullOrBlank()) "מפתח לא תקין — $detail" else failureMessage("OMDb", resp.code, body)
                    RunLog.error("conn-test OMDb: $msg")
                    Result(false, msg)
                }
            }
        }.getOrElse { networkError("OMDb", it) }
    }

    private fun failureMessage(service: String, code: Int, body: String): String {
        val base = when (code) {
            401 -> "מפתח לא תקין או לא מורשה (401)"
            403 -> "הגישה נדחתה (403)"
            404 -> "כתובת השירות לא נמצאה (404)"
            429 -> "חריגה ממכסת הבקשות (429)"
            in 500..599 -> "תקלה בשרת $service ($code)"
            else -> "השירות החזיר שגיאה (HTTP $code)"
        }
        val detail = extractError(body)
        return if (detail != null) "$base — $detail" else base
    }

    private fun networkError(service: String, t: Throwable): Result {
        val msg = "שגיאת רשת: ${t.message ?: t::class.java.simpleName}"
        RunLog.error("conn-test $service: $msg", t)
        return Result(false, msg)
    }

    /** Pull a readable reason out of the common provider error JSON shapes. */
    private fun extractError(body: String): String? {
        if (body.isBlank()) return null
        return runCatching {
            val json = JSONObject(body)
            json.optJSONObject("error")?.optString("message")?.takeIf { it.isNotBlank() }
                ?: json.optString("message").takeIf { it.isNotBlank() }
                ?: json.optString("err_msg").takeIf { it.isNotBlank() }
                ?: json.optJSONArray("errors")
                    ?.let { arr -> (0 until arr.length()).joinToString("; ") { arr.optString(it) } }
                    ?.takeIf { it.isNotBlank() }
        }.getOrNull()?.take(160)
    }
}
