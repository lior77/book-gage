package com.hebsub.app.pipeline

/** User's runtime translation decision (spec §3). */
enum class TranslationChoice { LOCAL, CLOUD, STOP }

/** Everything the UI needs to render, driven by the pipeline running in the service. */
sealed interface PipelineState {
    data object Idle : PipelineState

    /** [progress] is 0f..1f, or null for an indeterminate stage. */
    data class Running(val stageLabel: String, val progress: Float?) : PipelineState

    /** No ready-made Hebrew found; ask how to translate. [cloudAvailable] gates the cloud option. */
    data class NeedTranslationChoice(val cloudAvailable: Boolean) : PipelineState

    /** No subtitles found anywhere; ask whether to transcribe the audio. */
    data class NeedAsrConsent(val asrAvailable: Boolean) : PipelineState

    data class Success(val videoName: String, val srtName: String, val muxed: Boolean) : PipelineState

    data class Failed(val message: String) : PipelineState
}
