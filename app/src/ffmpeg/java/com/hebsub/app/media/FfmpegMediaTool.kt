package com.hebsub.app.media

import com.arthenica.ffmpegkit.FFmpegKit
import com.arthenica.ffmpegkit.FFprobeKit
import com.arthenica.ffmpegkit.ReturnCode
import com.hebsub.app.log.RunLog
import com.hebsub.core.lang.Language
import com.hebsub.core.pipeline.EmbeddedSubtitle
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
        var videoFps = 0.0
        val streams = info.streams ?: emptyList()
        for (stream in streams) {
            val type = stream.type ?: continue
            val props = runCatching { stream.allProperties }.getOrNull()
            val tags = props?.optJSONObject("tags")
            val lang = tags?.optString("language").takeUnless { it.isNullOrBlank() }
            val title = tags?.optString("title").takeUnless { it.isNullOrBlank() }
            val disposition = props?.optJSONObject("disposition")
            val forced = disposition?.optInt("forced", 0) == 1
            val index = stream.index?.toInt() ?: continue
            when (type) {
                "subtitle" -> subs.add(EmbeddedSubtitle(index, lang, title, forced))
                "audio" -> if (audioLang == null) audioLang = lang
                "video" -> if (videoFps <= 0.0) {
                    // ffprobe reports rates as a rational string, e.g. "24000/1001".
                    val raw = listOf("avg_frame_rate", "r_frame_rate")
                        .firstNotNullOfOrNull { props?.optString(it)?.takeUnless { s -> s.isBlank() } }
                    videoFps = parseRate(raw)
                }
            }
        }
        val durationMs = (info.duration?.toDoubleOrNull() ?: 0.0).times(1000).toLong()
        MediaProbe(subs, Language.canonical(audioLang), durationMs, videoFps)
    }

    /** "24000/1001" or "25" → frames per second; 0.0 when unparseable. */
    private fun parseRate(raw: String?): Double {
        val s = raw?.trim().orEmpty()
        if (s.isEmpty()) return 0.0
        val parts = s.split('/')
        return when {
            parts.size == 2 -> {
                val n = parts[0].toDoubleOrNull() ?: return 0.0
                val d = parts[1].toDoubleOrNull() ?: return 0.0
                if (d == 0.0) 0.0 else n / d
            }
            else -> s.toDoubleOrNull() ?: 0.0
        }
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
    ): Boolean {
        val attachFont = font != null && font.exists()
        val args = ArrayList<String>()
        args += listOf("-y", "-i", inputMkv.absolutePath, "-i", sub.absolutePath)
        if (attachFont) args += listOf("-attach", font!!.absolutePath)
        // Video + audio verbatim, the NEW subtitle, and the source's attachments
        // (font/cover) unless we are attaching a font ourselves.
        args += listOf("-map", "0:v", "-map", "0:a?")
        if (!attachFont) args += listOf("-map", "0:t?")
        args += listOf("-map", "1", "-c", "copy", "-c:s", "copy")
        args += listOf(
            "-metadata:s:s:0", "language=heb",
            "-metadata:s:s:0", "title=$title",
            "-disposition:s:0", "default",
        )
        if (attachFont) {
            args += listOf(
                "-metadata:s:t:0", "mimetype=application/x-truetype-font",
                "-metadata:s:t:0", "filename=${font!!.name}",
            )
        }
        args += outMkv.absolutePath
        val ok = run(*args.toTypedArray())
        if (ok) verifySubtitleTracks(outMkv)
        return ok
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
        secondarySub: File?,
        existingSubtitleCount: Int,
        outMkv: File,
        metadata: Map<String, String>,
        poster: File?,
        font: File?,
    ): Boolean {
        // Upgrade (a): copy every subtitle stream verbatim (`-c:s copy`) — never
        // re-encode. The styled ASS keeps its background plate, and when one is
        // present we also mux the plain SRT sidecar as a SECOND parallel Hebrew
        // track (input 2) so every player exposes a selectable Hebrew subtitle.
        // Video and audio are always `-c copy` (lossless), so film quality is
        // untouched regardless of the subtitle handling.
        val isAss = sub.extension.equals("ass", ignoreCase = true)
        val hasSecondary = secondarySub != null && secondarySub.exists() &&
            secondarySub.absolutePath != sub.absolutePath
        // A Hebrew font is embedded only for the styled ASS track, so libass has
        // real Hebrew glyphs instead of substituting a box-only font.
        val hasFont = isAss && font != null && font.exists()
        val args = ArrayList<String>()
        args += listOf("-y", "-i", input.absolutePath, "-i", sub.absolutePath)
        if (hasSecondary) args += listOf("-i", secondarySub!!.absolutePath)
        // Attachments (font first, then poster) become attachment streams t:0,t:1…
        // in the order the -attach options appear here.
        if (hasFont) args += listOf("-attach", font!!.absolutePath)
        val hasPoster = poster != null && poster.exists()
        if (hasPoster) args += listOf("-attach", poster!!.absolutePath)
        args += listOf("-map", "0", "-map", "1")
        if (hasSecondary) args += listOf("-map", "2")
        args += listOf("-c", "copy", "-c:s", "copy")

        // Primary Hebrew track (the muxed `sub`). Name it by kind so the player's
        // picker shows the right option, and mark it DEFAULT so the player
        // auto-enables and displays it (VLC otherwise may leave it off).
        val primaryTitle = if (isAss) "עברית עם רקע" else "עברית"
        args += listOf(
            "-metadata:s:s:$existingSubtitleCount", "language=heb",
            "-metadata:s:s:$existingSubtitleCount", "title=$primaryTitle",
            "-disposition:s:$existingSubtitleCount", "default",
        )
        // Second, universally-selectable plain-text Hebrew track.
        if (hasSecondary) {
            val i = existingSubtitleCount + 1
            args += listOf(
                "-metadata:s:s:$i", "language=heb",
                "-metadata:s:s:$i", "title=עברית (טקסט)",
            )
        }
        // Attachment metadata, indexed in the same order as the -attach options.
        var t = 0
        if (hasFont) {
            args += listOf(
                "-metadata:s:t:$t", "mimetype=application/x-truetype-font",
                "-metadata:s:t:$t", "filename=${font!!.name}",
            )
            t++
        }
        if (hasPoster) {
            val mime = if (poster!!.extension.equals("png", true)) "image/png" else "image/jpeg"
            val fname = if (mime == "image/png") "cover.png" else "cover.jpg"
            args += listOf("-metadata:s:t:$t", "mimetype=$mime", "-metadata:s:t:$t", "filename=$fname")
            t++
        }
        metadata.forEach { (k, v) ->
            val clean = v.replace("\n", " ").replace("\"", "'").trim()
            if (clean.isNotEmpty()) args += listOf("-metadata", "$k=$clean")
        }
        args += outMkv.absolutePath
        val ok = run(*args.toTypedArray())
        // Upgrade (b): read the file back and prove the Hebrew tracks are there.
        if (ok) verifySubtitleTracks(outMkv)
        return ok
    }

    /**
     * Upgrade (b): re-probe the freshly written MKV and log every subtitle stream
     * it actually contains (codec, language, title), turning "wrote media file"
     * into a verified fact. Purely diagnostic — never fails the run.
     */
    private suspend fun verifySubtitleTracks(outMkv: File) = withContext(Dispatchers.IO) {
        try {
            val info = FFprobeKit.getMediaInformation(outMkv.absolutePath).mediaInformation
            if (info == null) { RunLog.log("verify: ffprobe returned no media info for ${outMkv.name}"); return@withContext }
            val subs = ArrayList<String>()
            for (stream in info.streams ?: emptyList()) {
                if (stream.type != "subtitle") continue
                val props = runCatching { stream.allProperties }.getOrNull()
                val tags = props?.optJSONObject("tags")
                val lang = tags?.optString("language").takeUnless { it.isNullOrBlank() } ?: "?"
                val title = tags?.optString("title").takeUnless { it.isNullOrBlank() } ?: "?"
                val codec = stream.codec ?: "?"
                subs += "s:${stream.index}[$codec/$lang/\"$title\"]"
            }
            val heb = subs.count { it.contains("/heb/") || it.contains("/he/") }
            RunLog.log("verify: ${outMkv.name} subtitleStreams=${subs.size} hebrew=$heb ${subs.joinToString(" ")}")
            if (heb == 0) RunLog.error("verify: NO Hebrew subtitle track found in ${outMkv.name}")
        } catch (t: Throwable) {
            RunLog.error("verify failed", t)
        }
    }

    private suspend fun run(vararg args: String): Boolean = withContext(Dispatchers.IO) {
        try {
            val session = FFmpegKit.execute(args.joinToString(" ") { quoteIfNeeded(it) })
            ReturnCode.isSuccess(session.returnCode)
        } catch (_: Throwable) {
            false
        }
    }

    private fun quoteIfNeeded(arg: String): String =
        if (arg.any { it.isWhitespace() }) "\"$arg\"" else arg
}
