package com.hebsub.core.subtitle

/**
 * Writes cues as an ASS/SSA subtitle. Unlike SRT, ASS can draw a filled box
 * behind the text (BorderStyle 3 + a semi-transparent BackColour), which is used
 * to cover burned-in ("hardcoded") foreign subtitles that can't be turned off:
 * with a plate, each Hebrew line sits on a gray, semi-transparent plate that
 * hides the subtitle burned into the picture beneath it.
 *
 * ASS colours are &HAABBGGRR with INVERTED alpha (00 = opaque, FF = transparent).
 */
object AssWriter {

    /**
     * @param bgTransparencyPercent 0 = fully opaque gray plate (hides burned-in
     *   subs best), 100 = no plate at all. ASS alpha is inverted, so
     *   transparency% maps directly to the alpha byte (0→00 opaque, 100→FF).
     */
    fun write(
        cues: List<SubtitleCue>,
        bgTransparencyPercent: Int = 100,
        fontSize: Int = 26,
        fontName: String = "Arial",
        options: AssStyleOptions? = null,
    ): String {
        // The style line is built by AssStyler so a freshly written file and one
        // restyled later by the editor are byte-for-byte consistent.
        val o = (options ?: AssStyleOptions()).copy(
            bgTransparencyPercent = options?.bgTransparencyPercent ?: bgTransparencyPercent,
            fontSize = options?.fontSize ?: fontSize,
        )
        val styleLine = AssStyler.styleLine(fontName, o)

        val sb = StringBuilder()
        sb.append(
            """
            [Script Info]
            ScriptType: v4.00+
            PlayResX: 384
            PlayResY: 288
            WrapStyle: 0
            ScaledBorderAndShadow: yes

            [V4+ Styles]
            Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
            $styleLine

            [Events]
            Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text

            """.trimIndent(),
        )
        sb.append('\n')
        for (cue in cues) {
            sb.append("Dialogue: 0,")
                .append(time(cue.startMs)).append(',')
                .append(time(cue.endMs)).append(',')
                .append("Default,,0,0,0,,")
                .append(AssStyler.applyText(escape(cue.text), o))
                .append('\n')
        }
        return sb.toString()
    }

    /** ASS timestamp `H:MM:SS.cc` (centiseconds). */
    private fun time(ms: Long): String {
        val cs = (if (ms < 0) 0 else ms) / 10
        val h = cs / 360000
        val m = (cs / 6000) % 60
        val s = (cs / 100) % 60
        val c = cs % 100
        return "%d:%02d:%02d.%02d".format(h, m, s, c)
    }

    /** Newlines become \N; braces are neutralised so they can't start an override block. */
    private fun escape(text: String): String =
        text.replace("\\", "").replace('{', '(').replace('}', ')').replace("\n", "\\N")
}
