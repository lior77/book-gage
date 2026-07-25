package com.contentguard.monitor

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.contentguard.monitor.ui.HomeScreen
import com.contentguard.monitor.ui.LoadingScreen
import com.contentguard.monitor.ui.ResultsScreen
import com.contentguard.monitor.ui.SearchScreen
import com.contentguard.monitor.ui.theme.ContentGuardTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            ContentGuardTheme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background
                ) {
                    AppRoot(onOpenUrl = ::openUrl)
                }
            }
        }
    }

    private fun openUrl(url: String) {
        try {
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
        } catch (_: Exception) {
            // No browser available; ignore.
        }
    }
}

@Composable
private fun AppRoot(onOpenUrl: (String) -> Unit) {
    val vm: MainViewModel = viewModel()
    val state by vm.state.collectAsState()

    when (val s = state) {
        is UiState.Home -> HomeScreen(onOpenSearch = vm::openSearch)
        is UiState.Search -> SearchScreen(onSearch = vm::search)
        is UiState.Loading -> LoadingScreen()
        is UiState.Results -> ResultsScreen(
            report = s.report,
            onOpenUrl = onOpenUrl,
            onBack = vm::goHome
        )
        is UiState.Error -> ErrorView(s.message, onBack = vm::goHome)
    }
}

@Composable
private fun ErrorView(message: String, onBack: () -> Unit) {
    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Text(message, color = MaterialTheme.colorScheme.error)
        Spacer(Modifier.height(16.dp))
        Button(onClick = onBack) { Text(stringResource(R.string.back)) }
    }
}
