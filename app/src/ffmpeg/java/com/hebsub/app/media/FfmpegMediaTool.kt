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
import java.util.Locale

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
        // render as nothing at all. So the font is always re-attached explicitly,
        // and the cover with it.
        //
        // The cover was suspected for a while of breaking the subtitles (3.2.2) and
        // taken out. It was innocent — the fault was the command-line tokeniser,
        // fixed in 3.3 — so it is back: a film file with its poster is what players
        // and library apps show as the thumbnail.
        val hasFont = font != null && font.exists()
        val hasPoster = poster != null && poster.exists()
        val args = ArrayList<String>()
        args += listOf("-y", "-i", inputMkv.absolutePath, "-i", sub.absolutePath)
        if (hasFont) args += listOf("-attach", font!!.absolutePath)
        if (hasPoster) args += listOf("-attach", poster!!.absolutePath)
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
        if (hasPoster) { args += coverMetadata(poster!!, t); t++ }
        args += outMkv.absolutePath
        val ok = run(*args.toTypedArray())
        if (ok) verifySubtitleTracks(outMkv, expectedAttachments = t)
        return ok
    }

    /** MKV cover-art tags for attachment stream [t]: mimetype and the conventional name. */
    private fun coverMetadata(poster: File, t: Int): List<String> {
        val png = poster.extension.equals("png", ignoreCase = true)
        return listOf(
            "-metadata:s:t:$t", "mimetype=${if (png) "image/png" else "image/jpeg"}",
            "-metadata:s:t:$t", "filename=${if (png) "cover.png" else "cover.jpg"}",
        )
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
        val filter = buildString {
            append("ass=").append(escapeFilterArg(ass.absolutePath))
            fontsDir?.let { append(":fontsdir=").append(escapeFilterArg(it.absolutePath)) }
            append(",scale=960:-2")
        }
        val ok = run(
            "-y", "-ss", sec(atMs.coerceAtLeast(0L)), "-i", video.absolutePath,
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

    override suspend fun probeAudio(input: File): AudioLayout? = withContext(Dispatchers.IO) {
        val info = runCatching { FFprobeKit.getMediaInformation(input.absolutePath).mediaInformation }.getOrNull()
            ?: return@withContext null
        val audio = info.streams?.firstOrNull { it.type == "audio" } ?: return@withContext null
        val props = runCatching { audio.allProperties }.getOrNull()
        val channels = props?.optInt("channels", 0) ?: 0
        val layout = props?.optString("channel_layout")?.takeUnless { it.isNullOrBlank() }
        if (channels <= 0) null else AudioLayout(channels, layout)
    }

    /**
     * Dialogue extraction for the recogniser.
     *
     * Film sound is not a microphone in front of a speaker: the dialogue is mixed
     * under music and effects, and the quiet lines are the ones that go missing.
     * Two things about the mix work in our favour. In a surround mix the dialogue
     * lives on its own channel, the front centre, so taking just that channel
     * drops most of the score. In a stereo mix the dialogue is panned to the
     * middle while music and ambience are spread wide, and FFmpeg's dialoguenhance
     * filter extracts that centre as a third channel. `speechnorm` then brings
     * quiet speech up to level — it expands each half-cycle towards a target
     * peak, which is the right tool for a whispered line under a loud score.
     *
     * Lossless FLAC, because the recogniser's own forum records missed words on
     * compressed audio and the previous path sent 48 kbps AAC.
     *
     * Each chain is tried in turn; a build missing a filter fails fast with
     * "No such filter", and the next chain is tried. The caller gets the name of
     * the one that worked, for the log.
     */
    override suspend fun extractDialogueForAsr(input: File, out: File, layout: AudioLayout?): String? {
        val channels = layout?.channels ?: 0
        val speech = "speechnorm=e=4:r=0.0001:l=1"
        val chains = ArrayList<Pair<String, String>>()
        when {
            channels >= 6 -> chains += "surround centre channel" to "pan=mono|c0=FC,$speech"
            channels == 2 -> chains += "stereo dialogue enhance" to "dialoguenhance,pan=mono|c0=FC,$speech"
        }
        chains += "speech normalisation" to "$speech"
        chains += "plain mono" to "aresample=16000"
        for ((name, chain) in chains) {
            runCatching { out.delete() }
            val ok = run(
                "-y", "-i", input.absolutePath, "-vn",
                "-af", chain, "-ac", "1", "-ar", "16000", "-c:a", "flac", out.absolutePath,
            )
            if (ok && out.exists() && out.length() > 0) return name
            RunLog.log("dialogue extraction: '$name' failed — trying the next chain")
        }
        return null
    }

    override suspend fun cutAudio(input: File, fromMs: Long, toMs: Long, out: File, boost: Boolean): Boolean {
        val args = ArrayList<String>()
        args += listOf(
            "-y", "-ss", sec(fromMs), "-t", sec(toMs - fromMs),
            "-i", input.absolutePath,
        )
        if (boost) {
            // A gap the first pass heard nothing in: denoise, then expand harder. Both
            // cost fidelity, which is why they are not on the main path.
            args += listOf("-af", "afftdn=nf=-45:nr=20,speechnorm=e=12:r=0.0005:l=1")
        }
        args += listOf("-ac", "1", "-ar", "16000", "-c:a", "flac", out.absolutePath)
        return run(*args.toTypedArray())
    }

    override suspend fun nonSilentFraction(input: File, fromMs: Long, toMs: Long): Double? {
        val lenSec = (toMs - fromMs) / 1000.0
        if (lenSec <= 0) return null
        val (ok, output) = runCapture(
            "-ss", sec(fromMs), "-t", sec(toMs - fromMs),
            "-i", input.absolutePath, "-af", "silencedetect=n=-40dB:d=0.5", "-f", "null", "-",
        )
        if (!ok) return null
        // silencedetect logs "silence_duration: 1.234" for each silent stretch.
        var silent = 0.0
        for (m in SILENCE_DURATION.findAll(output)) silent += m.groupValues[1].toDoubleOrNull() ?: 0.0
        // A silence still open at the end of the range is reported as a start with no end.
        val starts = SILENCE_START.findAll(output).count()
        val ends = SILENCE_END.findAll(output).count()
        if (starts > ends) {
            val lastStart = SILENCE_START.findAll(output).last().groupValues[1].toDoubleOrNull()
            if (lastStart != null) silent += (lenSec - lastStart).coerceAtLeast(0.0)
        }
        return (1.0 - silent / lenSec).coerceIn(0.0, 1.0)
    }

    /** Seconds with a dot decimal point regardless of the device locale — FFmpeg reads no other. */
    private fun sec(ms: Long): String = String.format(Locale.US, "%.3f", ms / 1000.0)

    private companion object {
        val SILENCE_DURATION = Regex("""silence_duration:\s*([0-9.]+)""")
        val SILENCE_START = Regex("""silence_start:\s*([0-9.]+)""")
        val SILENCE_END = Regex("""silence_end:\s*([0-9.]+)""")
    }

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
        val hasPoster = poster != null && poster.exists()
        val args = ArrayList<String>()
        args += listOf("-y", "-i", input.absolutePath, "-i", sub.absolutePath)
        // Attachments (font first, then poster) become attachment streams t:0,t:1…
        // in the order the -attach options appear here.
        if (hasFont) args += listOf("-attach", font!!.absolutePath)
        if (hasPoster) args += listOf("-attach", poster!!.absolutePath)
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
        if (hasPoster) { args += coverMetadata(poster!!, t); t++ }
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
                RunLog.issue("צורפו $expectedAttachments קבצים (גופן/פוסטר) אך המכל מכיל ${attachments.size}")
            }
            if (heb == 0) {
                RunLog.error("verify: NO Hebrew subtitle track found in ${outMkv.name}")
                RunLog.issue("לא נמצאה רצועת כתוביות בעברית בקובץ המדיה")
            }
            val needsFont = subs.any { it.contains("ass") || it.contains("ssa") }
            if (needsFont && attachments.none { it.contains("font", ignoreCase = true) || it.endsWith(".ttf)", ignoreCase = true) }) {
                RunLog.error("verify: styled ASS track but NO font attachment — Hebrew will not render")
                RunLog.issue("רצועת ASS ללא גופן מצורף — העברית לא תוצג")
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
            RunLog.issue("לא ניתן לקרוא חזרה את רצועת הכתוביות מהקובץ")
            return@withContext
        }
        val text = runCatching { tmp.readText(Charsets.UTF_8) }.getOrNull().orEmpty()
        val dialogue = text.lineSequence().count { it.startsWith("Dialogue:") }
        val style = text.lineSequence().firstOrNull { it.startsWith("Style:") }
        RunLog.log("verify: track read back — ${text.length} chars, $dialogue dialogue lines")
        RunLog.log("verify: style in the muxed track: ${style ?: "*** NONE — nothing can render ***"}")
        text.lineSequence().firstOrNull { it.startsWith("Dialogue:") }
            ?.let { RunLog.log("verify: first event: ${it.take(160)}") }
        if (dialogue == 0) {
            RunLog.error("verify: the muxed subtitle track has NO events")
            RunLog.issue("רצועת הכתוביות בקובץ ריקה — אין שורות")
        }
        if (style == null) {
            RunLog.error("verify: the muxed subtitle track has NO style line")
            RunLog.issue("רצועת הכתוביות בקובץ ללא הגדרת סגנון — לא תוצג")
        }
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
    private suspend fun run(vararg args: String): Boolean = runCapture(*args).first

    /** Like [run], but also hands back FFmpeg's own output for callers that parse it. */
    private suspend fun runCapture(vararg args: String): Pair<Boolean, String> = withContext(Dispatchers.IO) {
        try {
            val session = FFmpegKit.executeWithArguments(args)
            val ok = ReturnCode.isSuccess(session.returnCode)
            val output = session.output.orEmpty()
            if (!ok) {
                RunLog.error("ffmpeg failed rc=${session.returnCode} (${args.size} args)")
                RunLog.error("ffmpeg output: ${output.takeLast(600)}")
            }
            ok to output
        } catch (t: Throwable) {
            RunLog.error("ffmpeg threw", t)
            false to ""
        }
    }
}
