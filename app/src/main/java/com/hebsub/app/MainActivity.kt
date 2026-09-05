package com.hebsub.app

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.DocumentsContract
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.enableEdgeToEdge
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.hebsub.app.storage.HebSubStorage
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.hebsub.app.data.SettingsRepository
import com.hebsub.app.edit.AssEditor
import com.hebsub.app.enrich.MovieDataTool
import com.hebsub.app.media.MediaToolFactory
import com.hebsub.core.subtitle.AssStyleOptions
import com.hebsub.app.log.RunLog
import com.hebsub.app.net.ConnectionTester
import androidx.compose.ui.text.input.KeyboardType
import com.hebsub.app.pipeline.PipelineBus
import com.hebsub.app.pipeline.PipelineState
import com.hebsub.app.pipeline.SourceStepState
import com.hebsub.app.pipeline.StepStatus
import com.hebsub.app.pipeline.VideoInfo
import com.hebsub.app.service.ProcessingService
import com.hebsub.app.ui.HebSubTheme
import com.hebsub.core.provider.claude.ClaudeApi
import com.hebsub.core.report.RunHistory
import kotlinx.coroutines.launch

/**
 * The whole user interface, in one file, in Jetpack Compose.
 *
 * **Navigation** is a single `Screen` value held in [AppRoot]; there is no
 * navigation library because there are six screens and no deep links. Every
 * screen is wrapped in [HebSubScreen], which supplies the title, the optional
 * settings gear, and the two exit buttons the spec requires on every screen
 * (§5: home, and close the app).
 *
 * **Screens**, in the order a first-time user meets them:
 *  - [OnboardingScreen] — the two permissions the app cannot work without
 *    (All-files access for the HebSub folder; notifications for the foreground
 *    service). Shown once; `SettingsRepository.onboardingComplete` remembers it.
 *  - [ModeScreen] — the home screen: the three things the app does (§3).
 *  - [HomeScreen] — "add Hebrew subtitles": pick a video or paste a link. Both
 *    hand off to [ProcessingService]; nothing heavy runs in the Activity.
 *  - [EditAssScreen] — restyle and/or shift an existing Hebrew track ([AssEditor]),
 *    with a preview frame rendered on the real film.
 *  - [AddDataScreen] — IMDb link → PDF, poster, names, metadata ([MovieDataTool]).
 *  - [SettingsScreen] — the four API keys with a live connection test each, the
 *    Claude model, and backup/restore of the keys to `HebSub/HebSub-keys.json`.
 *
 * **The run itself is not a screen.** [PipelineOverlay] is a modal drawn on top
 * of whatever screen is showing, driven by `PipelineBus.state`:
 *  - `Running` — stage label, progress bar, the six-source list ([StepRow]) and
 *    the live log tail, plus a cancel button;
 *  - `NeedVideoInfo` — the pre-run form (name, year, IMDb, subtitle file, SRT/ASS,
 *    style, display floor, delete intermediates); its confirm button completes
 *    the `CompletableDeferred` the service is suspended on;
 *  - `Success` — where the files are, the issues list, and the three next steps;
 *  - `Failed` — the message and where the log is.
 * Because the state lives in the bus and not in the Activity, rotating the phone
 * or leaving and returning shows the same overlay at the same point.
 *
 * Layout is right-to-left throughout (Hebrew UI); the few places that show
 * file names or log lines switch back to LTR locally so paths read correctly.
 * Strings live in `res/values/strings.xml`; the handful of literals in this file
 * are the newest messages and should move there when next touched.
 */
class MainActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Draw behind the status bar and the gesture area; every screen keeps its
        // content clear of them with safeDrawingPadding (spec §4).
        enableEdgeToEdge()
        setContent {
            // Hebrew UI is right-to-left throughout.
            CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Rtl) {
                HebSubTheme { AppRoot() }
            }
        }
    }
}

/** The screens, as a plain enum: the current one is a single `remember`ed value in [AppRoot]. */
private enum class Screen { Onboarding, Mode, Home, Settings, EditAss, AddData }

/** Fixed name of the keys-backup file inside the HebSub folder (§4.1). */
private const val KEYS_FILE_NAME = "HebSub-keys.json"

/**
 * Root of the composition: owns the current [Screen], observes the pipeline
 * state, and draws [PipelineOverlay] above every screen. Also owns the picker
 * used by "process another video" on the success dialog, so a new run can start
 * from the overlay itself without going back through [HomeScreen].
 */
@Composable
private fun AppRoot() {
    val context = LocalContext.current
    val settings = remember { SettingsRepository(context) }
    var screen by remember {
        mutableStateOf(if (settings.onboardingComplete) Screen.Mode else Screen.Onboarding)
    }
    val pipelineState by PipelineBus.state.collectAsStateWithLifecycle()

    // Picker used by the "process another video" button on the success screen.
    val newVideoPicker = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenDocument(),
    ) { uri ->
        if (uri != null) {
            runCatching {
                context.contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            ProcessingService.startWithUri(context, uri)
        }
    }

    Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        when (screen) {
            Screen.Onboarding -> OnboardingScreen {
                settings.onboardingComplete = true
                screen = Screen.Mode
            }
            Screen.Mode -> ModeScreen(
                onAddSubtitles = { screen = Screen.Home },
                onEditAss = { screen = Screen.EditAss },
                onAddData = { screen = Screen.AddData },
                onOpenSettings = { screen = Screen.Settings },
            )
            Screen.Home -> HomeScreen(
                onOpenSettings = { screen = Screen.Settings },
                onHome = { screen = Screen.Mode },
            )
            Screen.Settings -> SettingsScreen(settings) { screen = Screen.Mode }
            Screen.EditAss -> EditAssScreen(onHome = { screen = Screen.Mode })
            Screen.AddData -> AddDataScreen(onHome = { screen = Screen.Mode })
        }
    }

    // Overlays for progress and decisions, on top of any screen.
    PipelineOverlay(
        pipelineState,
        onNewVideo = { PipelineBus.reset(); screen = Screen.Home; newVideoPicker.launch(arrayOf("video/*")) },
    )
}

/**
 * First launch: the permissions without which nothing works. All-files access
 * (MANAGE_EXTERNAL_STORAGE) is what lets the app create `HebSub/` at the root of
 * shared storage and move the user's video into it; notifications are required
 * for the foreground service on Android 13+. Both are granted in system Settings
 * screens, so the state is re-read on every resume.
 */
