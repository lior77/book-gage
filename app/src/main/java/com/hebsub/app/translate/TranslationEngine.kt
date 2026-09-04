package com.hebsub.app.translate

import com.hebsub.core.subtitle.SubtitleCue

/** Translates source-language cues to Hebrew, keeping indices and timing intact. */
interface TranslationEngine {
    /**
     * @param sourceLang canonical source language code, or null if unknown.
     * @param onProgress called with (done, total) cue counts.
     * @param machineTranscript true when [cues] came from speech recognition rather
     *   than a written subtitle — words may be misheard and punctuation partial, and
     *   a translator that knows this reads for the scene instead of the letter.
     */
    suspend fun translate(
        cues: List<SubtitleCue>,
        sourceLang: String?,
        machineTranscript: Boolean = false,
        onProgress: (Int, Int) -> Unit,
    ): List<SubtitleCue>
}
