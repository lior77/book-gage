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
    /** Padding around the text inside the plate (ASS `Outline` with BorderStyle 3). */
    val platePadding: Int = 4,
    /** Distance of the subtitles from the bottom edge of the frame (ASS `MarginV`). */
    val marginV: Int = 20,
    /** Extra gap between two subtitle lines; 0 = the font's natural line height. */
    val extraLineSpacing: Int = 0,
    val fontSize: Int = 26,
) {
    val hasPlate: Boolean get() = bgTransparencyPercent < 100
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

    private const val PLATE_RGB = "303030"          // dark grey, as BBGGRR
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
        return AssStyleOptions(
            bgTransparencyPercent = transparency.coerceIn(0, 100),
            platePadding = parts[I_OUTLINE].trim().toDoubleOrNull()?.toInt() ?: 4,
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
    private val SPACER = Regex("""\\N\{\\fs(\d+)\}$ZWSP\\N""")

    /** The spacing currently baked into the dialogue lines (0 when none). */
    fun spacingOf(ass: String): Int =
        SPACER.find(ass)?.groupValues?.get(1)?.toIntOrNull() ?: 0

    /** Remove any previously inserted spacer, returning the plain `\N` form. */
    fun normalizeText(text: String): String = SPACER.replace(text, """\\N""")

    /** Apply [extra] units of additional gap between the lines of one cue. */
    fun applySpacing(text: String, extra: Int): String {
        val plain = normalizeText(text)
        if (extra <= 0) return plain
        return plain.replace("""\N""", """\N{\fs$extra}$ZWSP\N""")
    }

    /**
     * Rewrite [ass] with the settings in [o]: replaces the style line and re-applies
     * the line spacing to every dialogue event. Timing and text are untouched.
     */
    fun restyle(ass: String, o: AssStyleOptions, fontName: String? = null): String {
        val font = fontName ?: fontOf(ass) ?: "Arial"
        val out = StringBuilder(ass.length + 64)
        for (line in ass.lineSequence()) {
            when {
                line.startsWith("Style:") -> out.append(styleLine(font, o))
                line.startsWith("Dialogue:") -> out.append(restyleDialogue(line, o.extraLineSpacing))
                else -> out.append(line)
            }
            out.append('\n')
        }
        return out.toString()
    }

    /** A dialogue line is 9 comma-separated fields followed by the free-form text. */
    private fun restyleDialogue(line: String, extra: Int): String {
        val body = line.removePrefix("Dialogue:")
        val parts = body.split(',', limit = 10)
        if (parts.size < 10) return line
        val text = applySpacing(parts[9], extra)
        return "Dialogue:" + parts.take(9).joinToString(",") + "," + text
    }
}