@Composable
private fun OnboardingScreen(onDone: () -> Unit) {
    val context = LocalContext.current
    val storage = remember { HebSubStorage(context) }

    fun notifOk(): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    var filesOk by remember { mutableStateOf(storage.hasAllFilesAccess()) }
    var notifGranted by remember { mutableStateOf(notifOk()) }

    // Re-check when returning from the system Settings screens.
    val lifecycleOwner = LocalLifecycleOwner.current
    DisposableEffect(lifecycleOwner) {
        val obs = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) {
                filesOk = storage.hasAllFilesAccess()
                notifGranted = notifOk()
            }
        }
        lifecycleOwner.lifecycle.addObserver(obs)
        onDispose { lifecycleOwner.lifecycle.removeObserver(obs) }
    }

    val notifLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted -> notifGranted = granted }

    val filesLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.StartActivityForResult(),
    ) { filesOk = storage.hasAllFilesAccess() }

    val legacyStorageLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted -> filesOk = granted }

    fun requestFiles() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val intent = runCatching {
                Intent(
                    Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION,
                    Uri.fromParts("package", context.packageName, null),
                )
            }.getOrElse { Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION) }
            runCatching { filesLauncher.launch(intent) }
                .onFailure { filesLauncher.launch(Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION)) }
        } else {
            legacyStorageLauncher.launch(Manifest.permission.WRITE_EXTERNAL_STORAGE)
        }
    }

    // No home to go back to until the permissions are granted, so the frame offers
    // only the way out of the app (§5).
    HebSubScreen(title = stringResource(R.string.onboarding_title), onHome = null) {
        Text(stringResource(R.string.onboarding_body), style = MaterialTheme.typography.bodyLarge)

        PermissionRow(
            title = stringResource(R.string.perm_files_title),
            body = stringResource(R.string.perm_files_body),
            granted = filesOk,
            onGrant = { requestFiles() },
        )
        PermissionRow(
            title = stringResource(R.string.perm_notif_title),
            body = stringResource(R.string.perm_notif_body),
            granted = notifGranted,
            onGrant = {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU)
                    notifLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
            },
        )

        Button(
            onClick = onDone,
            enabled = filesOk,
            modifier = Modifier.fillMaxWidth(),
        ) { Text(stringResource(R.string.grant_permissions)) }
        if (!filesOk) {
            Text(stringResource(R.string.perm_files_required), style = MaterialTheme.typography.bodySmall)
        }
    }
}

@Composable
private fun PermissionRow(title: String, body: String, granted: Boolean, onGrant: () -> Unit) {
    val okColor = Color(0xFF2E7D32)
    Column(
        Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Text(title, style = MaterialTheme.typography.titleSmall)
            if (granted) Text("✓ אושר", color = okColor, style = MaterialTheme.typography.labelLarge)
            else Button(onClick = onGrant) { Text(stringResource(R.string.perm_grant)) }
        }
        Text(body, style = MaterialTheme.typography.bodySmall)
    }
}

/**
 * The frame every screen sits in: a title bar (with the settings gear where it
 * belongs) and, at the bottom, the two ways out that §5 asks for on every screen —
 * back to the home screen, or close the app. [onHome] is null on the home screen
 * itself, which only offers the close button.
 */
/**
 * The frame every screen sits in: title row (with the settings gear when
 * [onOpenSettings] is given), scrollable content, and the exit bar pinned to the
 * bottom — "home" (absent on the home screen itself) and "close the app". §5 of
 * the spec: there is a way out of every screen, within thumb reach.
 * [exitEnabled] is false while a screen is busy rewriting a file.
 */
@Composable
private fun HebSubScreen(
    title: String,
    onHome: (() -> Unit)?,
    onOpenSettings: (() -> Unit)? = null,
    exitEnabled: Boolean = true,
    content: @Composable ColumnScope.() -> Unit,
) {
    val activity = LocalContext.current.findActivity()
    Column(Modifier.fillMaxSize().safeDrawingPadding()) {
        Column(
            modifier = Modifier.weight(1f).fillMaxWidth()
                .padding(horizontal = 20.dp).padding(top = 20.dp)
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            // Title on the right (RTL start); weight(1f) reserves room so a long
            // title can never push the gear off the opposite corner.
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text(title, style = MaterialTheme.typography.headlineSmall, maxLines = 2, modifier = Modifier.weight(1f))
                if (onOpenSettings != null) {
                    IconButton(onClick = onOpenSettings) {
                        Icon(Icons.Filled.Settings, contentDescription = stringResource(R.string.settings))
                    }
                }
            }
            content()
            Spacer(Modifier.height(8.dp))
        }
        // The way out, pinned within thumb reach at the bottom of every screen.
        HorizontalDivider()
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 12.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            if (onHome != null) {
                OutlinedButton(onClick = onHome, enabled = exitEnabled, modifier = Modifier.weight(1f).heightIn(min = 48.dp)) {
                    Text(stringResource(R.string.go_home))
                }
            }
            OutlinedButton(
                onClick = { activity?.finishAffinity() },
                enabled = exitEnabled,
                modifier = Modifier.weight(1f).heightIn(min = 48.dp),
            ) { Text(stringResource(R.string.exit_app)) }
        }
    }
}

/** A big primary action with its explanation underneath — the home screen's unit. */
@Composable
private fun ModeCard(title: String, hint: String, primary: Boolean, onClick: () -> Unit) {
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        if (primary) {
            Button(onClick = onClick, modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp)) { Text(title) }
        } else {
            OutlinedButton(onClick = onClick, modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp)) { Text(title) }
        }
        Text(hint, style = MaterialTheme.typography.bodySmall)
    }
}

/** The home screen: the three things this app does (§3). */
@Composable
private fun ModeScreen(
    onAddSubtitles: () -> Unit,
    onEditAss: () -> Unit,
    onAddData: () -> Unit,
    onOpenSettings: () -> Unit,
) {
    HebSubScreen(
        title = stringResource(R.string.home_title),
        onHome = null,                       // this IS the home screen
        onOpenSettings = onOpenSettings,
    ) {
        Text(stringResource(R.string.mode_prompt), style = MaterialTheme.typography.bodyMedium)
        Spacer(Modifier.height(4.dp))
        ModeCard(stringResource(R.string.mode_add_subs), stringResource(R.string.mode_add_subs_hint), true, onAddSubtitles)
        ModeCard(stringResource(R.string.mode_edit_ass), stringResource(R.string.mode_edit_ass_hint), false, onEditAss)
        ModeCard(stringResource(R.string.mode_add_data), stringResource(R.string.mode_add_data_hint), false, onAddData)
    }
}

/**
 * "Add Hebrew subtitles": a video from the device (SAF picker) or a download
 * link. Either way the Activity only starts [ProcessingService] and gets out of
 * the way; everything after that is reported through `PipelineBus` and shown by
 * [PipelineOverlay].
 */
@Composable
private fun HomeScreen(onOpenSettings: () -> Unit, onHome: () -> Unit) {
    val context = LocalContext.current
    var link by remember { mutableStateOf("") }

    val filePicker = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenDocument(),
    ) { uri ->
        if (uri != null) {
            runCatching {
                context.contentResolver.takePersistableUriPermission(
                    uri, Intent.FLAG_GRANT_READ_URI_PERMISSION,
                )
            }
            ProcessingService.startWithUri(context, uri)
        }
    }

    HebSubScreen(
        title = stringResource(R.string.mode_add_subs),
        onHome = onHome,
        onOpenSettings = onOpenSettings,
    ) {
        Text(stringResource(R.string.home_subtitle), style = MaterialTheme.typography.bodyMedium)

        Spacer(Modifier.height(4.dp))
        Button(
            onClick = { filePicker.launch(arrayOf("video/*")) },
            modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp),
        ) { Text(stringResource(R.string.pick_file)) }

        HorizontalDivider()

        OutlinedTextField(
            value = link,
            onValueChange = { link = it },
            label = { Text(stringResource(R.string.link_hint)) },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        Button(
            onClick = { if (link.isNotBlank()) ProcessingService.startWithUrl(context, link.trim()) },
            enabled = link.isNotBlank(),
            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
        ) { Text(stringResource(R.string.paste_link) + " — " + stringResource(R.string.start)) }
    }
}

