package com.hebsub.core.subtitle

/**
 * The four display settings the user can tune for an existing Hebrew ASS track.
 *
 * Values are in ASS *script units*, i.e. relative to `PlayResY` (288) — not screen
 * pixels — so a setting looks the same on any resolution.
 */
data class AssStyleOptions(
    /** 0 = fully opaque plate (hides burned-in subs), 100 = no plate at all. */
    val bgTransparencyPercent: Int = 100,
    /** Plate padding ABOVE and BELOW the text (ASS `Outline` / `\ybord`). */
    val platePadding: Int = 4,
    /**
     * How far the plate extends to the RIGHT and LEFT of the text (`\xbord`).
     * A style line has only one padding field, so the two axes are separated with
     * libass's `\xbord`/`\ybord` override tags.
     */
    val plateSidePadding: Int = 8,
    /** Distance of the subtitles from the bottom edge of the frame (ASS `MarginV`). */
    val marginV: Int = 20,
    /** Extra gap between two subtitle lines; 0 = the font's natural line height. */
    val extraLineSpacing: Int = 0,
    val fontSize: Int = 26,
) {
    val hasPlate: Boolean get() = bgTransparencyPercent < 100

    /** `a=1;b=2` form — small enough to keep in preferences, and easy to read in a log. */
    fun serialize(): String = listOf(
        "t=$bgTransparencyPercent", "p=$platePadding", "s=$plateSidePadding",
        "m=$marginV", "g=$extraLineSpacing", "f=$fontSize",
    ).joinToString(";")

    companion object {
        /**
         * What a styled track looks like unless the user saved their own defaults:
         * a nearly opaque plate that covers burned-in subtitles, sitting low in
         * the frame. (Spec §9.1.)
         */
        val STYLED_DEFAULT = AssStyleOptions(
            bgTransparencyPercent = 10,
            platePadding = 3,
            plateSidePadding = 12,
            marginV = 5,
            extraLineSpacing = 4,
            fontSize = 28,
        )

        /** Read back [serialize]; unknown or malformed parts fall back to [STYLED_DEFAULT]. */
        fun deserialize(raw: String?): AssStyleOptions? {
            if (raw.isNullOrBlank()) return null
            val map = raw.split(';').mapNotNull {
                val kv = it.split('=', limit = 2)
                if (kv.size == 2) kv[0].trim() to kv[1].trim().toIntOrNull() else null
            }.mapNotNull { (k, v) -> v?.let { k to it } }.toMap()
            if (map.isEmpty()) return null
            val d = STYLED_DEFAULT
            return AssStyleOptions(
                bgTransparencyPercent = map["t"] ?: d.bgTransparencyPercent,
                platePadding = map["p"] ?: d.platePadding,
                plateSidePadding = map["s"] ?: d.plateSidePadding,
                marginV = map["m"] ?: d.marginV,
                extraLineSpacing = map["g"] ?: d.extraLineSpacing,
                fontSize = map["f"] ?: d.fontSize,
            )
        }
    }
}

/**
 * Reads and rewrites the `[V4+ Styles]` line of an ASS subtitle so an already
 * produced track can be restyled without touching its text or timing.
 *
 * ASS colours are `&HAABBGGRR` with INVERTED alpha (00 = opaque, FF = clear), and
 * with `BorderStyle: 3` libass fills the plate from the **OutlineColour**, so that
 * is where the grey + transparency lives.
 */
object AssStyler {

    private const val PLATE_RGB = "1A1A1A"          // dark grey (BBGGRR) — deliberately
                                                    // darker than the original 303030 so
                                                    // white text reads better on it
    private const val STYLE_PREFIX = "Style: Default,"

    /** Number of fields in a V4+ style line. */
    private const val FIELDS = 23
    private const val I_FONT = 1
    private const val I_SIZE = 2
    private const val I_OUTLINE_COLOUR = 5
    private const val I_BORDER_STYLE = 15
    private const val I_OUTLINE = 16
    private const val I_MARGIN_V = 21

    /** Build the `Style: Default,…` line for [o]. */
    fun styleLine(fontName: String, o: AssStyleOptions): String {
        val t = o.bgTransparencyPercent.coerceIn(0, 100)
        val box = t < 100
        val borderStyle = if (box) 3 else 1          // 3 = opaque box, 1 = outline
        val outline = if (box) o.platePadding.coerceIn(0, 40) else 2
        val alphaHex = "%02X".format(t * 255 / 100)
        val plate = "&H$alphaHex$PLATE_RGB"
        val outlineColour = if (box) plate else "&H00000000"
        val backColour = if (box) plate else "&H00000000"
        val marginV = o.marginV.coerceIn(0, 200)
        return STYLE_PREFIX +
            "$fontName,${o.fontSize},&H00FFFFFF,&H000000FF,$outlineColour,$backColour," +
            "0,0,0,0,100,100,0,0,$borderStyle,$outline,0,2,20,20,$marginV,1"
    }

