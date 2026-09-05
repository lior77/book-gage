package com.hebsub.app.media

/**
 * Returns the FFmpeg-backed [MediaTool] when the `withFfmpeg` variant is built
 * (the class is present on the classpath), otherwise the [NoOpMediaTool]. Uses
 * reflection so the default build has no compile-time dependency on FFmpegKit.
 */
object MediaToolFactory {
    fun create(): MediaTool = try {
        // Force the FFmpeg native library to load; if it can't (missing .so,
        // ABI/16KB mismatch, …) this throws and we degrade to NoOp instead of
        // crashing later on the first probe/extract call.
        Class.forName("com.arthenica.ffmpegkit.FFmpegKitConfig")
            .getMethod("getVersion")
            .invoke(null)
        Class.forName("com.hebsub.app.media.FfmpegMediaTool")
            .getDeclaredConstructor()
            .newInstance() as MediaTool
    } catch (_: Throwable) {
        NoOpMediaTool()
    }
}
