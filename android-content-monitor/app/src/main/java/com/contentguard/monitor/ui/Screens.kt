package com.contentguard.monitor.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Divider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.contentguard.monitor.R
import com.contentguard.monitor.model.MonitorReport
import com.contentguard.monitor.model.VideoFinding
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

private val dayFmt = SimpleDateFormat("yyyy-MM-dd", Locale.US)

@Composable
fun HomeScreen(onOpenSearch: () -> Unit) {
    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Text(stringResource(R.string.home_title), style = MaterialTheme.typography.headlineMedium)
        Spacer(Modifier.height(8.dp))
        Text(
            stringResource(R.string.home_subtitle),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
        Spacer(Modifier.height(40.dp))
        Button(onClick = onOpenSearch) {
            Text(stringResource(R.string.open_search))
        }
    }
}

@Composable
fun SearchScreen(onSearch: (String) -> Unit) {
    var handle by remember { mutableStateOf("") }
    var attested by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    fun submit() {
        when {
            handle.isBlank() -> error = "handle_required"
            !attested -> error = "ownership_required"
            else -> { error = null; onSearch(handle) }
        }
    }

    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.Center
    ) {
        OutlinedTextField(
            value = handle,
            onValueChange = { handle = it },
            label = { Text(stringResource(R.string.search_hint)) },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
            keyboardActions = KeyboardActions(onSearch = { submit() })
        )
        Spacer(Modifier.height(16.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Checkbox(checked = attested, onCheckedChange = { attested = it })
            Text(
                stringResource(R.string.ownership_attestation),
                style = MaterialTheme.typography.bodySmall
            )
        }
        error?.let {
            Spacer(Modifier.height(8.dp))
            val msg = if (it == "handle_required")
                stringResource(R.string.handle_required)
            else
                stringResource(R.string.ownership_required)
            Text(msg, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
        }
        Spacer(Modifier.height(24.dp))
        Button(onClick = { submit() }, modifier = Modifier.fillMaxWidth()) {
            Text(stringResource(R.string.search_button))
        }
    }
}

@Composable
fun LoadingScreen() {
    Column(
        modifier = Modifier.fillMaxSize(),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        CircularProgressIndicator()
        Spacer(Modifier.height(16.dp))
        Text(stringResource(R.string.searching))
    }
}

@Composable
fun ResultsScreen(
    report: MonitorReport,
    onOpenUrl: (String) -> Unit,
    onBack: () -> Unit
) {
    LazyColumn(
        modifier = Modifier.fillMaxSize().padding(horizontal = 16.dp),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(vertical = 16.dp)
    ) {
        item {
            Text(
                stringResource(R.string.results_title) + "  •  ${report.handle}",
                style = MaterialTheme.typography.titleLarge
            )
            Spacer(Modifier.height(4.dp))
            Text(
                stringResource(R.string.data_source) + ": ${report.dataSourceName}",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Spacer(Modifier.height(16.dp))
        }

        if (report.isDemo) {
            item { DemoBanner() ; Spacer(Modifier.height(16.dp)) }
        } else {
            item { SummaryCard(report); Spacer(Modifier.height(16.dp)) }
        }

        if (report.videos.isEmpty()) {
            item {
                Text(
                    if (report.isDemo) "" else stringResource(R.string.no_results),
                    style = MaterialTheme.typography.bodyMedium
                )
            }
        } else {
            items(report.videos) { v ->
                VideoRow(v, onOpenUrl)
                Divider()
            }
        }

        item {
            Spacer(Modifier.height(20.dp))
            OutlinedButton(onClick = onBack, modifier = Modifier.fillMaxWidth()) {
                Text(stringResource(R.string.back))
            }
        }
    }
}

@Composable
private fun SummaryCard(report: MonitorReport) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp)) {
            StatRow(stringResource(R.string.total_videos), report.totalVideos.toString())
            StatRow(stringResource(R.string.last_12_months), report.videosLast12Months.toString())
            StatRow(stringResource(R.string.with_duration), report.withKnownDuration.toString())
        }
    }
}

@Composable
private fun StatRow(label: String, value: String) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
        horizontalArrangement = Arrangement.SpaceBetween
    ) {
        Text(label, style = MaterialTheme.typography.bodyMedium)
        Text(value, style = MaterialTheme.typography.titleMedium)
    }
}

@Composable
private fun DemoBanner() {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp)) {
            Text(
                stringResource(R.string.no_source_title),
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.error
            )
            Spacer(Modifier.height(8.dp))
            Text(stringResource(R.string.no_source_body), style = MaterialTheme.typography.bodySmall)
        }
    }
}

@Composable
private fun VideoRow(v: VideoFinding, onOpenUrl: (String) -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clickable { onOpenUrl(v.url) }
            .padding(vertical = 12.dp)
    ) {
        Text(
            v.title.ifBlank { v.url },
            style = MaterialTheme.typography.bodyLarge,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis
        )
        Spacer(Modifier.height(4.dp))
        val date = v.detectedAt?.let { dayFmt.format(Date(it)) } ?: stringResource(R.string.date_unknown)
        val dur = if (v.durationSeconds != null)
            stringResource(R.string.duration) + " " + v.durationLabel
        else
            stringResource(R.string.duration_unknown)
        Text(
            "${v.siteName}  •  $dur  •  $date",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
    }
}
