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
import com.hebsub.app.asr.DeepgramAsrEngine
import com.hebsub.app.asr.UnavailableAsrEngine
import com.hebsub.app.data.SettingsRepository
import com.hebsub.app.history.RunFacts
import com.hebsub.app.history.RunHistoryStore
import com.hebsub.app.io.VideoDownloader
import com.hebsub.app.log.RunLog
import com.hebsub.app.media.MediaToolFactory
import com.hebsub.app.pipeline.PipelineBus
import com.hebsub.app.pipeline.PipelineState
import com.hebsub.app.pipeline.SubtitlePipeline
import com.hebsub.app.provider.OpenSubtitlesService
import com.hebsub.app.storage.HebSubStorage
import com.hebsub.core.report.RunHistory
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.cancelChildren
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Runs one conversion as a foreground service, so a run of forty minutes
 * survives the screen turning off and the app being backgrounded. The heavy work
 * is [SubtitlePipeline]; this service does everything *around* it, in order:
 *
 *  1. Get the video into the app's cache — a copy of the SAF document the user
 *     picked, or a download of the link they pasted ([VideoDownloader]).
 *  2. Ask the user to confirm the run — name, year, IMDb link, a subtitle file,
 *     SRT or ASS, the style, the display floor — by suspending on
 *     [PipelineBus.awaitVideoInfo] until the overlay in `MainActivity` answers.
 *  3. If an IMDb link and an OMDb key are present, fetch the record *first*, so
 *     the folder and the files can carry the canonical `<title>-<year>` name.
 *  4. Move the video into `HebSub/<name>-<year>/` ([HebSubStorage.placeVideo]).
 *  5. Build the pipeline with the tools this device has — the FFmpeg-backed
 *     [MediaToolFactory] tool or its no-op stand-in, Deepgram or the unavailable
 *     engine — and run it.
 *  6. In `finally`, always: write the run log into the movie's folder (or the
 *     work dir if the folder was never created), delete the cache, stop.
 *
 * Cancellation (§5) arrives as an intent with [ACTION_CANCEL] and cancels the
 * coroutine scope; partial files stay in the folder on purpose. Every failure
 * path ends in a [PipelineState.Failed] with a Hebrew sentence the overlay can
 * show as-is.
 */
