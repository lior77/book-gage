package com.hebsub.app.media

import com.arthenica.ffmpegkit.FFmpegKit
import com.arthenica.ffmpegkit.FFprobeKit
import com.arthenica.ffmpegkit.ReturnCode
import com.hebsub.app.log.RunLog
import com.hebsub.core.lang.Language
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File

/**
 * FFmpeg-backed [MediaTool].
 *
 * Requires a 16 KB-page-size-compatible FFmpegKit build on the classpath (see
 * README → "Native dependencies"). The official `ffmpeg-kit` was retired in
 * Jan 2025 and its binaries removed from Maven, so a community 16KB fork (or a
 * locally built AAR) must be added for the app to compile and run on Android 15.
 */
class FfmpegMediaTool : MediaTool {

    override val canEmbed = true

    override suspend fun probe(input: File): MediaProbe = withContext(Dispatchers.IO) {
        val session = FFprobeKit.getMediaInformation(input.absolutePath)
        val info = session.mediaInformation
            ?: return@withContext MediaProbe(emptyList(), null, 0)

        val subs = ArrayList<EmbeddedSubtitle>()
        var audioLang: String? = null
        val streams = info.streams ?: emptyList()
        for (stream in streams) {
            val type = stream.type ?: continue
            val props = runCatching { stream.allProperties }.getOrNull()
            val tags = props?.optJSONObject("tags")
            val lang = tags?.optString("language").takeUnless { it.isNullOrBlank() }
            val index = stream.index?.toInt() ?: continue
            when (type) {
                "subtitle" -> subs.add(EmbeddedSubtitle(index, lang))
                "audio" -> if (audioLang == null) audioLang = lang
            }
        }
        val durationMs = (info.duration?.toDoubleOrNull() ?: 0.0).times(1000).toLong()
        MediaProbe(subs, Language.canonical(audioLang), durationMs)
    }

    override suspend fun extractSubtitle(input: File, streamIndex: Int, outSrt: File): Boolean =
        run(
            "-y", "-i", input.absolutePath,
            "-map", "0:$streamIndex", "-c:s", "srt", outSrt.absolutePath,
        )

    override suspend fun extractSubtitleRaw(input: File, out: File): Boolean =
        // `-c:s copy` keeps ASS as ASS (the default would transcode it to SRT and
        // throw away exactly the styling the editor needs to read).
        run("-y", "-i", input.absolutePath, "-map", "0:s:0", "-c:s", "copy", out.absolutePath)

    override suspend fun replaceSubtitleTrack(
        inputMkv: File,
        sub: File,
        outMkv: File,
        title: String,
        font: File?,
        poster: File?,
    ): Boolean {
        // Copying the source's attachments through with `-map 0:t?` is NOT reliable:
        // the font can arrive without a usable mimetype, libass then has no Hebrew
        // glyphs, every glyph collapses to zero width — and the text AND its plate
        // render as nothing at all. So the font is always re-attached explicitly.
        //
        // The cover image is deliberately NOT attached here. The one produced file
        // that renders correctly was built without it, the one that renders nothing
        // was built with it, and its own -attach did not even land (the container
        // came back with one attachment after two were asked for). A cover is
        // decoration; the subtitles are the point, so the suspect is kept out of
        // this path. The poster still sits in the movie's folder as a file, and
        // "add data" still embeds it when that is what the user asked for.
        val hasFont = font != null && font.exists()
        val args = ArrayList<String>()
        args += listOf("-y", "-i", inputMkv.absolutePath, "-i", sub.absolutePath)
        if (hasFont) args += listOf("-attach", font!!.absolutePath)
        // Only the real video stream (a cover stored as a video stream would
        // otherwise be duplicated) plus the audio, then the NEW subtitle.
        args += listOf("-map", "0:v:0", "-map", "0:a?", "-map", "1", "-c", "copy", "-c:s", "copy")
        args += listOf(
            "-metadata:s:s:0", "language=heb",
            "-metadata:s:s:0", "title=$title",
            "-disposition:s:0", "default",
        )
        var t = 0
        if (hasFont) {
            args += listOf(
                "-metadata:s:t:$t", "mimetype=application/x-truetype-font",
                "-metadata:s:t:$t", "filename=${font!!.name}",
            )
            t++
        }
        args += outMkv.absolutePath
        val ok = run(*args.toTypedArray())
        if (ok) verifySubtitleTracks(outMkv, expectedAttachments = t)
        return ok
    }

