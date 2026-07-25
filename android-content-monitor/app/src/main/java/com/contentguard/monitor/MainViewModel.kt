package com.contentguard.monitor

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.contentguard.monitor.data.MonitorRepository
import com.contentguard.monitor.model.MonitorReport
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/** Screens are modelled as a small sealed state to avoid a navigation dependency. */
sealed interface UiState {
    data object Home : UiState
    data object Search : UiState
    data object Loading : UiState
    data class Results(val report: MonitorReport) : UiState
    data class Error(val message: String) : UiState
}

class MainViewModel(
    private val repository: MonitorRepository = MonitorRepository(),
    private val clock: () -> Long = { System.currentTimeMillis() }
) : ViewModel() {

    private val _state = MutableStateFlow<UiState>(UiState.Home)
    val state: StateFlow<UiState> = _state.asStateFlow()

    fun openSearch() { _state.value = UiState.Search }

    fun goHome() { _state.value = UiState.Home }

    fun search(handle: String) {
        _state.value = UiState.Loading
        viewModelScope.launch {
            try {
                val report = repository.run(handle, clock())
                _state.value = UiState.Results(report)
            } catch (e: Exception) {
                _state.value = UiState.Error(e.message ?: "Unknown error")
            }
        }
    }
}
