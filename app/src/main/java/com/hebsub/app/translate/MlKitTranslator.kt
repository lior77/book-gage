package com.hebsub.app.translate

import com.google.android.gms.tasks.Task
import com.google.mlkit.common.model.DownloadConditions
import com.google.mlkit.nl.translate.TranslateLanguage
import com.google.mlkit.nl.translate.Translation
import com.google.mlkit.nl.translate.TranslatorOptions
import com.hebsub.core.lang.Language
import com.hebsub.core.subtitle.SubtitleCue
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/**
 * Fully on-device translation via ML Kit (spec §12 — nothing leaves the device).
 * Downloads the language pack once, then translates every cue offline.
 *
 * ML Kit needs a concrete source language. If [translate] is called with a null
 * source, we fall back to English, which covers the majority of foreign films
 * distributed with English subtitle tracks; callers should pass the detected
 * language when they have it.
 */
class MlKitTranslator : TranslationEngine {

    override suspend fun translate(
        cues: List<SubtitleCue>,
        sourceLang: String?,
        onProgress: (Int, Int) -> Unit,
    ): List<SubtitleCue> {
        val source = mlKitLanguage(sourceLang) ?: TranslateLanguage.ENGLISH
        val options = TranslatorOptions.Builder()
            .setSourceLanguage(source)
            .setTargetLanguage(TranslateLanguage.HEBREW)
            .build()
        val translator = Translation.getClient(options)
        try {
            // Allow cellular download so the flow is not silently blocked off Wi-Fi.
            translator.downloadModelIfNeeded(DownloadConditions.Builder().build()).await()

            val total = cues.size
            val out = ArrayList<SubtitleCue>(total)
            cues.forEachIndexed { i, cue ->
                val hebrew = translator.translate(cue.text).await()
                out.add(cue.withText(hebrew))
                onProgress(i + 1, total)
            }
            return out
        } finally {
            translator.close()
        }
    }

    private fun mlKitLanguage(code: String?): String? {
        val canonical = Language.canonical(code) ?: return null
        return TranslateLanguage.fromLanguageTag(canonical)
    }
}

/** Await a Play-services [Task] without pulling in the play-services-coroutines artifact. */
private suspend fun <T> Task<T>.await(): T = suspendCancellableCoroutine { cont ->
    addOnSuccessListener { cont.resume(it) }
    addOnFailureListener { cont.resumeWithException(it) }
    addOnCanceledListener { cont.cancel() }
}
