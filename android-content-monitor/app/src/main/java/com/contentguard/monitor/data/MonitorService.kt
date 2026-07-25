package com.contentguard.monitor.data

import com.contentguard.monitor.model.VideoFinding

/**
 * A pluggable source of monitoring data. Implementations do the real web work and
 * return raw video findings; statistics are computed on top of these by the repository.
 */
interface MonitorService {
    val name: String

    /** Whether this service can actually query a live source right now. */
    val isLive: Boolean

    /**
     * Return candidate leaked videos for [handle] on the public web, together with
     * the exact query strings that were issued (for transparency).
     */
    suspend fun search(handle: String): SearchOutcome
}

/** Raw output of a service run: video findings plus the queries that produced them. */
data class SearchOutcome(
    val videos: List<VideoFinding>,
    val queries: List<String>,
    val note: String = ""
)
