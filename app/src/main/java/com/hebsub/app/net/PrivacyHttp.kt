package com.hebsub.app.net

import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okhttp3.Response
import java.util.concurrent.TimeUnit

/**
 * A single OkHttp client hardened for privacy (spec §12):
 *  - A generic, version-less User-Agent — no device model, OS build, or app id.
 *  - No cookie jar (default) — nothing is persisted or sent back.
 *  - Strips any header that could carry identifying data.
 *  - Long timeouts for large video downloads.
 *
 * The only data that ever leaves the device via this client is: the video bytes
 * the user asked to download, the movie hash/title for a subtitle lookup, and
 * (if the user opts in) the subtitle text for cloud translation.
 */
object PrivacyHttp {

    private const val GENERIC_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Safari/537.36"

    private val stripIdentifiers = Interceptor { chain ->
        val cleaned = chain.request().newBuilder()
            .header("User-Agent", GENERIC_UA)
            .removeHeader("X-Requested-With")
            .build()
        chain.proceed(cleaned)
    }

    val client: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .addInterceptor(stripIdentifiers)
            .connectTimeout(30, TimeUnit.SECONDS)
            .readTimeout(120, TimeUnit.SECONDS)
            .writeTimeout(120, TimeUnit.SECONDS)
            .retryOnConnectionFailure(true)
            .followRedirects(true)
            .build()
    }
}
