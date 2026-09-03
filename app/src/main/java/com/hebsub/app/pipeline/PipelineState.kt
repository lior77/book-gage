package com.hebsub.app.pipeline

import com.hebsub.core.subtitle.AssStyleOptions

/**
 * What the user confirms before the run starts:
 *  - [name]/[year]: editable, default from the file name.
 *  - [imdbUrl]: optional IMDb link; when set, movie data is pulled from OMDb,
 *    embedded into the MKV, and written to a bilingual PDF (spec §2).
 *  - [subtitlePath]: a subtitle file the user chose for this video (spec §6.2).
 *  - [syncUploaded]: only meaningful with [subtitlePath] — spec §7.1 lets the user
 *    say whether that file should be aligned to the audio. Every other source keeps
 *    its own timing untouched (§7).
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
    val syncUploaded: Boolean = false,
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
