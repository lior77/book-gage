package com.hebsub.app

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.hebsub.app.storage.HebSubStorage
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.hebsub.app.data.SettingsRepository
import com.hebsub.app.io.OutputWriter
import com.hebsub.app.log.RunLog
import com.hebsub.app.net.ConnectionTester
import androidx.compose.ui.text.input.KeyboardType
import com.hebsub.app.pipeline.OutputChoice
import com.hebsub.app.pipeline.PipelineBus
import com.hebsub.app.pipeline.PipelineState
import com.hebsub.app.pipeline.TranslationChoice
import com.hebsub.app.pipeline.VideoInfo
import com.hebsub.app.service.ProcessingService
import com.hebsub.core.provider.claude.ClaudeApi
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            // Hebrew UI is right-to-left throughout.
            CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Rtl) {
                MaterialTheme { AppRoot() }
            }
        }
    }
}

private enum class Screen { Onboarding, Home, Settings }

@Composable
private fun AppRoot() {
    val context = LocalContext.current
    val settings = remember { SettingsRepository(context) }
    var screen by remember {
        mutableStateOf(if (settings.onboardingComplete) Screen.Home else Screen.Onboarding)
    }
    val pipelineState by PipelineBus.state.collectAsStateWithLifecycle()

    Surface(modifier = Modifier.fillMaxSize()) {
        when (screen) {
            Screen.Onboarding -> OnboardingScreen {
                settings.onboardingComplete = true
                screen = Screen.Home
            }
            Screen.Home -> HomeScreen(
                onOpenSettings = { screen = Screen.Settings },
            )
            Screen.Settings -> SettingsScreen(settings) { screen = Screen.Home }
        }
    }

    // Overlays for progress and decisions, on top of any screen.
    PipelineOverlay(pipelineState)
}

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

    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp).verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text(stringResource(R.string.onboarding_title), style = MaterialTheme.typography.headlineMedium)
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

@Composable
private fun HomeScreen(onOpenSettings: () -> Unit) {
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

    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp).verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        // Title on the right (RTL start); the settings gear sits in the top-left
        // (RTL end) corner — a tap opens the key-entry screen.
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            // weight(1f) reserves space for the gear so a long title can never push
            // it off-screen; the gear stays pinned in the top-left (RTL end) corner.
            Text(
                stringResource(R.string.home_title),
                style = MaterialTheme.typography.headlineSmall,
                maxLines = 2,
                modifier = Modifier.weight(1f),
            )
            IconButton(onClick = onOpenSettings) {
                Icon(Icons.Filled.Settings, contentDescription = stringResource(R.string.settings))
            }
        }
        Text(stringResource(R.string.home_subtitle), style = MaterialTheme.typography.bodyMedium)

        Spacer(Modifier.height(8.dp))
        Button(
            onClick = { filePicker.launch(arrayOf("video/*")) },
            modifier = Modifier.fillMaxWidth(),
        ) { Text(stringResource(R.string.pick_file)) }

        Divider()

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
            modifier = Modifier.fillMaxWidth(),
        ) { Text(stringResource(R.string.paste_link) + " — " + stringResource(R.string.start)) }
    }
}

/** Per-field connection-test state. */
private sealed interface TestStatus {
    data object Idle : TestStatus
    data object Testing : TestStatus
    data class Success(val message: String) : TestStatus
    data class Failure(val message: String) : TestStatus
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SettingsScreen(settings: SettingsRepository, onBack: () -> Unit) {
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    var online by remember { mutableStateOf(settings.onlineSearchEnabled) }
    var osKey by remember { mutableStateOf(settings.openSubtitlesApiKey) }
    var anthropicKey by remember { mutableStateOf(settings.anthropicApiKey) }
    var deepgramKey by remember { mutableStateOf(settings.deepgramApiKey) }
    var model by remember { mutableStateOf(settings.claudeModel) }
    var modelMenu by remember { mutableStateOf(false) }

    var osStatus by remember { mutableStateOf<TestStatus>(TestStatus.Idle) }
    var anthropicStatus by remember { mutableStateOf<TestStatus>(TestStatus.Idle) }
    var deepgramStatus by remember { mutableStateOf<TestStatus>(TestStatus.Idle) }
    // True once any test ran — controls whether a settings log is written on exit.
    var testsRan by remember { mutableStateOf(false) }

    fun leave() {
        // Persist the settings log so every connection test is diagnosable
        // offline. onBack() runs only after the write, so navigating away doesn't
        // dispose this composition (and cancel the write) mid-flight.
        if (testsRan) {
            val dump = RunLog.dump()
            scope.launch {
                runCatching {
                    OutputWriter(context).publishLog(dump, "HebSub-settings-log-${System.currentTimeMillis()}.txt")
                }
                onBack()
            }
        } else {
            onBack()
        }
    }

    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp).verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text(stringResource(R.string.settings_title), style = MaterialTheme.typography.headlineSmall)

        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Text(stringResource(R.string.settings_online_search))
            Switch(checked = online, onCheckedChange = {
                online = it
                settings.onlineSearchEnabled = it
                RunLog.log("settings: online search = $it")
            })
        }

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

        Text(stringResource(R.string.settings_privacy_note), style = MaterialTheme.typography.bodySmall)

        Button(onClick = { leave() }, modifier = Modifier.fillMaxWidth()) {
            Text(stringResource(R.string.back))
        }
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

