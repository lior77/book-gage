package com.hebsub.app.pipeline

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Single source of truth shared between the pipeline (running in the foreground
 * service) and the UI. The UI observes [state]; when the pipeline needs a
 * decision it suspends on an awaitable and the UI fulfils it via submit*().
 */
object PipelineBus {

    private val _state = MutableStateFlow<PipelineState>(PipelineState.Idle)
    val state = _state.asStateFlow()

    private var videoInfoDecision: CompletableDeferred<VideoInfo>? = null

    fun update(state: PipelineState) { _state.value = state }

    fun reset() {
        videoInfoDecision = null
        _state.value = PipelineState.Idle
    }

    suspend fun awaitVideoInfo(suggestedName: String): VideoInfo {
        val deferred = CompletableDeferred<VideoInfo>()
        videoInfoDecision = deferred
        _state.value = PipelineState.NeedVideoInfo(suggestedName)
        return deferred.await()
    }

    fun submitVideoInfo(info: VideoInfo) {
        videoInfoDecision?.complete(info)
        videoInfoDecision = null
    }
}