/**
 * §3.3 — pick a film already in HebSub, give its IMDb link, and get the PDF, the
 * poster, canonical names and the data written into the container. The subtitle
 * track is not touched, which the screen says out loud.
 */
@Composable
private fun AddDataScreen(onHome: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val tool = remember { MovieDataTool(context, SettingsRepository(context), MediaToolFactory.create()) }

    var targets by remember { mutableStateOf<List<MovieDataTool.Target>>(emptyList()) }
    var chosen by remember { mutableStateOf<MovieDataTool.Target?>(null) }
    var imdb by remember { mutableStateOf("") }
    var stage by remember { mutableStateOf<String?>(null) }
    var result by remember { mutableStateOf<MovieDataTool.Result?>(null) }
    var message by remember { mutableStateOf<String?>(null) }
    val busy = stage != null

    LaunchedEffect(Unit) { targets = tool.findTargets() }

    HebSubScreen(title = stringResource(R.string.data_title), onHome = onHome, exitEnabled = !busy) {
        val current = chosen
        if (current == null) {
            Text(stringResource(R.string.data_pick_movie), style = MaterialTheme.typography.bodyMedium)
            if (targets.isEmpty()) Text(stringResource(R.string.data_none), style = MaterialTheme.typography.bodySmall)
            targets.forEach { t ->
                OutlinedButton(
                    onClick = { chosen = t; result = null; message = null },
                    modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
                ) { Text(t.title) }
            }
        } else {
            Text(current.title, style = MaterialTheme.typography.titleMedium)
            OutlinedTextField(
                value = imdb, onValueChange = { imdb = it },
                label = { Text(stringResource(R.string.data_imdb)) },
                singleLine = true, enabled = !busy, modifier = Modifier.fillMaxWidth(),
            )
            Text(stringResource(R.string.data_imdb_hint), style = MaterialTheme.typography.bodySmall)
            Text(stringResource(R.string.data_note), style = MaterialTheme.typography.bodySmall)

            if (busy) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    CircularProgressIndicator(modifier = Modifier.size(20.dp), strokeWidth = 2.dp)
                    Text(stage.orEmpty(), style = MaterialTheme.typography.bodySmall)
                }
            }

            Button(
                onClick = {
                    stage = ""; message = null; result = null
                    scope.launch {
                        when (val out = tool.apply(current, imdb.trim()) { s -> stage = s }) {
                            is MovieDataTool.Outcome.Ok -> {
                                result = out.result
                                targets = tool.findTargets()
                                chosen = null
                            }
                            is MovieDataTool.Outcome.Failed -> message = out.reason
                        }
                        stage = null
                    }
                },
                enabled = !busy && imdb.isNotBlank(),
                modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
            ) { Text(stringResource(R.string.data_apply)) }

            OutlinedButton(
                onClick = { chosen = null; message = null },
                enabled = !busy,
                modifier = Modifier.fillMaxWidth(),
            ) { Text(stringResource(R.string.data_pick_other)) }
        }

        result?.let { r ->
            HorizontalDivider()
            Text(stringResource(R.string.data_done, r.folder.name), style = MaterialTheme.typography.titleSmall)
            if (r.pdf != null) Bullet(stringResource(R.string.data_out_pdf))
            if (r.poster != null) Bullet(stringResource(R.string.data_out_poster))
            if (r.embedded) Bullet(stringResource(R.string.data_out_embedded))
            if (r.renamed) Bullet(stringResource(R.string.data_out_renamed))
        }
        message?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.error) }
    }
}

/**
 * §1.2 — restyle the Hebrew track of a movie HebSub already produced: pick the
 * movie, adjust the four display settings, and rebuild the MKV in place.
 */
/**
 * "Edit the subtitle look": pick a film HebSub already produced, change the
 * plate/font/margins ([StyleSliders]) and the manual sync offset
 * ([OffsetControls]), preview one frame, then rebuild the MKV with the track
 * restyled and nothing re-translated. The work is done by [AssEditor]; this
 * screen holds the editable state and disables its exits while a rebuild runs.
 */
@Composable
private fun EditAssScreen(onHome: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val editor = remember { AssEditor(context, MediaToolFactory.create()) }
    val settings = remember { SettingsRepository(context) }

    var targets by remember { mutableStateOf<List<AssEditor.Target>>(emptyList()) }
    var loaded by remember { mutableStateOf<AssEditor.Loaded?>(null) }
    var busy by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<String?>(null) }

    // Editable settings, seeded from the track once it is loaded.
    var style by remember { mutableStateOf(settings.assStyleDefaults) }
    var saveDefaults by remember { mutableStateOf(false) }
    var offsetMs by remember { mutableStateOf(0L) }
    var preview by remember { mutableStateOf<java.io.File?>(null) }
    var previewing by remember { mutableStateOf(false) }
    var previewFailed by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) { targets = editor.findTargets() }

    HebSubScreen(title = stringResource(R.string.edit_title), onHome = onHome, exitEnabled = !busy) {
        val current = loaded
        if (current == null) {
            Text(stringResource(R.string.edit_pick_movie), style = MaterialTheme.typography.bodyMedium)
            if (targets.isEmpty()) {
                Text(stringResource(R.string.edit_none), style = MaterialTheme.typography.bodySmall)
            }
            targets.forEach { t ->
                OutlinedButton(
                    onClick = {
                        busy = true; message = null
                        scope.launch {
                            val l = editor.load(t)
                            busy = false
                            if (l == null) {
                                message = context.getString(R.string.edit_load_failed)
                            } else {
                                style = l.options
                                loaded = l
                                offsetMs = 0L
                                preview = null; previewFailed = false
                            }
                        }
                    },
                    enabled = !busy,
                    modifier = Modifier.fillMaxWidth(),
                ) { Text(t.title) }
            }
        } else {
            Text(current.target.title, style = MaterialTheme.typography.titleMedium)
            if (current.ass == null) {
                Text(stringResource(R.string.edit_from_srt), style = MaterialTheme.typography.bodySmall)
            }

            // Manual sync. The person watching the film knows how far out the
            // subtitles are; deriving it from the audio was tried and removed,
            // because ASR reads background music as speech and anchored on it.
            HorizontalDivider()
            Text(stringResource(R.string.edit_offset_title), style = MaterialTheme.typography.titleSmall)
            Text(
                if (offsetMs == 0L) stringResource(R.string.edit_offset_none)
                else stringResource(R.string.edit_offset_value, formatOffset(offsetMs)),
                style = MaterialTheme.typography.bodyMedium,
            )
            OffsetControls(offsetMs, enabled = !busy) { offsetMs = it }
            Text(stringResource(R.string.edit_offset_hint), style = MaterialTheme.typography.bodySmall)
            HorizontalDivider()

            StyleSliders(style) { style = it }

            // A frame of the actual film with these settings on it, so the choice is
            // made against the picture rather than after a full rebuild.
            Button(
                onClick = {
                    previewing = true; previewFailed = false
                    scope.launch {
                        val img = editor.preview(current, style, offsetMs)
                        previewing = false
                        if (img == null) { previewFailed = true; preview = null } else preview = img
                    }
                },
                enabled = !busy && !previewing,
                modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
            ) { Text(stringResource(R.string.edit_preview)) }

            if (previewing) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    CircularProgressIndicator(modifier = Modifier.size(20.dp), strokeWidth = 2.dp)
                    Text(stringResource(R.string.edit_preview_working), style = MaterialTheme.typography.bodySmall)
                }
            }
            if (previewFailed) {
                Text(stringResource(R.string.edit_preview_unavailable), style = MaterialTheme.typography.bodySmall)
            }
            preview?.let { PreviewFrame(it) }

            // §10 — one tick makes every parameter here the default for future ASS files.
            CheckRow(
                checked = saveDefaults,
                onChange = { saveDefaults = it },
                title = stringResource(R.string.edit_save_defaults),
                hint = stringResource(R.string.edit_save_defaults_hint),
            )

            if (busy) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    CircularProgressIndicator(modifier = Modifier.size(20.dp), strokeWidth = 2.dp)
                    Text(stringResource(R.string.edit_working), style = MaterialTheme.typography.bodySmall)
                }
            }

            Button(
                onClick = {
                    busy = true; message = null
                    if (saveDefaults) {
                        settings.assDefaults = style
                        RunLog.log("edit: saved ASS defaults ${style.serialize()}")
                    }
                    scope.launch {
                        val ok = editor.apply(current, style, offsetMs)
                        busy = false
                        val outcome = context.getString(if (ok) R.string.edit_done else R.string.edit_failed)
                        val defaults = if (saveDefaults) " " + context.getString(R.string.edit_defaults_saved) else ""
                        message = outcome + defaults
                        if (ok) targets = editor.findTargets()
                    }
                },
                enabled = !busy,
                modifier = Modifier.fillMaxWidth(),
            ) { Text(stringResource(R.string.edit_apply)) }

            OutlinedButton(
                onClick = { loaded = null; message = null; offsetMs = 0L; preview = null; previewFailed = false },
                enabled = !busy,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(stringResource(R.string.edit_pick_other))
            }
        }

        message?.let { Text(it, style = MaterialTheme.typography.bodyMedium) }
    }
}