@Composable
private fun PipelineOverlay(state: PipelineState) {
    when (state) {
        is PipelineState.Idle -> Unit

        is PipelineState.Running -> Dialog(dismissable = false) {
            val tail by RunLog.tail.collectAsStateWithLifecycle()
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text(state.stageLabel, style = MaterialTheme.typography.titleMedium)
                Spacer(Modifier.height(16.dp))
                if (state.progress != null) {
                    LinearProgressIndicator(progress = { state.progress.coerceIn(0f, 1f) }, modifier = Modifier.fillMaxWidth())
                } else {
                    LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
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
            }
        }

        is PipelineState.NeedVideoInfo -> Dialog(dismissable = false) {
            var name by remember(state.suggestedName) { mutableStateOf(state.suggestedName) }
            var year by remember(state.suggestedName) { mutableStateOf("") }
            var burnedIn by remember(state.suggestedName) { mutableStateOf(false) }
            Column {
                Text(stringResource(R.string.video_info_title), style = MaterialTheme.typography.titleMedium)
                Spacer(Modifier.height(8.dp))
                Text(stringResource(R.string.video_info_body), style = MaterialTheme.typography.bodySmall)
                Spacer(Modifier.height(12.dp))
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
                Spacer(Modifier.height(8.dp))
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(checked = burnedIn, onCheckedChange = { burnedIn = it })
                    Spacer(Modifier.width(4.dp))
                    Column(Modifier.weight(1f)) {
                        Text(stringResource(R.string.burned_in_label), style = MaterialTheme.typography.bodyMedium)
                        Text(stringResource(R.string.burned_in_hint), style = MaterialTheme.typography.bodySmall)
                    }
                }
                Spacer(Modifier.height(16.dp))
                Button(
                    onClick = { PipelineBus.submitVideoInfo(VideoInfo(name.trim(), year.ifBlank { null }, burnedIn)) },
                    enabled = name.isNotBlank(),
                    modifier = Modifier.fillMaxWidth(),
                ) { Text(stringResource(R.string.video_info_confirm)) }
            }
        }

        is PipelineState.NeedTranslationChoice -> Dialog(dismissable = false) {
            Column {
                Text(stringResource(R.string.choose_translation), style = MaterialTheme.typography.titleMedium)
                Spacer(Modifier.height(16.dp))
                Button(onClick = { PipelineBus.submitTranslationChoice(TranslationChoice.LOCAL) }, modifier = Modifier.fillMaxWidth()) {
                    Text(stringResource(R.string.translate_local))
                }
                Spacer(Modifier.height(8.dp))
                Button(
                    onClick = { PipelineBus.submitTranslationChoice(TranslationChoice.CLOUD) },
                    enabled = state.cloudAvailable,
                    modifier = Modifier.fillMaxWidth(),
                ) { Text(stringResource(R.string.translate_cloud)) }
                if (!state.cloudAvailable) {
                    Text("להוספת מפתח Claude בהגדרות", style = MaterialTheme.typography.bodySmall)
                }
                Spacer(Modifier.height(8.dp))
                OutlinedButton(onClick = { PipelineBus.submitTranslationChoice(TranslationChoice.STOP) }, modifier = Modifier.fillMaxWidth()) {
                    Text(stringResource(R.string.translate_stop))
                }
            }
        }

        is PipelineState.NeedAsrConsent -> Dialog(dismissable = false) {
            Column {
                Text(stringResource(R.string.asr_offer), style = MaterialTheme.typography.titleMedium)
                Spacer(Modifier.height(16.dp))
                Button(
                    onClick = { PipelineBus.submitAsrConsent(true) },
                    enabled = state.asrAvailable,
                    modifier = Modifier.fillMaxWidth(),
                ) { Text(stringResource(R.string.asr_yes)) }
                if (!state.asrAvailable) Text("תמלול אינו זמין בגרסה זו", style = MaterialTheme.typography.bodySmall)
                Spacer(Modifier.height(8.dp))
                OutlinedButton(onClick = { PipelineBus.submitAsrConsent(false) }, modifier = Modifier.fillMaxWidth()) {
                    Text(stringResource(R.string.asr_no))
                }
            }
        }

        is PipelineState.NeedOutputChoice -> Dialog(dismissable = false) {
            Column {
                Text(stringResource(R.string.choose_output), style = MaterialTheme.typography.titleMedium)
                Spacer(Modifier.height(16.dp))
                Button(onClick = { PipelineBus.submitOutputChoice(OutputChoice.SAVE_SRT) }, modifier = Modifier.fillMaxWidth()) {
                    Text(stringResource(R.string.output_srt))
                }
                Spacer(Modifier.height(8.dp))
                Button(
                    onClick = { PipelineBus.submitOutputChoice(OutputChoice.EMBED_MEDIA) },
                    enabled = state.embedMediaAvailable,
                    modifier = Modifier.fillMaxWidth(),
                ) { Text(stringResource(R.string.output_media)) }
            }
        }

        is PipelineState.Success -> Dialog(onDismiss = { PipelineBus.reset() }) {
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
                Spacer(Modifier.height(16.dp))
                Button(onClick = { PipelineBus.reset() }, modifier = Modifier.fillMaxWidth()) { Text("סגירה") }
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
