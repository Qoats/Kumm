package fr.kumm.nativeapp

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.io.IOException
import java.time.Instant

data class Load<T>(val value: T? = null, val loading: Boolean = false, val error: String? = null)

internal data class KummState(
    val stops: Load<List<Stop>> = Load(),
    val departures: Load<List<Departure>> = Load(),
    val fleet: Load<Fleet> = Load(),
    val selectedStop: Stop? = null,
    val homeInfo: Load<HomeInfo> = Load()
)

internal class KummViewModel : ViewModel() {
    private val repository = TransportRepository()
    private val mutableState = MutableStateFlow(KummState())
    val state = mutableState.asStateFlow()
    val isDemo = repository.isDemo
    private var stopJob: Job? = null
    private var departuresJob: Job? = null

    init {
        loadStops()
        refreshHomeInfo()
    }

    private fun refreshHomeInfo() = viewModelScope.launch {
        mutableState.update { it.copy(homeInfo = Load(loading = true)) }
        try {
            val info = repository.homeInfo()
            mutableState.update { it.copy(homeInfo = Load(value = info)) }
        } catch (e: Exception) {
            if (e is CancellationException) throw e
            mutableState.update { it.copy(homeInfo = Load(error = message(e))) }
        }
    }

    fun loadStops() {
        if (stopJob?.isActive == true) return
        stopJob = viewModelScope.launch {
            mutableState.update { it.copy(stops = it.stops.copy(loading = true, error = null)) }
            try {
                val stops = repository.stops()
                mutableState.update { it.copy(stops = Load(value = stops)) }
            } catch (e: Exception) {
                if (e is CancellationException) throw e
                mutableState.update { it.copy(stops = it.stops.copy(loading = false, error = message(e))) }
            }
        }
    }

    fun selectStop(stop: Stop?) {
        departuresJob?.cancel()
        mutableState.update { it.copy(selectedStop = stop, departures = Load()) }
        if (stop != null) loadDepartures()
    }

    fun loadDepartures() {
        val stop = state.value.selectedStop ?: return
        if (departuresJob?.isActive == true && state.value.departures.loading) return
        departuresJob = viewModelScope.launch {
            mutableState.update { it.copy(departures = it.departures.copy(loading = true, error = null)) }
            try {
                val cutoff = Instant.now().toEpochMilli() - 30_000
                val departures = repository.departures(stop).filter { it.time >= cutoff }
                mutableState.update { it.copy(departures = Load(value = departures)) }
            } catch (e: Exception) {
                if (e is CancellationException) throw e
                mutableState.update { it.copy(departures = it.departures.copy(loading = false, error = message(e))) }
            }
        }
    }

    suspend fun refreshFleet() {
        mutableState.update { it.copy(fleet = it.fleet.copy(loading = true, error = null)) }
        try {
            val fleet = repository.fleet()
            mutableState.update { it.copy(fleet = Load(value = fleet)) }
        } catch (e: Exception) {
            if (e is CancellationException) {
                mutableState.update { it.copy(fleet = it.fleet.copy(loading = false)) }
                throw e
            }
            mutableState.update { it.copy(fleet = it.fleet.copy(loading = false, error = message(e))) }
        }
    }

    private fun message(error: Exception): String = when {
        error is TransportException && error.status in listOf(401, 403) -> "Accès au serveur refusé."
        error is TransportException && error.status == 429 -> "Trop de demandes. Réessaie dans un instant."
        error is IOException -> "Impossible de joindre les données de transport."
        else -> "Les données reçues sont illisibles."
    }
}
