package com.hebsub.core.net

import java.net.URI

/**
 * Validates user-supplied video URLs before the app downloads them.
 *
 * Two jobs:
 *  1. UX — reject obvious garbage early with a clear reason.
 *  2. Safety/privacy — refuse non-HTTP schemes and addresses that point back at
 *     the local machine or private networks (loopback, link-local, RFC-1918,
 *     CGNAT, IPv6 ULA/loopback). This prevents the "download a URL" feature from
 *     being turned into a probe of the device's own network.
 */
object UrlValidator {

    sealed interface Result {
        data class Valid(val normalized: String, val suggestedFileName: String) : Result
        data class Invalid(val reason: Reason) : Result
    }

    enum class Reason {
        BLANK,
        BAD_SYNTAX,
        UNSUPPORTED_SCHEME,
        MISSING_HOST,
        PRIVATE_OR_LOCAL_HOST,
    }

    fun validate(raw: String): Result {
        val input = raw.trim()
        if (input.isEmpty()) return Result.Invalid(Reason.BLANK)

        val uri = try {
            URI(input)
        } catch (_: Exception) {
            return Result.Invalid(Reason.BAD_SYNTAX)
        }

        val scheme = uri.scheme?.lowercase()
        if (scheme != "http" && scheme != "https") {
            return Result.Invalid(Reason.UNSUPPORTED_SCHEME)
        }

        val host = uri.host ?: return Result.Invalid(Reason.MISSING_HOST)
        if (isLocalOrPrivate(host)) {
            return Result.Invalid(Reason.PRIVATE_OR_LOCAL_HOST)
        }

        return Result.Valid(
            normalized = uri.toString(),
            suggestedFileName = fileNameFrom(uri),
        )
    }

    fun fileNameFrom(uri: URI): String {
        val path = uri.path.orEmpty()
        val last = path.substringAfterLast('/', "").substringBefore('?').substringBefore('#')
        val decoded = try {
            java.net.URLDecoder.decode(last, Charsets.UTF_8)
        } catch (_: Exception) {
            last
        }
        val cleaned = decoded.filter { it.isLetterOrDigit() || it in "._- ()[]" }.trim()
        return cleaned.ifBlank { "video_${System.currentTimeMillis() / 1000}.mp4" }
    }

    private fun isLocalOrPrivate(hostRaw: String): Boolean {
        val host = hostRaw.trim('[', ']').lowercase()
        if (host == "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true

        // IPv4 literal checks.
        val v4 = host.split('.')
        if (v4.size == 4 && v4.all { it.toIntOrNull() in 0..255 }) {
            val (a, b) = v4[0].toInt() to v4[1].toInt()
            return when {
                a == 10 -> true                              // 10.0.0.0/8
                a == 127 -> true                             // loopback
                a == 0 -> true                               // 0.0.0.0/8
                a == 169 && b == 254 -> true                 // link-local
                a == 172 && b in 16..31 -> true              // 172.16.0.0/12
                a == 192 && b == 168 -> true                 // 192.168.0.0/16
                a == 100 && b in 64..127 -> true             // CGNAT 100.64.0.0/10
                else -> false
            }
        }

        // IPv6 literal checks (loopback and unique-local / link-local).
        if (host.contains(':')) {
            if (host == "::1" || host == "::") return true
            if (host.startsWith("fc") || host.startsWith("fd")) return true // fc00::/7 ULA
            if (host.startsWith("fe80")) return true                        // link-local
        }
        return false
    }
}