    override suspend fun applyMovieData(
        input: File,
        outFile: File,
        metadata: Map<String, String>,
        poster: File?,
    ): Boolean {
        // §3.3 — add the film's data and cover, change nothing else. `-map 0`
        // carries every stream over (subtitles included) and `-c copy` means not
        // one of them is re-encoded, so the subtitle track comes out identical.
        val args = ArrayList<String>()
        args += listOf("-y", "-i", input.absolutePath)
        val hasPoster = poster != null && poster.exists()
        if (hasPoster) args += listOf("-attach", poster!!.absolutePath)
        // `-map 0` alone would drop nothing, but an explicit `-map 0:t?` keeps the
        // existing attachments (the Hebrew font) even as a new one is added.
        args += listOf("-map", "0", "-c", "copy")
        if (hasPoster) {
            val mime = if (poster!!.extension.equals("png", true)) "image/png" else "image/jpeg"
            val fname = if (mime == "image/png") "cover.png" else "cover.jpg"
            // The new attachment is appended after whatever the source already had.
            val t = attachmentCount(input)
            args += listOf("-metadata:s:t:$t", "mimetype=$mime", "-metadata:s:t:$t", "filename=$fname")
        }
        metadata.forEach { (k, v) ->
            // Newlines are flattened because an MKV tag is a single line. Quotes are
            // left alone: replacing them was only ever protecting the old string-based
            // command builder, and it silently altered the film's own description.
            val clean = v.replace("\n", " ").replace("\r", " ").trim()
            if (clean.isNotEmpty()) args += listOf("-metadata", "$k=$clean")
        }
        args += outFile.absolutePath
        RunLog.log("data: writing ${metadata.size} tags + cover=${hasPoster} into ${outFile.name}")
        val ok = run(*args.toTypedArray())
        if (ok) verifySubtitleTracks(outFile)
        return ok
    }

    override suspend fun renderStyledFrame(
        video: File,
        ass: File,
        fontsDir: File?,
        atMs: Long,
        outImage: File,
    ): Boolean {
        // `-ss` before `-i` seeks by keyframe, which is near-instant even two hours
        // in; a preview does not need frame accuracy. The frame is scaled down
        // because it is going onto a phone screen, and `ass` scales its rendering
        // with the frame, so the proportions the user sees are the real ones.
        val seconds = (atMs.coerceAtLeast(0L) / 1000.0)
        val filter = buildString {
            append("ass=").append(escapeFilterArg(ass.absolutePath))
            fontsDir?.let { append(":fontsdir=").append(escapeFilterArg(it.absolutePath)) }
            append(",scale=960:-2")
        }
        val ok = run(
            "-y", "-ss", "%.3f".format(seconds), "-i", video.absolutePath,
            "-vf", filter, "-frames:v", "1", "-q:v", "3", outImage.absolutePath,
        )
        if (!ok) RunLog.log("preview: the ass filter is unavailable in this FFmpeg build (or the seek failed)")
        return ok && outImage.exists() && outImage.length() > 0
    }

