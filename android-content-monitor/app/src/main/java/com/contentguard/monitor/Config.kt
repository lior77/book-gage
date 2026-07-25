package com.contentguard.monitor

/**
 * Central configuration for the monitoring data source.
 *
 * The app cannot "search the whole internet" on its own — it queries a search
 * service that has already indexed the public web. Google Programmable Search
 * (Custom Search JSON API) is that service here.
 *
 * How to enable real monitoring (free tier: 100 queries/day):
 *   1. Create a Programmable Search Engine at https://programmablesearchengine.google.com
 *      and set it to search the entire web. Copy its Search engine ID (cx).
 *   2. Enable the "Custom Search API" in Google Cloud and create an API key:
 *      https://developers.google.com/custom-search/v1/overview
 *   3. Paste both values below.
 *
 * Leave either value blank to run in clearly-labelled DEMO mode. Demo mode does
 * NOT fabricate findings — it returns an empty result set and tells the user no
 * data source is configured.
 */
object Config {
    const val GOOGLE_API_KEY: String = ""
    const val GOOGLE_SEARCH_ENGINE_ID: String = "" // the "cx" value

    /** Whether a real data source is configured. */
    val hasDataSource: Boolean
        get() = GOOGLE_API_KEY.isNotBlank() && GOOGLE_SEARCH_ENGINE_ID.isNotBlank()

    /** Max result pages to fetch (Google returns 10 per page; caps daily quota use). */
    const val MAX_PAGES: Int = 5
}
