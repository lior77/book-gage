package com.hebsub.app.media

/**
 * Returns the FFmpeg-backed [MediaTool] when the `withFfmpeg` variant is built
 * (the class is present on the classpath), otherwise the [NoOpMediaTool]. Uses
 * reflection so the default build has no compile-time dependency on FFmpegKit.
 */
object MediaToolFactory {
    fun create(): MediaTool = try {
        Class.forName("com.hebsub.app.media.FfmpegMediaTool")
            .getDeclaredConstructor()
            .newInstance() as MediaTool
    } catch (_: Throwable) {
        NoOpMediaTool()
    }
}
