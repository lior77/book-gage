package com.hebsub.core.subtitle

/**
 * Serialises cues to canonical SubRip text. Indices are re-numbered from 1 so
 * the output is well-formed regardless of how the source was numbered.
 */
object SrtWriter {

    fun write(cues: List<SubtitleCue>): String {
        val sb = StringBuilder()
        cues.forEachIndexed { i, cue ->
            sb.append(i + 1).append('\n')
            sb.append(TimeCode.formatSrt(cue.startMs))
                .append(" --> ")
                .append(TimeCode.formatSrt(cue.endMs))
                .append('\n')
            val body = cue.lines.ifEmpty { listOf("") }
            body.forEach { sb.append(it).append('\n') }
            sb.append('\n')
        }
        return sb.toString()
    }
}
