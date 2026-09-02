package com.hebsub.app.media

import com.arthenica.ffmpegkit.FFmpegKit
import com.arthenica.ffmpegkit.FFprobeKit
import com.arthenica.ffmpegkit.ReturnCode
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
    ): Boolean {
        val subCodec = if (sub.extension.equals("ass", ignoreCase = true)) "ass" else "srt"
        val args = ArrayList<String>()
        args += listOf("-y", "-i", input.absolutePath, "-i", sub.absolutePath)
        val hasPoster = poster != null && poster.exists()
        if (hasPoster) args += listOf("-attach", poster!!.absolutePath)
        args += listOf("-map", "0", "-map", "1", "-c", "copy", "-c:s", subCodec)
        args += listOf(
            "-metadata:s:s:$existingSubtitleCount", "language=heb",
            "-metadata:s:s:$existingSubtitleCount", "title=עברית",
        )
        if (hasPoster) {
            val mime = if (poster!!.extension.equals("png", true)) "image/png" else "image/jpeg"
            val fname = if (mime == "image/png") "cover.png" else "cover.jpg"
            args += listOf("-metadata:s:t:0", "mimetype=$mime", "-metadata:s:t:0", "filename=$fname")
        }
        metadata.forEach { (k, v) ->
            val clean = v.replace("\n", " ").replace("\"", "'").trim()
            if (clean.isNotEmpty()) args += listOf("-metadata", "$k=$clean")
        }
        args += outMkv.absolutePath
        return run(*args.toTypedArray())
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
