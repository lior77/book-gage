package com.hebsub.app.asr

import com.hebsub.core.subtitle.SubtitleTrack
import java.io.File

class AsrUnavailableException(message: String) : Exception(message)

/**
 * On-device speech-to-text. Produces a source-language subtitle track from an
 * audio file; the pipeline then translates it to Hebrew. Used only as a last
 * resort when no subtitles are found and the user consents (spec §2c).
 */
interface AsrEngine {
    val available: Boolean
    suspend fun transcribe(wav: File, onProgress: (Float) -> Unit): SubtitleTrack
}

/**
 * Default engine for v1: reports unavailable. Wiring whisper.cpp requires a
 * native `.so` plus a bundled GGML model (see README → "Native dependencies").
 * Swap this for [com.hebsub.app.asr.WhisperAsrEngine] once those are added.
 */
class UnavailableAsrEngine : AsrEngine {
    override val available = false
    override suspend fun transcribe(wav: File, onProgress: (Float) -> Unit): SubtitleTrack =
        throw AsrUnavailableException("On-device transcription is not bundled in this build.")
}
