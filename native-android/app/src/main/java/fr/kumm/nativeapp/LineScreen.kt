package fr.kumm.nativeapp

import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import org.json.JSONArray
import org.json.JSONObject

internal data class LineStop(val code: String, val name: String)
internal data class LineDirection(val destination: String, val stops: List<LineStop>)

internal fun parseLineDirections(json: JSONObject): List<LineDirection> {
    fun rows(array: JSONArray?) = if (array == null) emptyList() else (0 until array.length()).mapNotNull(array::optJSONObject)
    return (rows(json.optJSONArray("main")) + rows(json.optJSONArray("other"))).mapNotNull { route ->
        val destination = route.optString("dest").takeIf(String::isNotBlank) ?: return@mapNotNull null
        val names = route.optJSONArray("names") ?: return@mapNotNull null
        val codes = route.optJSONArray("codes")
        val stops = (0 until names.length()).mapNotNull { i ->
            names.optString(i).takeIf(String::isNotBlank)?.let { LineStop(codes?.optString(i).orEmpty(), it) }
        }
        if (stops.size >= 2) LineDirection(destination, stops) else null
    }.distinct()
}

@Composable
internal fun LineScreen(line: String, stops: List<Stop>, repository: TransportRepository,
    openStop: (Stop) -> Unit, showMap: () -> Unit) {
    var directions by remember(line) { mutableStateOf<List<LineDirection>>(emptyList()) }
    var selected by remember(line) { mutableStateOf(0) }
    var retry by remember(line) { mutableStateOf(0) }
    var loading by remember(line) { mutableStateOf(true) }
    var failed by remember(line) { mutableStateOf(false) }

    LaunchedEffect(line, retry) {
        loading = true
        failed = false
        try {
            directions = repository.lineDirections(line)
            selected = 0
        } catch (e: Exception) {
            if (e is CancellationException) throw e
            failed = true
        } finally {
            loading = false
        }
    }

    LazyColumn(contentPadding = PaddingValues(vertical = 8.dp)) {
        item {
            Row(Modifier.padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                TextButton(onClick = showMap) { Text("Véhicules sur la carte") }
            }
        }
        if (loading) item { LinearProgressIndicator(Modifier.fillMaxWidth()) }
        if (failed) item { TextButton(onClick = { retry++ }) { Text("Parcours indisponible · Réessayer") } }
        if (!loading && !failed && directions.isEmpty()) {
            item { Text("Aucun parcours disponible pour cette ligne.", Modifier.padding(16.dp)) }
        }
        if (directions.isNotEmpty()) {
            item {
                Row(Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    directions.forEachIndexed { index, direction ->
                        FilterChip(selected == index, onClick = { selected = index }, label = { Text("Vers ${direction.destination}") })
                    }
                }
            }
            itemsIndexed(directions.getOrNull(selected)?.stops.orEmpty()) { index, call ->
                val match = stops.firstOrNull { it.id == call.code || call.code in it.refs }
                    ?: stops.firstOrNull { fold(it.name) == fold(call.name) }
                ListItem(headlineContent = { Text(call.name) },
                    leadingContent = { Text((index + 1).toString(), color = MaterialTheme.colorScheme.primary) },
                    modifier = if (match == null) Modifier else Modifier.clickable { openStop(match) })
                HorizontalDivider(Modifier.padding(horizontal = 16.dp))
            }
        }
    }
}
