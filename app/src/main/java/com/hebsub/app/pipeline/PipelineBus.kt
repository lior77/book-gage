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

    private var translationDecision: CompletableDeferred<TranslationChoice>? = null
    private var asrDecision: CompletableDeferred<Boolean>? = null

    fun update(state: PipelineState) { _state.value = state }

    fun reset() {
        translationDecision = null
        asrDecision = null
        _state.value = PipelineState.Idle
    }

    suspend fun awaitTranslationChoice(cloudAvailable: Boolean): TranslationChoice {
        val deferred = CompletableDeferred<TranslationChoice>()
        translationDecision = deferred
        _state.value = PipelineState.NeedTranslationChoice(cloudAvailable)
        return deferred.await()
    }

    fun submitTranslationChoice(choice: TranslationChoice) {
        translationDecision?.complete(choice)
        translationDecision = null
    }

    suspend fun awaitAsrConsent(asrAvailable: Boolean): Boolean {
        val deferred = CompletableDeferred<Boolean>()
        asrDecision = deferred
        _state.value = PipelineState.NeedAsrConsent(asrAvailable)
        return deferred.await()
    }

    fun submitAsrConsent(consent: Boolean) {
        asrDecision?.complete(consent)
        asrDecision = null
    }
}
