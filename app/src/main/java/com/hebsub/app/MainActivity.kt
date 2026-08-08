package com.hebsub.app

import android.Manifest
import android.content.Intent
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.hebsub.app.data.SettingsRepository
import com.hebsub.app.log.RunLog
import com.hebsub.app.pipeline.OutputChoice
import com.hebsub.app.pipeline.PipelineBus
import com.hebsub.app.pipeline.PipelineState
import com.hebsub.app.pipeline.TranslationChoice
import com.hebsub.app.service.ProcessingService
import com.hebsub.core.provider.claude.ClaudeApi

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
    val notifLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { onDone() }

    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(stringResource(R.string.onboarding_title), style = MaterialTheme.typography.headlineMedium)
        Spacer(Modifier.height(16.dp))
        Text(stringResource(R.string.onboarding_body), style = MaterialTheme.typography.bodyLarge)
        Spacer(Modifier.height(32.dp))
        Button(onClick = {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                notifLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
            } else onDone()
        }) { Text(stringResource(R.string.grant_permissions)) }
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
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Text(stringResource(R.string.home_title), style = MaterialTheme.typography.headlineSmall)
            TextButton(onClick = onOpenSettings) { Text(stringResource(R.string.settings)) }
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

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SettingsScreen(settings: SettingsRepository, onBack: () -> Unit) {
    var online by remember { mutableStateOf(settings.onlineSearchEnabled) }
    var osKey by remember { mutableStateOf(settings.openSubtitlesApiKey) }
    var anthropicKey by remember { mutableStateOf(settings.anthropicApiKey) }
    var deepgramKey by remember { mutableStateOf(settings.deepgramApiKey) }
    var model by remember { mutableStateOf(settings.claudeModel) }
    var modelMenu by remember { mutableStateOf(false) }

    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp).verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text(stringResource(R.string.settings_title), style = MaterialTheme.typography.headlineSmall)

        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Text(stringResource(R.string.settings_online_search))
            Switch(checked = online, onCheckedChange = { online = it })
        }

        OutlinedTextField(
            value = osKey, onValueChange = { osKey = it },
            label = { Text(stringResource(R.string.settings_os_key)) },
            visualTransformation = PasswordVisualTransformation(),
            singleLine = true, modifier = Modifier.fillMaxWidth(),
        )
        OutlinedTextField(
            value = anthropicKey, onValueChange = { anthropicKey = it },
            label = { Text(stringResource(R.string.settings_anthropic_key)) },
            visualTransformation = PasswordVisualTransformation(),
            singleLine = true, modifier = Modifier.fillMaxWidth(),
        )
        OutlinedTextField(
            value = deepgramKey, onValueChange = { deepgramKey = it },
            label = { Text(stringResource(R.string.settings_deepgram_key)) },
            visualTransformation = PasswordVisualTransformation(),
            singleLine = true, modifier = Modifier.fillMaxWidth(),
        )

        ExposedDropdownMenuBox(expanded = modelMenu, onExpandedChange = { modelMenu = it }) {
            OutlinedTextField(
                value = model, onValueChange = {}, readOnly = true,
                label = { Text(stringResource(R.string.settings_model)) },
                modifier = Modifier.fillMaxWidth().menuAnchor(),
            )
            ExposedDropdownMenu(expanded = modelMenu, onDismissRequest = { modelMenu = false }) {
                ClaudeApi.AVAILABLE_MODELS.forEach { m ->
                    DropdownMenuItem(text = { Text(m) }, onClick = { model = m; modelMenu = false })
                }
            }
        }

        Text(stringResource(R.string.settings_privacy_note), style = MaterialTheme.typography.bodySmall)

        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Button(
                onClick = {
                    settings.onlineSearchEnabled = online
                    settings.openSubtitlesApiKey = osKey
                    settings.anthropicApiKey = anthropicKey
                    settings.deepgramApiKey = deepgramKey
                    settings.claudeModel = model
                    onBack()
                },
                modifier = Modifier.weight(1f),
            ) { Text(stringResource(R.string.save)) }
            OutlinedButton(onClick = onBack, modifier = Modifier.weight(1f)) { Text("ביטול") }
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
                if (state.muxed) Text("• Movies/HebSub/${state.videoName}", style = MaterialTheme.typography.bodySmall)
                Text("• Download/HebSub/${state.srtName}", style = MaterialTheme.typography.bodySmall)
                Text("• יומן: Download/HebSub/HebSub-log-*.txt", style = MaterialTheme.typography.bodySmall)
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
                Text("יומן מפורט נשמר ב־Download/HebSub/HebSub-log-*.txt", style = MaterialTheme.typography.bodySmall)
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
