package com.hebsub.app.pipeline

import com.hebsub.core.subtitle.AssStyleOptions

/**
 * The six places Hebrew subtitles can come from, in the order they are tried.
 * The app walks this list top to bottom and stops at the first one that yields
 * cues; [number] is what the progress screen shows so the user can see exactly
 * where in the search the run currently is.
 */
enum class SourceStep(val number: String, val label: String) {
    EmbeddedHebrew("1.1", "רצועה עברית מוטמעת"),
    HashHebrew("1.2", "התאמת hash בעברית"),
    HashEnglish("1.3", "התאמת hash באנגלית"),
    ChosenFile("1.4", "קובץ כתוביות שהעליתם"),
    EmbeddedForeign("1.5", "רצועה זרה מוטמעת"),
    Transcription("1.6", "תמלול פס הקול"),
}

/** How a [SourceStep] ended (or that it has not been reached yet). */
enum class StepStatus {
    /** Not reached yet. */
    Pending,
    /** Being tried right now. */
    Running,
    /** Not applicable to this run — no such track, no key, no file chosen. */
    Skipped,
    /** Tried and came back empty. */
    NotFound,
    /** Tried and errored. */
    Failed,
    /** This is the source the run used; everything below it is left untried. */
    Used,
}

/** One row of the progress screen's source-search list. */
data class SourceStepState(
    val step: SourceStep,
    val status: StepStatus = StepStatus.Pending,
    /** Short Hebrew note shown beside the row (cue count, reason it was skipped…). */
    val detail: String? = null,
)

/**
 * What the user confirms before the run starts:
 *  - [name]/[year]: editable, default from the file name.
 *  - [imdbUrl]: optional IMDb link; when set, movie data is pulled from OMDb,
 *    embedded into the MKV, and written to a bilingual PDF (spec §2).
 *  - [subtitlePath]: a subtitle file the user chose for this video ([SourceStep.ChosenFile]).
 *    Whatever the source, its own timing is used exactly; a track that turns out to
 *    be a few seconds off is corrected by hand afterwards, in the style editor.
 *  - [styled]: spec §9 — an ASS track with a plate, or plain SRT.
 *  - [style]: the ASS look to use when [styled]; defaults to §9.1.
 *  - [saveStyleAsDefaults]: spec §10 — remember [style] for future films.
 *  - [minDisplayMs]: spec §8 — shortest time a subtitle stays up; 0 = source timing.
 *  - [deleteData]: when true, intermediate files are deleted at the end, keeping
 *    only the MKV, the PDF and the poster.
 */
data class VideoInfo(
    val name: String,
    val year: String?,
    val imdbUrl: String? = null,
    val subtitlePath: String? = null,
    val styled: Boolean = false,
    val style: AssStyleOptions = AssStyleOptions.STYLED_DEFAULT,
    val saveStyleAsDefaults: Boolean = false,
    val minDisplayMs: Long = 0L,
    val deleteData: Boolean = true,
)

/** Everything the UI needs to render, driven by the pipeline running in the service. */
sealed interface PipelineState {
    data object Idle : PipelineState

    /** [progress] is 0f..1f, or null for an indeterminate stage. */
    data class Running(val stageLabel: String, val progress: Float?) : PipelineState

    /** Before creating the folder: confirm/edit the name and the run's options. */
    data class NeedVideoInfo(val suggestedName: String) : PipelineState

    /** Hebrew subtitles written. [folder] is the video's HebSub folder, [srtName] the Hebrew .srt,
     *  [mediaName] the new MKV with the embedded Hebrew track (null if not created). */
    data class Success(val folder: String, val srtName: String, val mediaName: String? = null) : PipelineState

    data class Failed(val message: String) : PipelineState
}
