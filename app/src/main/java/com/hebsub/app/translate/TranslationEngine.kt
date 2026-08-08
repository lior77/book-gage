package com.hebsub.app.translate

import com.hebsub.core.subtitle.SubtitleCue

/** Translates source-language cues to Hebrew, keeping indices and timing intact. */
interface TranslationEngine {
    /**
     * @param sourceLang canonical source language code, or null if unknown.
     * @param onProgress called with (done, total) cue counts.
     */
    suspend fun translate(
        cues: List<SubtitleCue>,
        sourceLang: String?,
        onProgress: (Int, Int) -> Unit,
    ): List<SubtitleCue>
}
