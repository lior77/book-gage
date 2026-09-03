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

    /**
     * Live status of the six-step search for a subtitle source, shown on the
     * progress screen so the user can see which step is being tried and how each
     * earlier one ended, instead of only a single stage label.
     */
    private val _steps = MutableStateFlow(SourceStep.entries.map { SourceStepState(it) })
    val steps = _steps.asStateFlow()

    private var videoInfoDecision: CompletableDeferred<VideoInfo?>? = null

    fun update(state: PipelineState) { _state.value = state }

    /** Mark one source step, leaving the others as they are. */
    fun step(step: SourceStep, status: StepStatus, detail: String? = null) {
        _steps.value = _steps.value.map {
            if (it.step == step) SourceStepState(step, status, detail) else it
        }
    }

    /**
     * The run settled on [step]: it is marked as used, and every step below it is
     * marked skipped, since the search stops at the first source that yields cues.
     */
    fun stepUsed(step: SourceStep, detail: String?) {
        val chosen = step.ordinal
        _steps.value = _steps.value.map {
            when {
                it.step == step -> SourceStepState(step, StepStatus.Used, detail)
                it.step.ordinal > chosen -> SourceStepState(it.step, StepStatus.Skipped, "לא נדרש")
                else -> it
            }
        }
    }

    fun resetSteps() {
        _steps.value = SourceStep.entries.map { SourceStepState(it) }
    }

    fun reset() {
        videoInfoDecision = null
        resetSteps()
        _state.value = PipelineState.Idle
    }

    /** Null when the user backed out instead of confirming (§5 — every screen has a way out). */
    suspend fun awaitVideoInfo(suggestedName: String): VideoInfo? {
        val deferred = CompletableDeferred<VideoInfo?>()
        videoInfoDecision = deferred
        _state.value = PipelineState.NeedVideoInfo(suggestedName)
        return deferred.await()
    }

    fun submitVideoInfo(info: VideoInfo) {
        videoInfoDecision?.complete(info)
        videoInfoDecision = null
    }

    /** The user closed the pre-run screen: the run never starts. */
    fun cancelVideoInfo() {
        videoInfoDecision?.complete(null)
        videoInfoDecision = null
    }
}