class ProcessingService : Service() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // §5 — the progress screen can stop a run in flight. Cancelling the scope
        // unwinds whatever stage is running; the partial files stay in the movie's
        // folder for the user to look at, which is why nothing is deleted here.
        if (intent?.action == ACTION_CANCEL) {
            RunLog.log("run cancelled by the user")
            scope.coroutineContext.cancelChildren()
            PipelineBus.update(PipelineState.Idle)
            stopSelfCleanly()
            return START_NOT_STICKY
        }
        startInForeground(getString(R.string.processing))
        val url = intent?.getStringExtra(EXTRA_URL)
        val uri = intent?.getStringExtra(EXTRA_URI)?.let(Uri::parse)

        scope.launch {
            val workDir = File(applicationContext.cacheDir, "work").apply { deleteRecursively(); mkdirs() }
            val storage = HebSubStorage(applicationContext)
            var logDir: File = workDir   // where the run log is finally written (§ב.6)
            RunLog.start()
            RunFacts.start()
            PipelineBus.resetSteps()
            RunLog.header(applicationContext)
            RunLog.log("input=${if (url != null) "URL" else "file"}")

            // Everything the history sheet needs, filled in as the run learns it,
            // and read back in `finally` whichever way the run ends.
            var history = RunHistory.Entry(date = "", title = "")
            var confirmed = false
            try {
            // §א.2/§ב.1 — we need All-files access to build the HebSub folder tree.
            if (!storage.hasAllFilesAccess()) {
                RunLog.error("missing all-files access")
                PipelineBus.update(PipelineState.Failed("חסרה הרשאת גישה לכל הקבצים. פתחו את ההגדרות ואשרו את ההרשאה."))
                return@launch
            }
            val root = storage.ensureRoot()
            RunLog.log("HebSub root=${root.absolutePath} exists=${root.exists()}")

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

            // Identify the film by its own bytes before anything else happens, and
            // look it up in the history. Two hours of work deserve the warning that
            // this exact file has been through the app before — and the hash means
            // a renamed or moved copy is still recognised.
            history = history.copy(
                fileName = name,
                sizeMb = (videoFile.length() / 1_000_000).toString(),
                hash = runCatching { OpenSubtitlesService.computeMovieHash(videoFile) }.getOrNull().orEmpty(),
            )
            val previous = RunHistoryStore(applicationContext).find(history.key)
            if (previous != null) {
                RunLog.log("history: this file ran before on ${previous.date} — ${previous.status.label} ('${previous.title}')")
            }

            // §2 — before creating the folder, let the user confirm/edit the name
            // and optionally enter the year.
            val suggested = name.substringBeforeLast('.').ifBlank { name }
            val info = PipelineBus.awaitVideoInfo(suggested, previous) ?: run {
                // §5 — the user backed out of the pre-run screen. Nothing was written
                // to HebSub yet, so there is nothing to undo; just stand down.
                RunLog.log("cancelled before the run started")
                PipelineBus.update(PipelineState.Idle)
                return@launch
            }
            confirmed = true
            val ext = name.substringAfterLast('.', "mp4").ifBlank { "mp4" }

            // §2.2 — if an IMDb link + OMDb key are present, fetch the record BEFORE
            // creating the folder so the folder/files get the canonical name+year.
            val imdbId = com.hebsub.core.provider.omdb.Omdb.imdbId(info.imdbUrl)
            val movie = if (imdbId != null && settings.hasOmdbKey) {
                PipelineBus.update(PipelineState.Running("שליפת נתוני הסרט מ‑IMDb", null))
                com.hebsub.app.provider.OmdbService(settings.omdbApiKey).fetch(imdbId)
            } else null
            if (imdbId != null && movie == null && settings.hasOmdbKey) RunLog.log("OMDb: no data for $imdbId")

            val typedName = storage.sanitize(info.name.ifBlank { suggested })
            val typedYear = info.year?.filter { it.isDigit() }?.take(4)
            // Prefer the canonical OMDb title/year for naming when available.
            val cleanName = movie?.title?.takeIf { it.isNotBlank() && it != "N/A" }?.let { storage.sanitize(it) } ?: typedName
            val yr = movie?.year?.filter { it.isDigit() }?.take(4)?.ifBlank { null } ?: typedYear
            val folderName = if (!yr.isNullOrBlank()) "$cleanName-$yr" else cleanName
            RunLog.log("naming: name='$cleanName' year='${yr ?: "-"}' folder='$folderName' fromOmdb=${movie != null}")
            history = history.copy(title = cleanName, year = yr.orEmpty(), imdb = imdbId.orEmpty())

            // §2.1/§2.3 — folder + video share the confirmed name.
            PipelineBus.update(PipelineState.Running("הכנת תיקיית הוידאו", null))
            val placed = storage.placeVideo(videoFile, folderName, "$folderName.$ext")
            logDir = placed.dir
            RunLog.log("video folder=${placed.dir.absolutePath} video=${placed.video.name}")

            val pipeline = SubtitlePipeline(
                context = applicationContext,
                settings = settings,
                mediaTool = MediaToolFactory.create(),
                asrEngine = if (settings.hasDeepgramKey) DeepgramAsrEngine(settings.deepgramApiKey)
                            else UnavailableAsrEngine(),
                outputDir = placed.dir,
            )
            // §10 — the user can make this film's look the default for the next ones.
            if (info.saveStyleAsDefaults) {
                settings.assDefaults = info.style
                settings.minDisplayMs = info.minDisplayMs
                RunLog.log("saved ASS defaults: ${info.style.serialize()} minDisplayMs=${info.minDisplayMs}")
            }
            pipeline.run(
                videoFile = placed.video,
                base = placed.base,
                year = yr,
                imdbId = imdbId,
                movie = movie,
                options = SubtitlePipeline.RunOptions(
                    subtitlePath = info.subtitlePath,
                    styled = info.styled,
                    style = info.style,
                    minDisplayMs = info.minDisplayMs,
                    deleteData = info.deleteData,
                ),
            )
            } catch (t: Throwable) {
                RunLog.error("service failed", t)
                val detail = "${t::class.java.simpleName}: ${t.message.orEmpty()}".trim().take(300)
                PipelineBus.update(PipelineState.Failed("שגיאה — $detail"))
            } finally {
                withContext(NonCancellable) {
                    // §2.3/§ב.6 — the log shares the folder name and is written into the
                    // film's folder. A run that failed BEFORE that folder existed used to
                    // write its log into the cache directory that the next line deletes,
                    // so precisely the failures worth diagnosing left no trace at all.
                    // Those go to the HebSub root instead, stamped with the time.
                    runCatching {
                        val target =
                            if (logDir == workDir) File(storage.ensureRoot(), "HebSub-run-${stamp()}.txt")
                            else File(logDir, "${logDir.name}.txt")
                        target.writeText(RunLog.dump(), Charsets.UTF_8)
                    }
                    // Only once the user actually confirmed the run: a file they
                    // backed out of was never processed and does not belong in the
                    // history. Best-effort, like the log — a spreadsheet must not be
                    // able to fail a run that already finished.
                    if (confirmed) runCatching { recordHistory(history) }
                }
                workDir.deleteRecursively()
                stopSelfCleanly()
            }
        }
        return START_NOT_STICKY
    }

    /**
     * Write this run into `HebSub/HebSub-history.xlsx`, whichever way it ended.
     * The outcome is read from the state the run left behind — the same value the
     * screen is showing — so success, failure and cancellation are recorded
     * without the pipeline having to report anything twice.
     */
    private fun recordHistory(base: RunHistory.Entry) {
        val state = PipelineBus.state.value
        val issues = (state as? PipelineState.Success)?.issues.orEmpty()
        val status = when (state) {
            is PipelineState.Success -> RunHistory.Status.SUCCESS
            is PipelineState.Failed -> RunHistory.Status.FAILED
            else -> RunHistory.Status.CANCELLED
        }
        val note = when {
            state is PipelineState.Failed -> state.message.replace('\n', ' ').trim().take(300)
            issues.isNotEmpty() -> issues.joinToString(" · ").take(300)
            else -> ""
        }
        val version = runCatching {
            packageManager.getPackageInfo(packageName, 0).versionName
        }.getOrNull().orEmpty()
        RunHistoryStore(applicationContext).record(
            base.copy(
                date = SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.US).format(Date()),
                title = base.title.ifBlank { base.fileName },
                durationMin = if (RunFacts.durationMs > 0) (RunFacts.durationMs / 60_000).toString() else "",
                source = RunFacts.source,
                cues = if (RunFacts.cues > 0) RunFacts.cues.toString() else "",
                track = RunFacts.track,
                status = status,
                issues = if (status == RunHistory.Status.SUCCESS) issues.size.toString() else "",
                note = note,
                appVersion = version,
            )
        )
    }

    private fun stamp(): String = SimpleDateFormat("yyyyMMdd-HHmmss", Locale.US).format(Date())

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
        private const val ACTION_CANCEL = "com.hebsub.app.CANCEL"

        /** Stop a run in progress (§5). Safe to call when nothing is running. */
        fun cancel(context: Context) {
            val i = Intent(context, ProcessingService::class.java).setAction(ACTION_CANCEL)
            runCatching { context.startService(i) }
        }

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
