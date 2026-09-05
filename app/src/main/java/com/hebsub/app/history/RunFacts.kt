package com.hebsub.app.history

/**
 * The handful of facts about the current run that the history sheet needs and
 * only the pipeline knows: which of the six sources supplied the subtitles, how
 * many lines came out, what kind of track was written, how long the film is.
 *
 * A tiny mutable singleton for the same reason [RunLog][com.hebsub.app.log.RunLog]
 * is one: the run is written by the pipeline and recorded by the service that
 * owns it, one run happens at a time, and threading a result object through
 * every layer to carry four strings would cost more than it explains. [start]
 * clears it at the beginning of each run, so a value can never be carried over
 * from the previous film.
 */
object RunFacts {

    @Volatile var source: String = ""
    @Volatile var cues: Int = 0
    @Volatile var track: String = ""
    @Volatile var durationMs: Long = 0L

    fun start() {
        source = ""
        cues = 0
        track = ""
        durationMs = 0L
    }
}
