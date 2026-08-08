package com.hebsub.core.provider.opensubtitles

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * Minimal DTOs for the OpenSubtitles REST API v1 `/subtitles` search response.
 * Only the fields the app actually uses are declared; unknown keys are ignored
 * by the parser so the API can evolve without breaking us.
 *
 * Docs: https://opensubtitles.stoplight.io/docs/opensubtitles-api
 */
@Serializable
data class OsSearchResponse(
    val data: List<OsData> = emptyList(),
    @SerialName("total_count") val totalCount: Int = 0,
)

@Serializable
data class OsData(
    val id: String = "",
    val attributes: OsAttributes = OsAttributes(),
)

@Serializable
data class OsAttributes(
    val language: String? = null,
    @SerialName("download_count") val downloadCount: Int = 0,
    @SerialName("hearing_impaired") val hearingImpaired: Boolean = false,
    @SerialName("machine_translated") val machineTranslated: Boolean = false,
    @SerialName("from_trusted") val fromTrusted: Boolean = false,
    val release: String? = null,
    val ratings: Double = 0.0,
    val files: List<OsFile> = emptyList(),
)

@Serializable
data class OsFile(
    @SerialName("file_id") val fileId: Long = 0,
    @SerialName("file_name") val fileName: String? = null,
)

/** A flattened, ranked candidate the picker returns to the app to download. */
data class OsCandidate(
    val fileId: Long,
    val language: String?,
    val downloadCount: Int,
    val hearingImpaired: Boolean,
    val machineTranslated: Boolean,
    val fromTrusted: Boolean,
    val release: String?,
)
