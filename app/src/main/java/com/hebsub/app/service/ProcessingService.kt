package com.hebsub.app.service

import android.app.Notification
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.Uri
import android.os.Build
import android.os.IBinder
import android.provider.OpenableColumns
import androidx.core.app.NotificationCompat
import com.hebsub.app.HebSubApp
import com.hebsub.app.R
import com.hebsub.app.asr.UnavailableAsrEngine
import com.hebsub.app.data.SettingsRepository
import com.hebsub.app.io.VideoDownloader
import com.hebsub.app.media.MediaToolFactory
import com.hebsub.app.pipeline.PipelineBus
import com.hebsub.app.pipeline.PipelineState
import com.hebsub.app.pipeline.SubtitlePipeline
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import java.io.File

/**
 * Runs the conversion in the foreground so it survives the app being backgrounded.
 * The heavy work is driven by [SubtitlePipeline]; this service only prepares the
 * input file (SAF copy or URL download) and posts progress notifications.
 */
class ProcessingService : Service() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startInForeground(getString(R.string.processing))
        val url = intent?.getStringExtra(EXTRA_URL)
        val uri = intent?.getStringExtra(EXTRA_URI)?.let(Uri::parse)

        scope.launch {
            val workDir = File(applicationContext.cacheDir, "work").apply { deleteRecursively(); mkdirs() }
            try {
            val settings = SettingsRepository(applicationContext)
            val downloader = VideoDownloader(workDir)

            val (videoFile, name) = when {
                url != null -> {
                    PipelineBus.update(PipelineState.Running("הורדת הווידאו", 0f))
                    when (val r = downloader.download(url) { p ->
                        PipelineBus.update(PipelineState.Running("הורדת הווידאו", p))
                    }) {
                        is VideoDownloader.Result.Ok -> r.file to r.file.name
                        is VideoDownloader.Result.Invalid -> {
                            PipelineBus.update(PipelineState.Failed("קישור לא תקין: ${r.reason}"))
                            return@launch
                        }
                        is VideoDownloader.Result.Failed -> {
                            PipelineBus.update(PipelineState.Failed("הורדה נכשלה: ${r.message}"))
                            return@launch
                        }
                    }
                }
                uri != null -> {
                    PipelineBus.update(PipelineState.Running("טעינת הקובץ", null))
                    val display = queryDisplayName(uri) ?: "video.mp4"
                    val dest = File(workDir, display)
                    val ok = runCatching {
                        contentResolver.openInputStream(uri)?.use { input ->
                            dest.outputStream().use { input.copyTo(it) }
                        } != null
                    }.getOrDefault(false)
                    if (!ok) {
                        PipelineBus.update(PipelineState.Failed("לא ניתן לקרוא את הקובץ שנבחר"))
                        return@launch
                    }
                    dest to display
                }
                else -> {
                    PipelineBus.update(PipelineState.Failed("לא סופק קלט"))
                    return@launch
                }
            }

            val pipeline = SubtitlePipeline(
                context = applicationContext,
                settings = settings,
                mediaTool = MediaToolFactory.create(),
                asrEngine = UnavailableAsrEngine(),
                cacheDir = workDir,
            )
            pipeline.run(videoFile, name)
            } catch (t: Throwable) {
                val detail = "${t::class.java.simpleName}: ${t.message.orEmpty()}".trim().take(300)
                PipelineBus.update(PipelineState.Failed("שגיאה — $detail"))
            } finally {
                workDir.deleteRecursively()
                stopSelfCleanly()
            }
        }
        return START_NOT_STICKY
    }

    private fun stopSelfCleanly() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) stopForeground(STOP_FOREGROUND_REMOVE)
        else @Suppress("DEPRECATION") stopForeground(true)
        stopSelf()
    }

    private fun startInForeground(text: String) {
        val notification: Notification = NotificationCompat.Builder(this, HebSubApp.NOTIFICATION_CHANNEL_ID)
            .setContentTitle(getString(R.string.app_name))
            .setContentText(text)
            .setSmallIcon(R.drawable.ic_launcher)
            .setOngoing(true)
            .build()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(NOTIF_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
            startForeground(NOTIF_ID, notification)
        }
    }

    private fun queryDisplayName(uri: Uri): String? =
        contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
            if (c.moveToFirst()) c.getString(0) else null
        }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }

    companion object {
        private const val NOTIF_ID = 42
        const val EXTRA_URL = "extra_url"
        const val EXTRA_URI = "extra_uri"

        fun startWithUri(context: Context, uri: Uri) {
            val i = Intent(context, ProcessingService::class.java).putExtra(EXTRA_URI, uri.toString())
            context.startForegroundService(i)
        }

        fun startWithUrl(context: Context, url: String) {
            val i = Intent(context, ProcessingService::class.java).putExtra(EXTRA_URL, url)
            context.startForegroundService(i)
        }
    }
}