/** Per-field connection-test state. */
private sealed interface TestStatus {
    data object Idle : TestStatus
    data object Testing : TestStatus
    data class Success(val message: String) : TestStatus
    data class Failure(val message: String) : TestStatus
}

/**
 * The four API keys, each with its own Save that runs a real request through
 * [ConnectionTester] and shows the verdict inline ([KeyField]); the Claude model
 * picker; and backup/restore of the keys to a fixed JSON file in the HebSub
 * folder — the way to survive an uninstall, since the encrypted preferences die
 * with the app's data. Keys are held only in [SettingsRepository] (encrypted at
 * rest, §12) and never leave the device except as the provider's own auth header.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SettingsScreen(settings: SettingsRepository, onBack: () -> Unit) {
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    var osKey by remember { mutableStateOf(settings.openSubtitlesApiKey) }
    var anthropicKey by remember { mutableStateOf(settings.anthropicApiKey) }
    var deepgramKey by remember { mutableStateOf(settings.deepgramApiKey) }
    var omdbKey by remember { mutableStateOf(settings.omdbApiKey) }
    var model by remember { mutableStateOf(settings.claudeModel) }
    var modelMenu by remember { mutableStateOf(false) }

    var osStatus by remember { mutableStateOf<TestStatus>(TestStatus.Idle) }
    var anthropicStatus by remember { mutableStateOf<TestStatus>(TestStatus.Idle) }
    var deepgramStatus by remember { mutableStateOf<TestStatus>(TestStatus.Idle) }
    var omdbStatus by remember { mutableStateOf<TestStatus>(TestStatus.Idle) }
    // True once any test ran — controls whether a settings log is written on exit.
    var testsRan by remember { mutableStateOf(false) }
    var backupMsg by remember { mutableStateOf<String?>(null) }
    // §4 — the keys backup always lives at a fixed path inside HebSub, so there is
    // no location to pick: save writes it (overwriting any existing one, §4.2) and
    // load reads it back.
    val keysFile = remember { java.io.File(HebSubStorage(context).rootDir(), KEYS_FILE_NAME) }

    fun doExportKeys() {
        val ok = runCatching {
            HebSubStorage(context).ensureRoot()
            keysFile.writeText(settings.exportKeysJson(), Charsets.UTF_8) // overwrites (§4.2)
            true
        }.getOrDefault(false)
        backupMsg = context.getString(if (ok) R.string.keys_export_ok else R.string.keys_backup_fail)
        RunLog.log("settings: export keys -> ${keysFile.absolutePath} ok=$ok")
    }

    fun doImportKeys() {
        if (!keysFile.exists()) { backupMsg = context.getString(R.string.keys_none); return }
        val n = runCatching { settings.importKeysJson(keysFile.readText(Charsets.UTF_8)) }.getOrDefault(-1)
        if (n >= 0) {
            osKey = settings.openSubtitlesApiKey
            anthropicKey = settings.anthropicApiKey
            deepgramKey = settings.deepgramApiKey
            omdbKey = settings.omdbApiKey
            model = settings.claudeModel
            backupMsg = context.getString(R.string.keys_import_ok, n)
        } else {
            backupMsg = context.getString(R.string.keys_backup_fail)
        }
        RunLog.log("settings: import keys <- ${keysFile.absolutePath} applied=$n")
    }

    fun leave() {
        // Persist the settings log so every connection test is diagnosable
        // offline. It goes to the HebSub folder, beside the run logs, the install
        // logs and the crash reports — one place to look for everything the app
        // records. onBack() runs only after the write, so navigating away doesn't
        // dispose this composition (and cancel the write) mid-flight.
        if (testsRan) {
            val dump = RunLog.dump()
            scope.launch {
                runCatching {
                    val root = HebSubStorage(context).ensureRoot()
                    val stamp = java.text.SimpleDateFormat("yyyyMMdd-HHmm", java.util.Locale.US)
                        .format(java.util.Date())
                    java.io.File(root, "HebSub-settings-$stamp.txt").writeText(dump, Charsets.UTF_8)
                }
                onBack()
            }
        } else {
            onBack()
        }
    }

    HebSubScreen(title = stringResource(R.string.settings_title), onHome = { leave() }) {
        // Cloud translation model — picked before the Anthropic test so the test
        // validates the exact model that will be used.
        ExposedDropdownMenuBox(expanded = modelMenu, onExpandedChange = { modelMenu = it }) {
            OutlinedTextField(
                value = model, onValueChange = {}, readOnly = true,
                label = { Text(stringResource(R.string.settings_model)) },
                modifier = Modifier.fillMaxWidth().menuAnchor(),
            )
            ExposedDropdownMenu(expanded = modelMenu, onDismissRequest = { modelMenu = false }) {
                ClaudeApi.AVAILABLE_MODELS.forEach { m ->
                    DropdownMenuItem(text = { Text(m) }, onClick = {
                        model = m; modelMenu = false
                        settings.claudeModel = m
                        RunLog.log("settings: model = $m")
                    })
                }
            }
        }

        KeyField(
            label = stringResource(R.string.settings_os_key),
            value = osKey, onValueChange = { osKey = it },
            status = osStatus,
            onSave = {
                settings.openSubtitlesApiKey = osKey
                RunLog.log("settings: saved OpenSubtitles key (len=${osKey.trim().length})")
                osStatus = TestStatus.Testing; testsRan = true
                scope.launch {
                    val r = ConnectionTester.testOpenSubtitles(settings.openSubtitlesApiKey)
                    osStatus = if (r.ok) TestStatus.Success(r.message) else TestStatus.Failure(r.message)
                }
            },
        )

        KeyField(
            label = stringResource(R.string.settings_anthropic_key),
            value = anthropicKey, onValueChange = { anthropicKey = it },
            status = anthropicStatus,
            onSave = {
                settings.anthropicApiKey = anthropicKey
                settings.claudeModel = model
                RunLog.log("settings: saved Anthropic key (len=${anthropicKey.trim().length}) model=$model")
                anthropicStatus = TestStatus.Testing; testsRan = true
                scope.launch {
                    val r = ConnectionTester.testAnthropic(settings.anthropicApiKey, model)
                    anthropicStatus = if (r.ok) TestStatus.Success(r.message) else TestStatus.Failure(r.message)
                }
            },
        )

        KeyField(
            label = stringResource(R.string.settings_deepgram_key),
            value = deepgramKey, onValueChange = { deepgramKey = it },
            status = deepgramStatus,
            onSave = {
                settings.deepgramApiKey = deepgramKey
                RunLog.log("settings: saved Deepgram key (len=${deepgramKey.trim().length})")
                deepgramStatus = TestStatus.Testing; testsRan = true
                scope.launch {
                    val r = ConnectionTester.testDeepgram(settings.deepgramApiKey)
                    deepgramStatus = if (r.ok) TestStatus.Success(r.message) else TestStatus.Failure(r.message)
                }
            },
        )

        KeyField(
            label = stringResource(R.string.settings_omdb_key),
            value = omdbKey, onValueChange = { omdbKey = it },
            status = omdbStatus,
            onSave = {
                settings.omdbApiKey = omdbKey
                RunLog.log("settings: saved OMDb key (len=${omdbKey.trim().length})")
                omdbStatus = TestStatus.Testing; testsRan = true
                scope.launch {
                    val r = ConnectionTester.testOmdb(settings.omdbApiKey)
                    omdbStatus = if (r.ok) TestStatus.Success(r.message) else TestStatus.Failure(r.message)
                }
            },
        )

        HorizontalDivider()

        // Backup / restore all keys to a file, so a reinstall doesn't require
        // retyping them (encrypted storage is cleared on uninstall).
        Text(stringResource(R.string.keys_backup_title), style = MaterialTheme.typography.titleSmall)
        Text(stringResource(R.string.keys_backup_note), style = MaterialTheme.typography.bodySmall)
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            OutlinedButton(onClick = { doExportKeys() }, modifier = Modifier.weight(1f)) {
                Text(stringResource(R.string.keys_export))
            }
            OutlinedButton(onClick = { doImportKeys() }, modifier = Modifier.weight(1f)) {
                Text(stringResource(R.string.keys_import))
            }
        }
        backupMsg?.let { Text(it, style = MaterialTheme.typography.bodySmall) }

        Text(stringResource(R.string.settings_privacy_note), style = MaterialTheme.typography.bodySmall)
    }
}

/** A password key field with its own Save button and a live connection-test result. */
@Composable
private fun KeyField(
    label: String,
    value: String,
    onValueChange: (String) -> Unit,
    status: TestStatus,
    onSave: () -> Unit,
) {
    val okColor = Color(0xFF2E7D32)
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        OutlinedTextField(
            value = value, onValueChange = onValueChange,
            label = { Text(label) },
            visualTransformation = PasswordVisualTransformation(),
            singleLine = true, modifier = Modifier.fillMaxWidth(),
        )
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Button(onClick = onSave, enabled = status !is TestStatus.Testing) {
                Text(stringResource(R.string.save))
            }
            when (status) {
                is TestStatus.Idle -> Unit
                is TestStatus.Testing -> {
                    CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp)
                    Text(stringResource(R.string.conn_testing), style = MaterialTheme.typography.bodySmall)
                }
                is TestStatus.Success -> Text(
                    "✓ ${status.message}", color = okColor,
                    style = MaterialTheme.typography.bodySmall,
                )
                is TestStatus.Failure -> Text(
                    "✗ ${status.message}", color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodySmall,
                )
            }
        }
    }
}

