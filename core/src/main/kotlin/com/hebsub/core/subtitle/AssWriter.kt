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
    ): String {
        val t = bgTransparencyPercent.coerceIn(0, 100)
        val box = t < 100
        val borderStyle = if (box) 3 else 1   // 3 = opaque box, 1 = outline
        val outline = if (box) 8 else 2        // box padding / text outline
        val alphaHex = "%02X".format(t * 255 / 100)
        val backColour = if (box) "&H${alphaHex}303030" else "&H00000000"

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
            Style: Default,Arial,$fontSize,&H00FFFFFF,&H000000FF,&H00000000,$backColour,0,0,0,0,100,100,0,0,$borderStyle,$outline,0,2,20,20,20,1

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
                .append(escape(cue.text))
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
