package com.contentguard.monitor.data

import com.contentguard.monitor.Config
import com.contentguard.monitor.model.MonitorReport

/**
 * Chooses the live service when configured, otherwise the honest demo service,
 * then turns raw video findings into the summary the UI presents.
 */
class MonitorRepository(
    private val service: MonitorService =
        if (Config.hasDataSource) GoogleCustomSearchService() else DemoMonitorService()
) {

    suspend fun run(handle: String, now: Long): MonitorReport {
        val outcome = service.search(handle)
        val videos = outcome.videos
        val cutoff = now - 365L * 24 * 60 * 60 * 1000

        val last12 = videos.count { it.detectedAt != null && it.detectedAt >= cutoff }
        val withDuration = videos.count { it.durationSeconds != null }

        // Newest first; unknown-date items sink to the bottom.
        val sorted = videos.sortedByDescending { it.detectedAt ?: Long.MIN_VALUE }

        return MonitorReport(
            handle = handle.trim(),
            generatedAt = now,
            dataSourceName = service.name,
            isDemo = !service.isLive,
            videos = sorted,
            totalVideos = videos.size,
            videosLast12Months = last12,
            withKnownDuration = withDuration,
            queriesUsed = outcome.queries,
            notes = outcome.note
        )
    }
}