    /**
     * Escape a path for use inside a filtergraph, where `:` separates options and
     * `\` and `'` are the escape characters themselves.
     */
    private fun escapeFilterArg(path: String): String =
        path.replace("""\""", """\\""").replace(":", """\:""").replace("'", """\'""")

    /** How many attachment streams [input] already has (0 when it cannot be probed). */
    private suspend fun attachmentCount(input: File): Int = withContext(Dispatchers.IO) {
        val info = runCatching { FFprobeKit.getMediaInformation(input.absolutePath).mediaInformation }.getOrNull()
            ?: return@withContext 0
        (info.streams ?: emptyList()).count { it.type == "attachment" }
    }

    override suspend fun extractAudioForAsr(input: File, outWav: File): Boolean =
        // Compact mono 16 kHz AAC keeps the upload small (a 2h film ≈ tens of MB
        // instead of hundreds). AAC is an internal FFmpeg encoder, present even
        // in the minimal build. Deepgram accepts m4a/mp4.
        run(
            "-y", "-i", input.absolutePath,
            "-vn", "-ac", "1", "-ar", "16000", "-c:a", "aac", "-b:a", "48k", outWav.absolutePath,
        )

    override suspend fun remuxWithHebrew(
        input: File,
        srt: File,
        existingSubtitleCount: Int,
        outMkv: File,
    ): Boolean {
        // Pick the subtitle codec from the file: ASS (styled box for burned-in
        // cover) stays ASS; everything else is written as SRT.
        val subCodec = if (srt.extension.equals("ass", ignoreCase = true)) "ass" else "srt"
        return run(
            "-y", "-i", input.absolutePath, "-i", srt.absolutePath,
            "-map", "0", "-map", "1",
            "-c", "copy", "-c:s", subCodec,
            "-metadata:s:s:$existingSubtitleCount", "language=heb",
            "-metadata:s:s:$existingSubtitleCount", "title=עברית",
            outMkv.absolutePath,
        )
    }

    override suspend fun remuxWithHebrewAndMeta(
        input: File,
        sub: File,
        existingSubtitleCount: Int,
        outMkv: File,
        metadata: Map<String, String>,
        poster: File?,
        font: File?,
    ): Boolean {
        // Every subtitle stream is copied verbatim (`-c:s copy`), never re-encoded,
        // so a styled ASS keeps its background plate. Video and audio are always
        // `-c copy` (lossless), so film quality is untouched either way.
        val isAss = sub.extension.equals("ass", ignoreCase = true)
        // A Hebrew font is embedded only for the styled ASS track, so libass has
        // real Hebrew glyphs instead of substituting a box-only font.
        val hasFont = isAss && font != null && font.exists()
        val args = ArrayList<String>()
        args += listOf("-y", "-i", input.absolutePath, "-i", sub.absolutePath)
        // Attachments (font first, then poster) become attachment streams t:0,t:1…
        // in the order the -attach options appear here.
        if (hasFont) args += listOf("-attach", font!!.absolutePath)
        args += listOf("-map", "0", "-map", "1")
        args += listOf("-c", "copy", "-c:s", "copy")

        // Name the Hebrew track by kind so the player's picker shows the right
        // option, and mark it DEFAULT so the player auto-enables and displays it
        // (VLC otherwise may leave it off).
        val primaryTitle = if (isAss) "עברית עם רקע" else "עברית"
        args += listOf(
            "-metadata:s:s:$existingSubtitleCount", "language=heb",
            "-metadata:s:s:$existingSubtitleCount", "title=$primaryTitle",
            "-disposition:s:$existingSubtitleCount", "default",
        )
        // Attachment metadata, indexed in the same order as the -attach options.
        var t = 0
        if (hasFont) {
            args += listOf(
                "-metadata:s:t:$t", "mimetype=application/x-truetype-font",
                "-metadata:s:t:$t", "filename=${font!!.name}",
            )
            t++
        }
        metadata.forEach { (k, v) ->
            // Newlines are flattened because an MKV tag is a single line. Quotes are
            // left alone: replacing them was only ever protecting the old string-based
            // command builder, and it silently altered the film's own description.
            val clean = v.replace("\n", " ").replace("\r", " ").trim()
            if (clean.isNotEmpty()) args += listOf("-metadata", "$k=$clean")
        }
        args += outMkv.absolutePath
        val ok = run(*args.toTypedArray())
        // Upgrade (b): read the file back and prove the Hebrew tracks are there.
        if (ok) verifySubtitleTracks(outMkv, expectedAttachments = t)
        return ok
    }

    /**
     * Upgrade (b): re-probe the freshly written MKV and log every subtitle stream
     * it actually contains (codec, language, title), turning "wrote media file"
     * into a verified fact. Purely diagnostic — never fails the run.
     */
    private suspend fun verifySubtitleTracks(outMkv: File, expectedAttachments: Int = 0) = withContext(Dispatchers.IO) {
        try {
            val info = FFprobeKit.getMediaInformation(outMkv.absolutePath).mediaInformation
            if (info == null) { RunLog.log("verify: ffprobe returned no media info for ${outMkv.name}"); return@withContext }
            val subs = ArrayList<String>()
            val attachments = ArrayList<String>()
            for (stream in info.streams ?: emptyList()) {
                val props = runCatching { stream.allProperties }.getOrNull()
                val tags = props?.optJSONObject("tags")
                when (stream.type) {
                    "subtitle" -> {
                        val lang = tags?.optString("language").takeUnless { it.isNullOrBlank() } ?: "?"
                        val title = tags?.optString("title").takeUnless { it.isNullOrBlank() } ?: "?"
                        val codec = stream.codec ?: "?"
                        subs += "s:${stream.index}[$codec/$lang/\"$title\"]"
                    }
                    // A styled ASS is only readable if its font really came along, so
                    // log the attachments too — a missing font renders as nothing.
                    "attachment" -> {
                        val name = tags?.optString("filename").takeUnless { it.isNullOrBlank() } ?: "?"
                        val mime = tags?.optString("mimetype").takeUnless { it.isNullOrBlank() } ?: "?"
                        attachments += "$name($mime)"
                    }
                }
            }
            val heb = subs.count { it.contains("/heb/") || it.contains("/he/") }
            RunLog.log("verify: ${outMkv.name} subtitleStreams=${subs.size} hebrew=$heb ${subs.joinToString(" ")}")
            RunLog.log("verify: attachments=${attachments.size} ${attachments.joinToString(" ")}")
            if (expectedAttachments > 0 && attachments.size != expectedAttachments) {
                // Asking ffmpeg to attach two files and getting one back means an
                // -attach was silently dropped, and the -metadata:s:t:N that went
                // with it addressed a stream that does not exist.
                RunLog.error("verify: attached $expectedAttachments file(s) but the container has ${attachments.size}")
            }
            if (heb == 0) RunLog.error("verify: NO Hebrew subtitle track found in ${outMkv.name}")
            val needsFont = subs.any { it.contains("ass") || it.contains("ssa") }
            if (needsFont && attachments.none { it.contains("font", ignoreCase = true) || it.endsWith(".ttf)", ignoreCase = true) }) {
                RunLog.error("verify: styled ASS track but NO font attachment — Hebrew will not render")
            }
            if (needsFont) readBackSubtitle(outMkv)
        } catch (t: Throwable) {
            RunLog.error("verify failed", t)
        }
    }

    /**
     * Pull the subtitle track back OUT of the finished container and log what it
     * actually contains.
     *
     * ffprobe listing a stream only proves the stream exists — it says nothing
     * about whether the ASS header survived the mux. An MKV stores that header
     * separately from the events (as CodecPrivate), and a track whose header lost
     * its `[V4+ Styles]` section has no style to render with, which looks exactly
     * like "the track is there and nothing appears". This makes the difference
     * visible in the log instead of leaving it to be guessed at.
     */
    private suspend fun readBackSubtitle(outMkv: File) = withContext(Dispatchers.IO) {
        val tmp = File(outMkv.parentFile, "verify-readback.ass")
        runCatching { tmp.delete() }
        if (!run("-y", "-i", outMkv.absolutePath, "-map", "0:s:0", "-c:s", "copy", tmp.absolutePath)) {
            RunLog.error("verify: could not read the subtitle track back out of ${outMkv.name}")
            return@withContext
        }
        val text = runCatching { tmp.readText(Charsets.UTF_8) }.getOrNull().orEmpty()
        val dialogue = text.lineSequence().count { it.startsWith("Dialogue:") }
        val style = text.lineSequence().firstOrNull { it.startsWith("Style:") }
        RunLog.log("verify: track read back — ${text.length} chars, $dialogue dialogue lines")
        RunLog.log("verify: style in the muxed track: ${style ?: "*** NONE — nothing can render ***"}")
        text.lineSequence().firstOrNull { it.startsWith("Dialogue:") }
            ?.let { RunLog.log("verify: first event: ${it.take(160)}") }
        if (dialogue == 0) RunLog.error("verify: the muxed subtitle track has NO events")
        if (style == null) RunLog.error("verify: the muxed subtitle track has NO style line")
        runCatching { tmp.delete() }
    }

    /**
     * Run FFmpeg with these arguments, each passed as its own argv entry.
     *
     * This used to join the arguments into one string and let FFmpegKit tokenise it
     * back apart, wrapping anything containing whitespace in double quotes. That
     * holds up until an argument contains a quote character of its own — and the
     * film metadata is free-form prose from OMDb and from the translator, so
     * apostrophes and quotation marks are a matter of course, not an edge case. One
     * of them flips the tokeniser's quote state and every argument after it is
     * re-split at the wrong boundaries: a silent, data-dependent corruption of the
     * rest of the command. `executeWithArguments` parses nothing, so the array built
     * here is exactly the array FFmpeg receives.
     *
     * A failure now says so, with the tail of FFmpeg's own output, rather than
     * returning a bare false and leaving the log to be read as success.
     */
    private suspend fun run(vararg args: String): Boolean = withContext(Dispatchers.IO) {
        try {
            val session = FFmpegKit.executeWithArguments(args)
            val ok = ReturnCode.isSuccess(session.returnCode)
            if (!ok) {
                RunLog.error("ffmpeg failed rc=${session.returnCode} (${args.size} args)")
                RunLog.error("ffmpeg output: ${session.output?.takeLast(600).orEmpty()}")
            }
            ok
        } catch (t: Throwable) {
            RunLog.error("ffmpeg threw", t)
            false
        }
    }
}
