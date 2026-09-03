package com.hebsub.app.media

import com.hebsub.core.pipeline.EmbeddedSubtitle
import java.io.File

/** What ffprobe told us about the container. */
data class MediaProbe(
    val embeddedSubtitles: List<EmbeddedSubtitle>,
    val audioLanguage: String?,
    val durationMs: Long,
) {
    val subtitleCount: Int get() = embeddedSubtitles.size
}

/**
 * Container operations needed by the pipeline. Backed by FFmpeg so we can remux
 * a selectable Hebrew subtitle track into a new MKV **without re-encoding**
 * (fast, lossless — spec §5/§6 and the chosen MKV output format).
 */
interface MediaTool {
    /** True when this tool can create a new media file with an embedded subtitle track (spec §8). */
    val canEmbed: Boolean

    suspend fun probe(input: File): MediaProbe

    /** Extract embedded subtitle [streamIndex] to a UTF-8 SRT file. */
    suspend fun extractSubtitle(input: File, streamIndex: Int, outSrt: File): Boolean

    /**
     * Extract the first subtitle track VERBATIM (`-c:s copy`), so an ASS track
     * keeps its styling instead of being flattened to SRT. Used by the style
     * editor to read back a track it is about to restyle.
     */
    suspend fun extractSubtitleRaw(input: File, out: File): Boolean

    /**
     * Rebuild [inputMkv] with its subtitle track replaced by [sub], copying video
     * and audio untouched. [font] and [poster] are re-attached explicitly (with
     * their mimetypes) rather than copied through from the source, because an
     * attachment that survives without a usable mimetype leaves libass with no
     * Hebrew glyphs — and the subtitles then render as nothing at all.
     */
    suspend fun replaceSubtitleTrack(
        inputMkv: File,
        sub: File,
        outMkv: File,
        title: String,
        font: File?,
        poster: File?,
    ): Boolean

    /** Extract mono 16 kHz PCM WAV for on-device ASR. */
    suspend fun extractAudioForAsr(input: File, outWav: File): Boolean

    /**
     * Copy [input] to [outMkv] adding the Hebrew [srt] as a selectable track,
     * marked with language `heb`. [existingSubtitleCount] positions the metadata
     * on the newly added track. Streams are copied, never re-encoded.
     */
    suspend fun remuxWithHebrew(input: File, srt: File, existingSubtitleCount: Int, outMkv: File): Boolean

    /**
     * Like [remuxWithHebrew], plus writes global [metadata] tags (title, year,
     * Hebrew description, …) and attaches [poster] as MKV cover art. Used for the
     * IMDb-enriched output (spec §2).
     *
     * [sub] is the Hebrew track — a styled ASS or a plain SRT, whichever the user
     * asked for — copied with `-c:s copy` (no re-encode; the video and audio are
     * always copied losslessly). The container is read back with ffprobe afterwards
     * to confirm the Hebrew track is really present.
     *
     * [font] (when the track is a styled ASS) is embedded as an MKV font attachment
     * so the player's ASS renderer (libass) has real Hebrew glyphs and does not fall
     * back to a font that renders Hebrew as boxes — or, worse, as nothing at all.
     */
    suspend fun remuxWithHebrewAndMeta(
        input: File,
        sub: File,
        existingSubtitleCount: Int,
        outMkv: File,
        metadata: Map<String, String>,
        poster: File?,
        font: File?,
    ): Boolean
}
