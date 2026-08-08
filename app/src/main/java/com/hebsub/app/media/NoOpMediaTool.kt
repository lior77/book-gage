package com.hebsub.app.media

import java.io.File

/**
 * Default [MediaTool] for the FFmpeg-free build. It performs no container work,
 * so the pipeline relies on online subtitles (and, when added, ASR) and always
 * publishes the translated Hebrew `.srt` sidecar. Building the `withFfmpeg`
 * variant swaps in [FfmpegMediaTool], which adds probing, embedded-track
 * extraction, and lossless MKV remuxing.
 */
class NoOpMediaTool : MediaTool {
    override val canEmbed = false

    override suspend fun probe(input: File): MediaProbe =
        MediaProbe(embeddedSubtitles = emptyList(), audioLanguage = null, durationMs = 0)

    override suspend fun extractSubtitle(input: File, streamIndex: Int, outSrt: File): Boolean = false

    override suspend fun extractAudioForAsr(input: File, outWav: File): Boolean = false

    override suspend fun remuxWithHebrew(
        input: File,
        srt: File,
        existingSubtitleCount: Int,
        outMkv: File,
    ): Boolean = false
}
