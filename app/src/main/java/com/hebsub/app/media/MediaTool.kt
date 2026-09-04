package com.hebsub.app.media

import java.io.File

/** A subtitle stream the container already carries. */
data class EmbeddedSubtitle(
    /** Stream index within the container, as ffmpeg's `-map 0:<index>` wants it. */
    val index: Int,
    /** The stream's declared language tag, or null when it has none. */
    val language: String?,
)

/** What ffprobe told us about the container. */
data class MediaProbe(
    val embeddedSubtitles: List<EmbeddedSubtitle>,
    val audioLanguage: String?,
    val durationMs: Long,
) {
    val subtitleCount: Int get() = embeddedSubtitles.size
}

/** The first audio stream's shape, as far as the recogniser cares. */
data class AudioLayout(
    val channels: Int,
    /** ffprobe's layout name — "stereo", "5.1", "5.1(side)", "mono" — or null. */
    val layout: String?,
)

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

    /** Extract compact mono 16 kHz AAC for ASR — the plain path, kept as the fallback. */
    suspend fun extractAudioForAsr(input: File, outWav: File): Boolean

    /** Channel count and layout of the first audio stream, or null when unknown. */
    suspend fun probeAudio(input: File): AudioLayout?

    /**
     * Extract the DIALOGUE of [input] as lossless mono 16 kHz FLAC, prepared for a
     * speech recogniser: the centre channel of a surround mix, or an enhanced
     * centre extracted from a stereo one, with quiet speech brought up to level.
     * Returns a short description of the chain that succeeded, or null when none
     * did (the caller then falls back to [extractAudioForAsr]).
     */
    suspend fun extractDialogueForAsr(input: File, out: File, layout: AudioLayout?): String?

    /**
     * Cut [fromMs, toMs) of an audio file into [out] (same sample format). With
     * [boost], a stronger enhancement is applied — noise reduction and a harder
     * speech expansion — for a second attempt on a stretch the first pass heard
     * nothing in.
     */
    suspend fun cutAudio(input: File, fromMs: Long, toMs: Long, out: File, boost: Boolean): Boolean

    /**
     * Fraction (0..1) of [fromMs, toMs) that is NOT silence, or null when it could
     * not be measured. Tells a gap with speech in it from a gap that is simply quiet.
     */
    suspend fun nonSilentFraction(input: File, fromMs: Long, toMs: Long): Double?

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

    /**
     * Spec §3.3 — write [metadata] and the [poster] cover into a copy of [input]
     * while leaving what it already contains completely alone: every stream,
     * subtitles included, is mapped and copied verbatim. Existing attachments are
     * carried over too, since this run adds data and must not cost the file its
     * embedded font.
     */
    suspend fun applyMovieData(
        input: File,
        outFile: File,
        metadata: Map<String, String>,
        poster: File?,
    ): Boolean

    /**
     * Render one frame of [video] at [atMs] with [ass] drawn onto it, so the user
     * can see a style on the actual film instead of rebuilding a whole MKV to find
     * out how it looks. [fontsDir] is where the bundled Hebrew font lives.
     *
     * Returns false when this FFmpeg build has no libass — burning subtitles in is
     * a separate feature from muxing them, and not every build carries it — so a
     * preview is always optional and never blocks the edit itself.
     */
    suspend fun renderStyledFrame(video: File, ass: File, fontsDir: File?, atMs: Long, outImage: File): Boolean
}
