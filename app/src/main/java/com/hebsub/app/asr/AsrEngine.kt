package com.hebsub.app.asr

import com.hebsub.core.speech.SpeechWord
import java.io.File

class AsrUnavailableException(message: String) : Exception(message)

/** What one recognition request produced. Times are relative to the start of the audio sent. */
data class AsrResult(
    val words: List<SpeechWord>,
    /** The language the service detected, when it was asked to detect one. */
    val detectedLanguage: String?,
    /** The model that actually answered — may differ from the one asked for after a fallback. */
    val model: String,
    /** The service's raw reply, kept for diagnosis. */
    val rawJson: String,
)

/**
 * Cloud speech-to-text over one piece of audio. The pipeline decides how to cut
 * the film up, which language to declare and what to do with gaps; the engine
 * only turns audio into timed words.
 */
interface AsrEngine {
    val available: Boolean

    /**
     * @param language explicit language code to declare, or null to ask the
     *   service to detect it (only sensible on the first piece of a film).
     * @param model the model to ask for; an engine may fall back to an older one
     *   when the service rejects it, and reports which one answered.
     */
    suspend fun transcribe(audio: File, language: String?, model: String): AsrResult
}

/** Engine for a build with no speech-to-text key: reports unavailable. */
class UnavailableAsrEngine : AsrEngine {
    override val available = false
    override suspend fun transcribe(audio: File, language: String?, model: String): AsrResult =
        throw AsrUnavailableException("Speech recognition is not configured.")
}
