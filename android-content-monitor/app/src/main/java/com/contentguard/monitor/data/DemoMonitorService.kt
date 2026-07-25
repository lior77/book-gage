package com.contentguard.monitor.data

/**
 * Fallback used when no data source is configured.
 *
 * It deliberately returns NO videos. The point of this project is not to invent
 * authoritative-looking results — so in demo mode the app is honest: it says
 * "no data source configured" rather than fabricating leaked clips and durations.
 */
class DemoMonitorService : MonitorService {
    override val name: String = "Demo (no data source configured)"
    override val isLive: Boolean = false

    override suspend fun search(handle: String): SearchOutcome {
        return SearchOutcome(
            videos = emptyList(),
            queries = listOf("(no queries issued — demo mode)"),
            note = "No data source is configured, so no web search was performed. " +
                "Add a Google Programmable Search key and engine ID in Config.kt to enable real monitoring."
        )
    }
}