/**
 * The modal that follows a run from start to finish, drawn above whichever
 * screen is showing. One branch per [PipelineState]; see the file header for
 * what each shows. The `Running` and `NeedVideoInfo` dialogs cannot be dismissed
 * by tapping outside, only by their own buttons — a stray tap must not cancel a
 * forty-minute run or leave the service suspended waiting for an answer that
 * will never come.
 */
@Composable
private fun PipelineOverlay(state: PipelineState, onNewVideo: () -> Unit = {}) {
    when (state) {
        is PipelineState.Idle -> Unit

        // A run in progress: what stage, how far, which of the six sources has
        // been tried, and the last few log lines so a stall is visible.

        is PipelineState.Running -> Dialog(dismissable = false) {
            val tail by RunLog.tail.collectAsStateWithLifecycle()
            val steps by PipelineBus.steps.collectAsStateWithLifecycle()
            val ctx = LocalContext.current
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text(state.stageLabel, style = MaterialTheme.typography.titleMedium)
                Spacer(Modifier.height(16.dp))
                if (state.progress != null) {
                    LinearProgressIndicator(progress = { state.progress.coerceIn(0f, 1f) }, modifier = Modifier.fillMaxWidth())
                } else {
                    LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
                }

                // §4 — the six-step search for a subtitle source, with the state of each.
                if (steps.any { it.status != StepStatus.Pending }) {
                    Spacer(Modifier.height(16.dp))
                    HorizontalDivider()
                    Spacer(Modifier.height(8.dp))
                    Text(
                        stringResource(R.string.steps_title),
                        style = MaterialTheme.typography.labelLarge,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Spacer(Modifier.height(4.dp))
                    Column(Modifier.fillMaxWidth()) { steps.forEach { StepRow(it) } }
                    HorizontalDivider()
                }

                Spacer(Modifier.height(12.dp))
                // Behind-the-scenes live log tail.
                CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Ltr) {
                    Column(Modifier.fillMaxWidth()) {
                        tail.takeLast(6).forEach { line ->
                            Text(
                                line,
                                style = MaterialTheme.typography.labelSmall,
                                maxLines = 2,
                            )
                        }
                    }
                }
                Spacer(Modifier.height(16.dp))
                // §5 — a long run must be stoppable. What was produced so far stays
                // in the movie's folder rather than being silently thrown away.
                OutlinedButton(
                    onClick = { ProcessingService.cancel(ctx); PipelineBus.reset() },
                    modifier = Modifier.fillMaxWidth(),
                ) { Text(stringResource(R.string.run_cancel)) }
            }
        }

        // The pre-run form. The service is suspended in PipelineBus.awaitVideoInfo()
        // until the confirm button submits a VideoInfo, or cancel completes it with
        // null. Every field is keyed on suggestedName so a new run starts clean.
        is PipelineState.NeedVideoInfo -> Dialog(dismissable = false) {
            val ctx = LocalContext.current
            val settings = remember { SettingsRepository(ctx) }
            var imdb by remember(state.suggestedName) { mutableStateOf("") }
            var name by remember(state.suggestedName) { mutableStateOf(state.suggestedName) }
            var year by remember(state.suggestedName) { mutableStateOf("") }
            var deleteData by remember(state.suggestedName) { mutableStateOf(true) }
            var subPath by remember(state.suggestedName) { mutableStateOf<String?>(null) }
            var subName by remember(state.suggestedName) { mutableStateOf<String?>(null) }
            // §9 — plain or styled; §9.1/§10 supply what "styled" starts from.
            var styled by remember(state.suggestedName) { mutableStateOf(false) }
            var style by remember(state.suggestedName) { mutableStateOf(settings.assStyleDefaults) }
            var minDisplay by remember(state.suggestedName) { mutableStateOf(settings.minDisplayMs.toFloat()) }
            var saveDefaults by remember(state.suggestedName) { mutableStateOf(false) }

            val subPicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
                if (uri != null) {
                    val nm = pickedFileName(ctx, uri) ?: "subtitle.srt"
                    val dest = java.io.File(ctx.cacheDir, "picked_$nm")
                    val ok = runCatching {
                        ctx.contentResolver.openInputStream(uri)?.use { i -> dest.outputStream().use { i.copyTo(it) } } != null
                    }.getOrDefault(false)
                    if (ok) { subPath = dest.absolutePath; subName = nm }
                }
            }

            Column(Modifier.heightIn(max = 560.dp).verticalScroll(rememberScrollState())) {
                Text(stringResource(R.string.video_info_title), style = MaterialTheme.typography.titleMedium)
                Spacer(Modifier.height(8.dp))
                // This exact file has been through the app before — say so, and say
                // how it went, before two hours of transcription and translation are
                // spent again. The choice stays the user's: a second run is
                // sometimes just what is wanted (a subtitle file this time, or an
                // API key that is configured now).
                state.previous?.let { PreviousRunWarning(it) }
                Text(stringResource(R.string.video_info_body), style = MaterialTheme.typography.bodySmall)
                Spacer(Modifier.height(12.dp))
                OutlinedTextField(
                    value = imdb, onValueChange = { imdb = it },
                    label = { Text(stringResource(R.string.video_info_imdb)) },
                    singleLine = true, modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(8.dp))
                OutlinedButton(onClick = { runCatching { subPicker.launch(arrayOf("*/*")) } }, modifier = Modifier.fillMaxWidth()) {
                    Text(subName?.let { stringResource(R.string.video_info_sub_chosen) + " " + it } ?: stringResource(R.string.video_info_pick_sub))
                }
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = name, onValueChange = { name = it },
                    label = { Text(stringResource(R.string.video_info_name)) },
                    singleLine = true, modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = year,
                    onValueChange = { v -> year = v.filter { it.isDigit() }.take(4) },
                    label = { Text(stringResource(R.string.video_info_year)) },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    modifier = Modifier.fillMaxWidth(),
                )
                // Every source keeps its own timing. A track that turns out to be a
                // few seconds off is corrected afterwards, by hand, in the style editor.
                Spacer(Modifier.height(12.dp))
                HorizontalDivider()
                Spacer(Modifier.height(8.dp))
                Text(stringResource(R.string.video_info_timing_note), style = MaterialTheme.typography.bodySmall)

                // §9 — plain subtitles or a styled ASS track.
                Spacer(Modifier.height(12.dp))
                HorizontalDivider()
                Spacer(Modifier.height(8.dp))
                Text(stringResource(R.string.video_info_kind_title), style = MaterialTheme.typography.titleSmall)
                RadioRow(stringResource(R.string.video_info_kind_srt), !styled) { styled = false }
                RadioRow(stringResource(R.string.video_info_kind_ass), styled) { styled = true }
                Text(stringResource(R.string.video_info_kind_hint), style = MaterialTheme.typography.bodySmall)

                if (styled) {
                    Spacer(Modifier.height(12.dp))
                    Text(stringResource(R.string.video_info_style_title), style = MaterialTheme.typography.titleSmall)
                    StyleSliders(style) { style = it }
                }

                // §8 — how long a line stays up, at minimum.
                Spacer(Modifier.height(12.dp))
                HorizontalDivider()
                Spacer(Modifier.height(8.dp))
                Text(
                    if (minDisplay < 1f) stringResource(R.string.video_info_min_display_off)
                    else stringResource(R.string.video_info_min_display, "%.1f".format(minDisplay / 1000f)),
                    style = MaterialTheme.typography.bodyMedium,
                )
                Slider(
                    value = minDisplay,
                    onValueChange = { minDisplay = it },
                    valueRange = 0f..SettingsRepository.MAX_MIN_DISPLAY_MS.toFloat(),
                    steps = 19,   // half-second stops
                )
                Text(stringResource(R.string.video_info_min_display_hint), style = MaterialTheme.typography.bodySmall)

                // §10 — keep this look for the next films.
                Spacer(Modifier.height(8.dp))
                CheckRow(
                    checked = saveDefaults,
                    onChange = { saveDefaults = it },
                    title = stringResource(R.string.video_info_save_defaults),
                    hint = stringResource(R.string.video_info_save_defaults_hint),
                )
                CheckRow(
                    checked = deleteData,
                    onChange = { deleteData = it },
                    title = stringResource(R.string.video_info_delete),
                    hint = stringResource(R.string.video_info_delete_hint),
                )
                Spacer(Modifier.height(16.dp))
                Button(
                    onClick = {
                        PipelineBus.submitVideoInfo(
                            VideoInfo(
                                name = name.trim(),
                                year = year.ifBlank { null },
                                imdbUrl = imdb.ifBlank { null },
                                subtitlePath = subPath,
                                styled = styled,
                                style = style,
                                saveStyleAsDefaults = saveDefaults,
                                minDisplayMs = (minDisplay / 500f).toLong() * 500L,
                                deleteData = deleteData,
                            ),
                        )
                    },
                    enabled = name.isNotBlank(),
                    modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
                ) { Text(stringResource(R.string.video_info_confirm)) }
                Spacer(Modifier.height(8.dp))
                // §5 — a way out of this screen too. Nothing has been written yet.
                OutlinedButton(
                    onClick = { PipelineBus.cancelVideoInfo(); PipelineBus.reset() },
                    modifier = Modifier.fillMaxWidth(),
                ) { Text(stringResource(R.string.video_info_cancel)) }
            }
        }

        is PipelineState.Success -> Dialog(onDismiss = { PipelineBus.reset() }) {
            val ctx = LocalContext.current
            // Inside a Compose Dialog the context is a ContextWrapper, so a direct
            // cast to Activity returns null; walk the chain to find the Activity so
            // the close buttons actually finish the app (not just the dialog).
            val activity = ctx.findActivity()
            Column {
                Text(stringResource(R.string.done), style = MaterialTheme.typography.titleLarge)
                Spacer(Modifier.height(8.dp))
                Text(stringResource(R.string.output_saved))
                Spacer(Modifier.height(4.dp))
                CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Ltr) {
                    Column(Modifier.fillMaxWidth()) {
                        Text("📁 ${state.folder}", style = MaterialTheme.typography.bodySmall)
                        state.mediaName?.let { Text("🎬 $it", style = MaterialTheme.typography.bodySmall) }
                        Text("• ${state.srtName}", style = MaterialTheme.typography.bodySmall)
                    }
                }
                if (state.mediaName != null) {
                    Spacer(Modifier.height(4.dp))
                    Text("פתחו את קובץ ה־MKV בנגן ובחרו את מסלול העברית.", style = MaterialTheme.typography.bodySmall)
                }
                Spacer(Modifier.height(10.dp))
                // What went wrong with the finished file, if anything — so the user
                // knows when the log is worth reading and when it is not.
                if (state.issues.isEmpty()) {
                    Text("✓ לא זוהו בעיות בקובץ הסופי.", style = MaterialTheme.typography.bodySmall)
                } else {
                    Text(
                        "⚠ ${state.issues.size} בעיות זוהו — מומלץ לעיין ביומן:",
                        color = MaterialTheme.colorScheme.error,
                        style = MaterialTheme.typography.bodyMedium,
                    )
                    state.issues.forEach { Bullet(it) }
                }
                Spacer(Modifier.height(16.dp))
                // §2 — three next-step choices at the end of a run.
                Button(onClick = { onNewVideo() }, modifier = Modifier.fillMaxWidth()) {
                    Text(stringResource(R.string.success_new_video))
                }
                Spacer(Modifier.height(8.dp))
                OutlinedButton(onClick = { PipelineBus.reset(); activity?.finishAffinity() }, modifier = Modifier.fillMaxWidth()) {
                    Text(stringResource(R.string.success_close))
                }
                Spacer(Modifier.height(8.dp))
                OutlinedButton(
                    onClick = { openHebSubFolder(ctx); PipelineBus.reset(); activity?.finishAffinity() },
                    modifier = Modifier.fillMaxWidth(),
                ) { Text(stringResource(R.string.success_open_folder)) }
            }
        }

        is PipelineState.Failed -> Dialog(onDismiss = { PipelineBus.reset() }) {
            Column {
                Text("שגיאה", style = MaterialTheme.typography.titleLarge)
                Spacer(Modifier.height(8.dp))
                Text(state.message)
                Spacer(Modifier.height(8.dp))
                Text("יומן מפורט נשמר בתיקיית הוידאו (קובץ בשם התיקייה, ‎.txt‎), וקובץ crash-*.txt בתיקיית HebSub אם היתה קריסה.", style = MaterialTheme.typography.bodySmall)
                Spacer(Modifier.height(16.dp))
                Button(onClick = { PipelineBus.reset() }, modifier = Modifier.fillMaxWidth()) { Text("סגירה") }
            }
        }
    }
}