    /** Read the current settings out of an ASS document, or null if it has no style line. */
    fun read(ass: String): AssStyleOptions? {
        val line = ass.lineSequence().firstOrNull { it.startsWith("Style:") } ?: return null
        val parts = line.removePrefix("Style:").trim().split(',')
        if (parts.size < FIELDS) return null

        val borderStyle = parts[I_BORDER_STYLE].trim().toIntOrNull() ?: 1
        val alpha = alphaOf(parts[I_OUTLINE_COLOUR].trim())
        // BorderStyle 1 means there is no plate at all, whatever the colour says.
        val transparency = if (borderStyle == 3) (alpha * 100 + 127) / 255 else 100
        // The style has a single padding field; the per-axis values live in the
        // dialogue overrides. Fall back to the style's value for older files that
        // have no overrides, so they read back looking exactly as they do now.
        val outline = parts[I_OUTLINE].trim().toDoubleOrNull()?.toInt() ?: 4
        return AssStyleOptions(
            bgTransparencyPercent = transparency.coerceIn(0, 100),
            platePadding = YBORD.find(ass)?.groupValues?.get(1)?.toDoubleOrNull()?.toInt() ?: outline,
            plateSidePadding = XBORD.find(ass)?.groupValues?.get(1)?.toDoubleOrNull()?.toInt() ?: outline,
            marginV = parts[I_MARGIN_V].trim().toIntOrNull() ?: 20,
            extraLineSpacing = spacingOf(ass),
            fontSize = parts[I_SIZE].trim().toDoubleOrNull()?.toInt() ?: 26,
        )
    }

    /** Font family named by the style line, or null. */
    fun fontOf(ass: String): String? {
        val line = ass.lineSequence().firstOrNull { it.startsWith("Style:") } ?: return null
        val parts = line.removePrefix("Style:").trim().split(',')
        return parts.getOrNull(I_FONT)?.trim()?.takeIf { it.isNotEmpty() }
    }

    /** `&HAABBGGRR` → the AA byte (00 = opaque, FF = fully transparent). */
    private fun alphaOf(colour: String): Int {
        val hex = colour.removePrefix("&H").removePrefix("&h").trim()
        if (hex.length < 8) return 0
        return hex.substring(0, 2).toIntOrNull(16) ?: 0
    }

    // ASS has no line-spacing field, so extra space is an inserted blank line whose
    // height is its font size. This is that blank line, kept recognisable so a later
    // edit can strip it and re-apply a different amount.
    private const val ZWSP = "\u200B"
    // The optional trailing size is the restore that follows the spacer. It is
    // optional so that a track written before the restore existed still matches,
    // and can therefore be stripped and rebuilt correctly by the editor.
    private val SPACER = Regex("""\\N\{\\fs(\d+)\}$ZWSP(?:\{\\fs\d+\})?\\N""")

    /** The spacing currently baked into the dialogue lines (0 when none). */
    fun spacingOf(ass: String): Int =
        SPACER.find(ass)?.groupValues?.get(1)?.toIntOrNull() ?: 0

    /** Remove any previously inserted spacer, returning the plain `\N` form. */
    fun normalizeText(text: String): String = SPACER.replace(text, """\\N""")

    /**
     * Apply [extra] units of additional gap between the lines of one cue.
     *
     * [restoreSize] must be the style's own font size. An ASS override runs to the
     * END of the event, so `{\fs4}` for the spacer would otherwise shrink every
     * line AFTER it to 4 units — which is how the second line of every two-line
     * subtitle became invisible. The size is restored immediately after the spacer.
     */
    fun applySpacing(text: String, extra: Int, restoreSize: Int): String {
        val plain = normalizeText(text)
        if (extra <= 0) return plain
        return plain.replace("""\N""", """\N{\fs$extra}$ZWSP{\fs$restoreSize}\N""")
    }

    // A style line carries one padding value for all four sides, so the separate
    // horizontal/vertical plate sizes are expressed with libass's per-axis border
    // overrides, prepended to each dialogue event.
    private val OVERRIDE = Regex("""^\{\\xbord[\d.]+\\ybord[\d.]+\}""")
    val XBORD = Regex("""\\xbord([\d.]+)""")
    val YBORD = Regex("""\\ybord([\d.]+)""")

