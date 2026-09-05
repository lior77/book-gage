package com.hebsub.app.io

import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import android.graphics.pdf.PdfDocument
import android.text.Layout
import android.text.StaticLayout
import android.text.TextDirectionHeuristic
import android.text.TextDirectionHeuristics
import android.text.TextPaint
import com.hebsub.core.provider.omdb.OmdbMovie
import java.io.File

/**
 * Builds a one-file PDF of the IMDb/OMDb movie data, in English and Hebrew, with
 * the poster. Pure Android graphics — no external library. Best-effort: returns
 * false on any error so the run still completes.
 */
object MoviePdf {

    private const val W = 595   // A4 @72dpi
    private const val H = 842
    private const val M = 40f

    fun create(out: File, movie: OmdbMovie, hebrewPlot: String?, poster: File?): Boolean = runCatching {
        val doc = PdfDocument()
        val title = TextPaint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.BLACK; textSize = 20f; typeface = Typeface.DEFAULT_BOLD }
        val label = TextPaint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.rgb(90, 90, 90); textSize = 11f; typeface = Typeface.DEFAULT_BOLD }
        val body = TextPaint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.BLACK; textSize = 12f }

        val ctx = PageCtx(doc)
        ctx.newPage()

        // Poster + title block.
        var textLeft = M
        poster?.takeIf { it.exists() }?.let { p ->
            runCatching {
                val bmp = BitmapFactory.decodeFile(p.absolutePath)
                if (bmp != null) {
                    val pw = 120f
                    val ph = pw * bmp.height / bmp.width
                    ctx.canvas.drawBitmap(
                        android.graphics.Bitmap.createScaledBitmap(bmp, pw.toInt(), ph.toInt(), true),
                        M, ctx.y, null,
                    )
                    textLeft = M + pw + 16f
                }
            }
        }
        val titleTop = ctx.y
        ctx.canvas.drawText("${movie.title} (${movie.year})", textLeft, titleTop + 18f, title)
        var ty = titleTop + 40f
        fun kv(k: String, v: String) {
            if (v.isBlank() || v == "N/A") return
            ctx.canvas.drawText(k, textLeft, ty, label); ty += 14f
            ty = drawWrapped(ctx, v, body, textLeft, ty, W - textLeft - M, Layout.Alignment.ALIGN_NORMAL, TextDirectionHeuristics.LTR) + 6f
        }
        kv("Runtime", movie.runtime); kv("Genre", movie.genre); kv("Director", movie.director)
        kv("Actors", movie.actors); kv("IMDb", "${movie.imdbRating}  (${movie.imdbVotes})")
        ctx.y = maxOf(ty, titleTop + 180f)

        // English plot.
        ctx.y += 10f
        section(ctx, "Plot", label)
        ctx.y = drawWrapped(ctx, movie.plot, body, M, ctx.y, W - 2 * M, Layout.Alignment.ALIGN_NORMAL, TextDirectionHeuristics.LTR) + 16f

        // Hebrew block.
        val heLabel = TextPaint(label).apply {}
        section(ctx, "עברית", heLabel, rtl = true)
        val hePlot = hebrewPlot?.ifBlank { null } ?: movie.plot
        ctx.y = drawWrapped(ctx, hePlot, body, M, ctx.y, W - 2 * M, Layout.Alignment.ALIGN_NORMAL, TextDirectionHeuristics.RTL) + 12f
        ctx.y = drawWrapped(ctx, "שם: ${movie.title} · שנה: ${movie.year} · אורך: ${movie.runtime}", body, M, ctx.y, W - 2 * M, Layout.Alignment.ALIGN_NORMAL, TextDirectionHeuristics.RTL) + 6f

        ctx.finish()
        out.outputStream().use { doc.writeTo(it) }
        doc.close()
        out.length() > 0
    }.getOrDefault(false)

    private class PageCtx(val doc: PdfDocument) {
        var page: PdfDocument.Page? = null
        lateinit var canvas: Canvas
        var y = M
        var pageNo = 0
        fun newPage() {
            page?.let { doc.finishPage(it) }
            pageNo++
            page = doc.startPage(PdfDocument.PageInfo.Builder(W, H, pageNo).create())
            canvas = page!!.canvas
            y = M
        }
        fun finish() { page?.let { doc.finishPage(it) }; page = null }
        fun ensure(space: Float) { if (y + space > H - M) newPage() }
    }

    private fun section(ctx: PageCtx, text: String, paint: TextPaint, rtl: Boolean = false) {
        ctx.ensure(24f)
        val x = if (rtl) W - M else M
        val align = if (rtl) Paint.Align.RIGHT else Paint.Align.LEFT
        val p = TextPaint(paint).apply { textSize = 13f; textAlign = align; color = Color.rgb(30, 30, 30) }
        ctx.canvas.drawText(text, x, ctx.y + 12f, p)
        ctx.y += 22f
    }

    /** Draws wrapped text, paginating as needed; returns the new y. */
    private fun drawWrapped(
        ctx: PageCtx, text: String, paint: TextPaint,
        x: Float, startY: Float, width: Float,
        align: Layout.Alignment, dir: TextDirectionHeuristic,
    ): Float {
        if (text.isBlank() || text == "N/A") return startY
        val layout = StaticLayout.Builder.obtain(text, 0, text.length, paint, width.toInt())
            .setAlignment(align).setTextDirection(dir).setLineSpacing(2f, 1f).build()
        var y = startY
        // Draw line-by-line so we can break across pages.
        var line = 0
        while (line < layout.lineCount) {
            val top = layout.getLineTop(line)
            val bottom = layout.getLineBottom(line)
            val lh = (bottom - top).toFloat()
            if (y + lh > H - M) { ctx.newPage(); y = ctx.y }
            val start = layout.getLineStart(line)
            val end = layout.getLineEnd(line)
            val sub = text.substring(start, end).trimEnd('\n')
            val drawX = if (dir == TextDirectionHeuristics.RTL) x + width else x
            val p = TextPaint(paint).apply { textAlign = if (dir == TextDirectionHeuristics.RTL) Paint.Align.RIGHT else Paint.Align.LEFT }
            ctx.canvas.drawText(sub, drawX, y + layout.getLineBaseline(line) - top, p)
            y += lh
            line++
        }
        ctx.y = y
        return y
    }
}