/** Largest manual sync offset offered, in milliseconds (±2 minutes). */
private const val MAX_OFFSET_MS = 120_000L

/** `+2.5` / `−1` seconds — a signed, minimal rendering of a subtitle offset. */
private fun formatOffset(ms: Long): String {
    val sign = if (ms < 0) "−" else "+"
    val abs = kotlin.math.abs(ms)
    val whole = abs / 1000
    val half = (abs % 1000) / 500
    return if (half == 0L) "$sign$whole" else "$sign$whole.5"
}

/**
 * The manual sync stepper: whole seconds and half seconds, in both directions,
 * plus a reset. Buttons rather than a slider because the correction is a specific
 * number the user arrives at by watching, not a value to sweep through.
 */
@Composable
private fun OffsetControls(offsetMs: Long, enabled: Boolean, onChange: (Long) -> Unit) {
    // Kept in one list so the row is symmetric by construction.
    val steps = listOf(-5_000L, -1_000L, -500L, 500L, 1_000L, 5_000L)
    Row(
        Modifier.fillMaxWidth().padding(vertical = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        steps.forEach { delta ->
            OutlinedButton(
                onClick = { onChange((offsetMs + delta).coerceIn(-MAX_OFFSET_MS, MAX_OFFSET_MS)) },
                enabled = enabled,
                contentPadding = PaddingValues(horizontal = 4.dp, vertical = 8.dp),
                modifier = Modifier.weight(1f).heightIn(min = 48.dp),
            ) { Text(formatOffset(delta), style = MaterialTheme.typography.labelLarge) }
        }
    }
    if (offsetMs != 0L) {
        TextButton(onClick = { onChange(0L) }, enabled = enabled) {
            Text(stringResource(R.string.edit_offset_reset))
        }
    }
}

/**
 * One row of the source-search list on the progress screen (§4): the step's number
 * and name, a marker for how it ended, and — where there is one — a short note such
 * as the cue count or why the step did not apply.
 */
@Composable
private fun StepRow(state: SourceStepState) {
    val done = MaterialTheme.colorScheme.primary
    val muted = MaterialTheme.colorScheme.onSurfaceVariant
    // One mark for "this source was not the one": a step that did not apply and a
    // step that was tried and came back empty both read the same to the user. The
    // cross is kept for an actual error, in the error colour.
    val (mark, tint) = when (state.status) {
        StepStatus.Pending -> "○" to muted
        StepStatus.Running -> "▶" to done
        StepStatus.Skipped, StepStatus.NotFound -> "–" to muted
        StepStatus.Failed -> "✕" to MaterialTheme.colorScheme.error
        StepStatus.Used -> "✓" to done
    }
    // A running step is the one the user is waiting on, so it is the only one
    // emphasised; the rest stay quiet enough to scan past.
    val emphasis = if (state.status == StepStatus.Running || state.status == StepStatus.Used) done else muted
    Row(
        Modifier.fillMaxWidth().padding(vertical = 2.dp),
        verticalAlignment = Alignment.Top,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(mark, color = tint, style = MaterialTheme.typography.labelLarge)
        Column(Modifier.weight(1f)) {
            Text(
                state.step.label,
                color = emphasis,
                style = MaterialTheme.typography.bodySmall,
            )
            state.detail?.let { Text(it, color = muted, style = MaterialTheme.typography.labelSmall) }
        }
    }
}

/**
 * The warning on the pre-run screen when the file about to be processed is one
 * the app has already done. Matched on the file's own content hash, so a copy
 * that was renamed or moved is still recognised. It reports rather than blocks —
 * the confirm and cancel buttons below it are the decision.
 */
@Composable
private fun PreviousRunWarning(previous: RunHistory.Entry) {
    val succeeded = previous.status == RunHistory.Status.SUCCESS
    Surface(
        color = if (succeeded) MaterialTheme.colorScheme.secondaryContainer
                else MaterialTheme.colorScheme.errorContainer,
        shape = RoundedCornerShape(12.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(
                if (succeeded) "⚠ הקובץ הזה כבר עובד בהצלחה" else "⚠ הקובץ הזה כבר נוסה בעבר ונכשל",
                style = MaterialTheme.typography.titleSmall,
            )
            val name = previous.title + if (previous.year.isNotBlank()) " (${previous.year})" else ""
            Text("${previous.date} · $name", style = MaterialTheme.typography.bodySmall)
            if (previous.source.isNotBlank()) {
                val lines = if (previous.cues.isNotBlank()) " · ${previous.cues} שורות" else ""
                Text("מקור: ${previous.source}$lines", style = MaterialTheme.typography.labelSmall)
            }
            if (previous.note.isNotBlank()) {
                Text(previous.note, style = MaterialTheme.typography.labelSmall)
            }
            Text(
                "אפשר להמשיך בכל זאת, או לבטל בכפתור שבתחתית המסך.",
                style = MaterialTheme.typography.bodySmall,
            )
        }
    }
    Spacer(Modifier.height(12.dp))
}

/** One line of a short outcome list. */
@Composable
private fun Bullet(text: String) {
    Text("• $text", style = MaterialTheme.typography.bodySmall)
}

/** One option of a radio group; the whole row is the target, not just the dot. */
@Composable
private fun RadioRow(label: String, selected: Boolean, onSelect: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().selectable(selected = selected, onClick = onSelect).padding(vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        RadioButton(selected = selected, onClick = onSelect)
        Spacer(Modifier.width(4.dp))
        Text(label, style = MaterialTheme.typography.bodyMedium)
    }
}

/** A checkbox with a title and an explanatory second line. */
@Composable
private fun CheckRow(checked: Boolean, onChange: (Boolean) -> Unit, title: String, hint: String) {
    Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Checkbox(checked = checked, onCheckedChange = onChange)
        Spacer(Modifier.width(4.dp))
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.bodyMedium)
            Text(hint, style = MaterialTheme.typography.bodySmall)
        }
    }
}