    /** Drop a previously prepended `{\xbord…\ybord…}` block. */
    fun stripOverride(text: String): String = OVERRIDE.replace(text, "")

    /**
     * Full text transform for one cue: clear anything a previous edit added, then
     * re-apply the line spacing and the per-axis plate padding. Idempotent, so
     * editing repeatedly never stacks overrides or spacers.
     */
    fun applyText(text: String, o: AssStyleOptions): String {
        val spaced = applySpacing(stripOverride(text), o.extraLineSpacing, o.fontSize)
        if (!o.hasPlate) return spaced
        val x = o.plateSidePadding.coerceIn(0, 100)
        val y = o.platePadding.coerceIn(0, 100)
        return """{\xbord$x\ybord$y}""" + spaced
    }

    /**
     * Rewrite [ass] with the settings in [o]: replaces the style line and re-applies
     * the line spacing to every dialogue event. Timing and text are untouched.
     */
    fun restyle(ass: String, o: AssStyleOptions, fontName: String? = null): String {
        val font = fontName ?: fontOf(ass) ?: "Arial"
        // Same line-ending discipline as shiftTimes: a document restyled ten times
        // must not have gained ten blank lines at the end.
        return ass.lineSequence().joinToString("\n") { line ->
            when {
                line.startsWith("Style:") -> styleLine(font, o)
                line.startsWith("Dialogue:") -> restyleDialogue(line, o)
                else -> line
            }
        }
    }

    /**
     * Move every dialogue line in [ass] by [deltaMs], leaving the rest of the
     * document — styles, script info, text, overrides — exactly as it was.
     *
     * This rewrites only the Start and End fields, so it is lossless in a way that
     * parsing to cues and writing the file back out would not be: a third-party ASS
     * keeps whatever styling it came with.
     */
    fun shiftTimes(ass: String, deltaMs: Long): String {
        if (deltaMs == 0L) return ass
        // joinToString("\n") over lineSequence reproduces the original line endings
        // exactly, including whether the file ended with a newline. Appending '\n'
        // per line instead would add one every time the document is rewritten.
        return ass.lineSequence().joinToString("\n") { line ->
            if (line.startsWith("Dialogue:")) shiftDialogue(line, deltaMs) else line
        }
    }

    private fun shiftDialogue(line: String, deltaMs: Long): String {
        val body = line.removePrefix("Dialogue:")
        val parts = body.split(',', limit = 10)
        if (parts.size < 10) return line
        val start = parseTime(parts[1]) ?: return line
        val end = parseTime(parts[2]) ?: return line
        val newStart = (start + deltaMs).coerceAtLeast(0L)
        val newEnd = (end + deltaMs).coerceAtLeast(newStart)
        val shifted = parts.toMutableList()
        shifted[1] = formatTime(newStart)
        shifted[2] = formatTime(newEnd)
        return "Dialogue:" + shifted.joinToString(",")
    }

    /** `H:MM:SS.cc` → milliseconds, or null when the field is not a timestamp. */
    fun parseTime(field: String): Long? {
        val s = field.trim()
        val parts = s.split(':')
        if (parts.size != 3) return null
        val h = parts[0].toLongOrNull() ?: return null
        val m = parts[1].toLongOrNull() ?: return null
        val secParts = parts[2].split('.')
        val sec = secParts[0].toLongOrNull() ?: return null
        // ASS writes centiseconds ("02.48" = 2480 ms), but pad to milliseconds so a
        // file with one or three fraction digits reads correctly too.
        val millis = secParts.getOrNull(1)
            ?.filter { it.isDigit() }?.take(3)?.padEnd(3, '0')
            ?.toLongOrNull() ?: 0L
        return ((h * 3600 + m * 60 + sec) * 1000) + millis
    }

    /** Milliseconds → the ASS `H:MM:SS.cc` form. */
    fun formatTime(ms: Long): String {
        val cs = (if (ms < 0) 0 else ms) / 10
        return "%d:%02d:%02d.%02d".format(cs / 360000, (cs / 6000) % 60, (cs / 100) % 60, cs % 100)
    }

    /** A dialogue line is 9 comma-separated fields followed by the free-form text. */
    private fun restyleDialogue(line: String, o: AssStyleOptions): String {
        val body = line.removePrefix("Dialogue:")
        val parts = body.split(',', limit = 10)
        if (parts.size < 10) return line
        return "Dialogue:" + parts.take(9).joinToString(",") + "," + applyText(parts[9], o)
    }
}
