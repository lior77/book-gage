package com.hebsub.core.pipeline

import com.hebsub.core.lang.Language

/**
 * Describes a subtitle track embedded in the media container, as reported by
 * ffprobe. [index] is the ffmpeg stream index; [language] is its declared tag.
 */
data class EmbeddedSubtitle(
    val index: Int,
    val language: String?,
    val title: String? = null,
    val forced: Boolean = false,
)

/**
 * One concrete way to obtain subtitles, in priority order. Steps flagged
 * [readyHebrew] yield Hebrew text directly (no translation). The rest yield
 * source-language text that must then be translated to Hebrew.
 */
sealed interface AcquisitionStep {
    val readyHebrew: Boolean get() = false

    /** A Hebrew subtitle track already inside the file — best case, no cost. */
    data class EmbeddedHebrew(val index: Int) : AcquisitionStep {
        override val readyHebrew get() = true
    }

    /** A ready-made Hebrew subtitle to fetch online. */
    data object OnlineHebrew : AcquisitionStep {
        override val readyHebrew get() = true
    }

    /** A non-Hebrew subtitle inside the file, to be translated. */
    data class EmbeddedSource(val index: Int, val language: String?) : AcquisitionStep

    /** Non-Hebrew subtitles to fetch online, to be translated.
     *  [preferredLanguages] are tried first (source language), then any other. */
    data class OnlineSource(val preferredLanguages: List<String>) : AcquisitionStep

    /** Last resort: transcribe the audio track with on-device ASR, then translate.
     *  Requires explicit user consent at run time. */
    data object Transcribe : AcquisitionStep
}

/**
 * Builds the ordered acquisition plan the executor walks top-to-bottom until a
 * step succeeds. Pure function of the inputs — no I/O, no side effects.
 *
 * Priority (product spec, in order):
 *   2. Embedded Hebrew track already in the file → done, no work.
 *   3. Online Hebrew from a leading subtitle site.
 *   4. Online source-language subs, else online any-other-language (to translate).
 *   5. Embedded non-Hebrew track in the file (source language first, to translate).
 *   6. Transcribe the audio track (ASR) as a last resort.
 *
 * Note the ordering: the network is tried before extracting from the file, and
 * both are tried before falling back to audio transcription.
 */
object SubtitleSourcePlanner {

    fun plan(
        embedded: List<EmbeddedSubtitle>,
        audioLanguage: String?,
        onlineEnabled: Boolean,
    ): List<AcquisitionStep> {
        val steps = ArrayList<AcquisitionStep>()
        val sourceLang = Language.canonical(audioLanguage)

        val hebrewTracks = embedded.filter { Language.isHebrew(it.language) }
        val nonHebrewTracks = embedded.filterNot { Language.isHebrew(it.language) }

        // 2. Embedded Hebrew — prefer a non-forced full track over a forced one.
        hebrewTracks
            .sortedBy { it.forced }
            .forEach { steps.add(AcquisitionStep.EmbeddedHebrew(it.index)) }

        // 3. Online Hebrew.
        if (onlineEnabled) steps.add(AcquisitionStep.OnlineHebrew)

        // 4. Online non-Hebrew, source language preferred (executor also tries any other).
        if (onlineEnabled) {
            val preferred = buildList { sourceLang?.let { if (it != Language.HEBREW) add(it) } }
            steps.add(AcquisitionStep.OnlineSource(preferred))
        }

        // 5. Embedded non-Hebrew, source language first, then the rest in order.
        nonHebrewTracks
            .sortedByDescending { sourceLang != null && Language.canonical(it.language) == sourceLang }
            .forEach { steps.add(AcquisitionStep.EmbeddedSource(it.index, it.language)) }

        // 6. Transcribe audio (needs user consent when reached).
        steps.add(AcquisitionStep.Transcribe)

        return steps
    }
}