/**
 * The six ASS display settings, in one place so the pre-run screen and the style
 * editor cannot drift apart. Defaults come from §9.1 or from what the user saved.
 */
@Composable
private fun StyleSliders(options: AssStyleOptions, onChange: (AssStyleOptions) -> Unit) {
    Column(Modifier.fillMaxWidth()) {
        Text(stringResource(R.string.edit_transparency, options.bgTransparencyPercent), style = MaterialTheme.typography.bodyMedium)
        Slider(
            value = options.bgTransparencyPercent.toFloat(),
            onValueChange = { onChange(options.copy(bgTransparencyPercent = it.toInt())) },
            valueRange = 0f..100f,
        )
        Text(stringResource(R.string.edit_transparency_hint), style = MaterialTheme.typography.bodySmall)

        Text(stringResource(R.string.edit_fontsize, options.fontSize), style = MaterialTheme.typography.bodyMedium)
        Slider(
            value = options.fontSize.toFloat(),
            onValueChange = { onChange(options.copy(fontSize = it.toInt())) },
            valueRange = 12f..60f,
        )
        Text(stringResource(R.string.edit_fontsize_hint), style = MaterialTheme.typography.bodySmall)

        Text(stringResource(R.string.edit_padding, options.platePadding), style = MaterialTheme.typography.bodyMedium)
        Slider(
            value = options.platePadding.toFloat(),
            onValueChange = { onChange(options.copy(platePadding = it.toInt())) },
            valueRange = 0f..30f,
        )

        Text(stringResource(R.string.edit_side_padding, options.plateSidePadding), style = MaterialTheme.typography.bodyMedium)
        Slider(
            value = options.plateSidePadding.toFloat(),
            onValueChange = { onChange(options.copy(plateSidePadding = it.toInt())) },
            valueRange = 0f..60f,
        )
        Text(stringResource(R.string.edit_side_padding_hint), style = MaterialTheme.typography.bodySmall)

        Text(stringResource(R.string.edit_margin, options.marginV), style = MaterialTheme.typography.bodyMedium)
        Slider(
            value = options.marginV.toFloat(),
            onValueChange = { onChange(options.copy(marginV = it.toInt())) },
            valueRange = 0f..120f,
        )
        Text(stringResource(R.string.edit_margin_hint), style = MaterialTheme.typography.bodySmall)

        Text(stringResource(R.string.edit_linegap, options.extraLineSpacing), style = MaterialTheme.typography.bodyMedium)
        Slider(
            value = options.extraLineSpacing.toFloat(),
            onValueChange = { onChange(options.copy(extraLineSpacing = it.toInt())) },
            valueRange = 0f..40f,
        )
        Text(stringResource(R.string.edit_linegap_hint), style = MaterialTheme.typography.bodySmall)
    }
}

