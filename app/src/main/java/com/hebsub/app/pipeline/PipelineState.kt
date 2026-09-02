package com.hebsub.app.pipeline

/** User's runtime translation decision (spec §7). */
enum class TranslationChoice { LOCAL, CLOUD, STOP }

/** Final output decision (spec §8): a subtitle sidecar, or a new media file with the track embedded. */
enum class OutputChoice { SAVE_SRT, EMBED_MEDIA }

/**
 * What the user confirms in the pre-processing dialog:
 *  - [name]/[year]: editable, default from the file name.
 *  - [imdbUrl]: optional IMDb link; when set, movie data is pulled from OMDb,
 *    embedded into the MKV, and written to a bilingual PDF (spec §2).
 *  - [subtitlePath]: an optional local subtitle the user picked to attach as-is (§4).
 *  - [bgTransparency]: subtitle background plate transparency, 0 = opaque (hides
 *    burned-in subs), 100 = no plate (§1.5).
 *  - [deleteData]: when true, intermediate files are deleted at the end, keeping
 *    only the MKV and the PDF (§1.6/§5).
 */
data class VideoInfo(
    val name: String,
    val year: String?,
    val imdbUrl: String? = null,
    val subtitlePath: String? = null,
    val bgTransparency: Int = 100,
    val deleteData: Boolean = true,
)

/** Everything the UI needs to render, driven by the pipeline running in the service. */
sealed interface PipelineState {
    data object Idle : PipelineState

    /** [progress] is 0f..1f, or null for an indeterminate stage. */
    data class Running(val stageLabel: String, val progress: Float?) : PipelineState

    /** Before creating the folder: confirm/edit the name and optionally enter the year (spec §2). */
    data class NeedVideoInfo(val suggestedName: String) : PipelineState

    /** No ready-made Hebrew found; ask how to translate. [cloudAvailable] gates the cloud option. */
    data class NeedTranslationChoice(val cloudAvailable: Boolean) : PipelineState

    /** No subtitles found anywhere; ask whether to transcribe the audio. */
    data class NeedAsrConsent(val asrAvailable: Boolean) : PipelineState

    /** Hebrew is ready; ask how to deliver it. [embedMediaAvailable] gates the embed option. */
    data class NeedOutputChoice(val embedMediaAvailable: Boolean) : PipelineState

    /** Hebrew subtitles written. [folder] is the video's HebSub folder, [srtName] the Hebrew .srt,
     *  [mediaName] the new MKV with the embedded Hebrew track (null if not created). */
    data class Success(val folder: String, val srtName: String, val mediaName: String? = null) : PipelineState

    data class Failed(val message: String) : PipelineState
}
