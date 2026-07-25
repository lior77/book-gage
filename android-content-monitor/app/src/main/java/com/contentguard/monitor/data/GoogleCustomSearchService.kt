package com.contentguard.monitor.data

import com.contentguard.monitor.Config
import com.contentguard.monitor.model.VideoFinding
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone

/**
 * Real monitoring source backed by Google Programmable Search (Custom Search JSON API).
 *
 * This is the closest thing to "search the whole public web": queries run against
 * Google's index of the internet, biased toward video results. For each hit we try
 * to read the hosting page's video metadata to recover the clip's duration.
 */
class GoogleCustomSearchService : MonitorService {

    override val name: String = "Google Programmable Search"

    override val isLive: Boolean get() = Config.hasDataSource

    override suspend fun search(handle: String): SearchOutcome = withContext(Dispatchers.IO) {
        val normalized = handle.trim().removePrefix("@")
        // Queries biased toward leaked video content.
        val queries = listOf(
            "\"$normalized\" video leak OR leaked",
            "\"@$normalized\" video mega OR onlyfans OR leaked"
        )

        val videos = LinkedHashMap<String, VideoFinding>() // de-dupe by URL, preserve order
        val issued = mutableListOf<String>()

        for (q in queries) {
            issued.add(q)
            var start = 1
            var page = 0
            while (page < Config.MAX_PAGES) {
                val json = requestPage(q, start) ?: break
                val items = json.optJSONArray("items") ?: break
                for (i in 0 until items.length()) {
                    val item = items.getJSONObject(i)
                    val link = item.optString("link").ifBlank { continue }
                    if (videos.containsKey(link)) continue
                    videos[link] = item.toVideoFinding()
                }
                val nextStart = json.optJSONObject("queries")
                    ?.optJSONArray("nextPage")
                    ?.optJSONObject(0)
                    ?.optInt("startIndex", -1) ?: -1
                if (nextStart <= 0) break
                start = nextStart
                page++
            }
        }

        SearchOutcome(
            videos = videos.values.toList(),
            queries = issued,
            note = "Video results from Google's public web index, limited to the trailing 12 months. " +
                "Duration is read from page metadata when available; many sites do not expose it."
        )
    }

    private fun requestPage(query: String, start: Int): JSONObject? {
        val url = buildString {
            append("https://www.googleapis.com/customsearch/v1")
            append("?key=").append(enc(Config.GOOGLE_API_KEY))
            append("&cx=").append(enc(Config.GOOGLE_SEARCH_ENGINE_ID))
            append("&q=").append(enc(query))
            append("&num=10")
            append("&start=").append(start)
            append("&dateRestrict=y1") // last 12 months
            append("&sort=date")
        }
        val conn = (URL(url).openConnection() as HttpURLConnection).apply {
            requestMethod = "GET"
            connectTimeout = 15000
            readTimeout = 20000
        }
        return try {
            val code = conn.responseCode
            val stream = if (code in 200..299) conn.inputStream else conn.errorStream
            val body = stream?.bufferedReader()?.use { it.readText() } ?: return null
            if (code !in 200..299) return null
            JSONObject(body)
        } catch (e: Exception) {
            null
        } finally {
            conn.disconnect()
        }
    }

    private fun JSONObject.toVideoFinding(): VideoFinding {
        val link = optString("link")
        val title = optString("title")
        val displayLink = optString("displayLink")
        val pagemap = optJSONObject("pagemap")

        return VideoFinding(
            url = link,
            siteName = displayLink.ifBlank { hostOf(link) },
            title = title,
            durationSeconds = extractDuration(pagemap),
            detectedAt = extractDate(pagemap),
            source = name
        )
    }

    /** Read duration from schema.org VideoObject or Open Graph video metadata. */
    private fun extractDuration(pagemap: JSONObject?): Long? {
        if (pagemap == null) return null

        // schema.org VideoObject.duration is ISO-8601, e.g. "PT12M4S".
        pagemap.optJSONArray("videoobject")?.optJSONObject(0)?.let { vo ->
            parseIso8601Duration(vo.optString("duration"))?.let { return it }
            // Some pages put seconds directly.
            vo.optString("duration").toLongOrNull()?.let { return it }
        }

        // Open Graph: og:video:duration is seconds.
        pagemap.optJSONArray("metatags")?.optJSONObject(0)?.let { meta ->
            meta.optString("og:video:duration").toLongOrNull()?.let { return it }
            parseIso8601Duration(meta.optString("video:duration"))?.let { return it }
            meta.optString("video:duration").toLongOrNull()?.let { return it }
        }
        return null
    }

    /** Parse ISO-8601 durations like "PT1H2M3S" / "PT12M4S" / "PT45S" into seconds. */
    private fun parseIso8601Duration(raw: String?): Long? {
        if (raw.isNullOrBlank() || !raw.startsWith("PT")) return null
        val regex = Regex("PT(?:(\\d+)H)?(?:(\\d+)M)?(?:(\\d+)S)?")
        val m = regex.matchEntire(raw) ?: return null
        val h = m.groupValues[1].toLongOrNull() ?: 0
        val min = m.groupValues[2].toLongOrNull() ?: 0
        val s = m.groupValues[3].toLongOrNull() ?: 0
        val total = h * 3600 + min * 60 + s
        return if (total > 0) total else null
    }

    private fun extractDate(pagemap: JSONObject?): Long? {
        if (pagemap == null) return null
        val metatags = pagemap.optJSONArray("metatags")?.optJSONObject(0)
        val candidates = listOf(
            pagemap.optJSONArray("videoobject")?.optJSONObject(0)?.optString("uploaddate"),
            metatags?.optString("article:published_time"),
            metatags?.optString("og:updated_time"),
            metatags?.optString("date")
        )
        for (raw in candidates) {
            parseDate(raw)?.let { return it }
        }
        return null
    }

    private fun parseDate(raw: String?): Long? {
        if (raw.isNullOrBlank()) return null
        val patterns = listOf(
            "yyyy-MM-dd'T'HH:mm:ssXXX",
            "yyyy-MM-dd'T'HH:mm:ss'Z'",
            "yyyy-MM-dd'T'HH:mm:ss",
            "yyyy-MM-dd"
        )
        for (p in patterns) {
            try {
                val fmt = SimpleDateFormat(p, Locale.US)
                fmt.timeZone = TimeZone.getTimeZone("UTC")
                return fmt.parse(raw)?.time
            } catch (_: Exception) {
            }
        }
        return null
    }

    private fun hostOf(url: String): String = try {
        URL(url).host
    } catch (_: Exception) {
        url
    }

    private fun enc(s: String): String = URLEncoder.encode(s, "UTF-8")
}