/**
 * Show a rendered preview frame. The bitmap is decoded off the file the editor
 * just wrote; if decoding fails (an unreadable or truncated render) nothing is
 * drawn rather than an empty box.
 */
@Composable
private fun PreviewFrame(image: java.io.File) {
    val bitmap = remember(image.absolutePath) {
        runCatching { android.graphics.BitmapFactory.decodeFile(image.absolutePath) }.getOrNull()
    }
    if (bitmap != null) {
        Image(
            bitmap = bitmap.asImageBitmap(),
            contentDescription = stringResource(R.string.edit_preview),
            contentScale = ContentScale.FillWidth,
            modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)),
        )
    }
}

/** Minimal modal wrapper. */
@Composable
private fun Dialog(
    dismissable: Boolean = true,
    onDismiss: () -> Unit = {},
    content: @Composable () -> Unit,
) {
    androidx.compose.ui.window.Dialog(onDismissRequest = { if (dismissable) onDismiss() }) {
        Card {
            Column(Modifier.padding(24.dp).fillMaxWidth()) { content() }
        }
    }
}

@Composable
private fun stringResource(id: Int): String = androidx.compose.ui.res.stringResource(id)

@Composable
private fun stringResource(id: Int, vararg args: Any): String =
    androidx.compose.ui.res.stringResource(id, *args)

/**
 * Best-effort open of the HebSub folder in a file manager (§2.3). Folder-opening
 * intents are device-specific, so try the DocumentsUI folder view, then fall
 * back to the storage root; failures are swallowed (the app still closes).
 */
private fun openHebSubFolder(context: android.content.Context) {
    val tries = listOf(
        Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(
                DocumentsContract.buildDocumentUri("com.android.externalstorage.documents", "primary:${HebSubStorage.ROOT_NAME}"),
                DocumentsContract.Document.MIME_TYPE_DIR,
            )
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        },
        Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(
                DocumentsContract.buildRootUri("com.android.externalstorage.documents", "primary"),
                DocumentsContract.Root.MIME_TYPE_ITEM,
            )
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        },
    )
    for (i in tries) {
        if (runCatching { context.startActivity(i); true }.getOrDefault(false)) return
    }
}

/** Unwrap the ContextWrapper chain (e.g. a Compose Dialog context) to the Activity. */
private fun android.content.Context.findActivity(): android.app.Activity? {
    var c: android.content.Context? = this
    while (c is android.content.ContextWrapper) {
        if (c is android.app.Activity) return c
        c = c.baseContext
    }
    return null
}

/** Display name of a picked document Uri, or null. */
private fun pickedFileName(context: android.content.Context, uri: android.net.Uri): String? =
    context.contentResolver.query(uri, arrayOf(android.provider.OpenableColumns.DISPLAY_NAME), null, null, null)
        ?.use { c -> if (c.moveToFirst()) c.getString(0) else null }
