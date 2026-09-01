package com.hebsub.app.pipeline

/** User's runtime translation decision (spec §7). */
enum class TranslationChoice { LOCAL, CLOUD, STOP }

/** Final output decision (spec §8): a subtitle sidecar, or a new media file with the track embedded. */
enum class OutputChoice { SAVE_SRT, EMBED_MEDIA }

/**
 * What the user confirms before the folder is created (spec §2): the (editable)
 * name, an optional year, and whether the film has burned-in foreign subtitles
 * that the Hebrew track should cover with a gray plate ([hideBurnedIn]).
 */
data class VideoInfo(val name: String, val year: String?, val hideBurnedIn: Boolean = false)

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
