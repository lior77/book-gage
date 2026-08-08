package com.hebsub.core.subtitle

/**
 * Tolerant parser for SubRip (`.srt`) and, opportunistically, WebVTT (`.vtt`).
 *
 * Real subtitle files break the spec constantly: missing indices, BOM bytes,
 * CRLF and lone-CR line endings, blank lines inside a cue, WEBVTT headers,
 * and inline tags like `<i>`. This parser copes with all of those and never
 * throws on malformed input — bad blocks are skipped, good ones are kept.
 */
object SrtParser {

    private const val ARROW = "-->"
    private val HTML_TAG = Regex("</?[a-zA-Z][^>]*>")
    // SSA/ASS override blocks such as {\an8} or {\pos(1,2)}.
    // Both braces are escaped: Android's regex engine rejects an unescaped
    // literal '}' (desktop JVM tolerates it), which crashed on-device.
    private val ASS_OVERRIDE = Regex("""\{\\[^}]*\}""")

    /**
     * Parse subtitle [content] into cues. [stripFormatting] removes inline
     * markup (italic/bold tags, ASS overrides) which is the right default when
     * the cues will be re-translated.
     */
    fun parse(content: String, stripFormatting: Boolean = true): List<SubtitleCue> {
        if (content.isBlank()) return emptyList()

        val normalized = content
            .removePrefix("﻿")            // UTF-8 BOM
            .replace("\r\n", "\n")
            .replace('\r', '\n')

        val lines = normalized.split('\n')
        val cues = ArrayList<SubtitleCue>()
        var i = 0
        var autoIndex = 0

        while (i < lines.size) {
            // Skip blank lines and WebVTT structural lines between cues.
            if (lines[i].isBlank() || isVttNoise(lines[i])) {
                i++
                continue
            }

            // A numeric line preceding a timing line is an index — consume it.
            var timingLineIdx = i
            if (i + 1 < lines.size &&
                lines[i].trim().toIntOrNull() != null &&
                lines[i + 1].contains(ARROW)
            ) {
                timingLineIdx = i + 1
            }

            val timing = lines.getOrNull(timingLineIdx)
            if (timing == null || !timing.contains(ARROW)) {
                // Not a cue start; advance to avoid an infinite loop.
                i++
                continue
            }

            val range = parseTimingLine(timing)
            if (range == null) {
                i++
                continue
            }

            // Collect text lines until a blank line or the next timing line.
            val textLines = ArrayList<String>()
            var j = timingLineIdx + 1
            while (j < lines.size && lines[j].isNotBlank() && !lines[j].contains(ARROW)) {
                var line = lines[j]
                if (stripFormatting) {
                    line = ASS_OVERRIDE.replace(line, "")
                    line = HTML_TAG.replace(line, "")
                }
                textLines.add(line.trimEnd())
                j++
            }

            if (textLines.any { it.isNotBlank() }) {
                autoIndex++
                cues.add(
                    SubtitleCue(
                        index = autoIndex,
                        startMs = range.first,
                        endMs = range.second,
                        lines = textLines.filter { it.isNotBlank() }.ifEmpty { listOf("") },
                    )
                )
            }
            i = j
        }
        return cues
    }

    /** Parse `HH:MM:SS,mmm --> HH:MM:SS,mmm` (VTT cue settings after the end time are ignored). */
    private fun parseTimingLine(line: String): Pair<Long, Long>? {
        val arrowIdx = line.indexOf(ARROW)
        if (arrowIdx < 0) return null
        val startText = line.substring(0, arrowIdx).trim()
        // Drop any VTT cue-position settings that follow the end timestamp.
        val endText = line.substring(arrowIdx + ARROW.length).trim().substringBefore(' ')
        val start = TimeCode.parseOrNull(startText) ?: return null
        val end = TimeCode.parseOrNull(endText) ?: return null
        return start to end
    }

    private fun isVttNoise(line: String): Boolean {
        val t = line.trim()
        return t == "WEBVTT" ||
            t.startsWith("WEBVTT ") ||
            t.startsWith("NOTE") ||
            t.startsWith("STYLE") ||
            t.startsWith("REGION") ||
            t.startsWith("Kind:") ||
            t.startsWith("Language:")
    }
}
