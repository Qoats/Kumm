package fr.kumm.nativeapp

import android.app.DatePickerDialog
import android.app.TimePickerDialog
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.util.Locale

private val plannerZone = ZoneId.of("Europe/Paris")
private val tripClock = DateTimeFormatter.ofPattern("HH:mm", Locale.FRANCE).withZone(plannerZone)
private val tripDate = DateTimeFormatter.ofPattern("dd/MM · HH:mm", Locale.FRANCE).withZone(plannerZone)

@Composable
internal fun PlannerScreen(stops: List<Stop>, demo: Boolean, repository: TransportRepository) {
    var from by remember { mutableStateOf<TripPlace?>(null) }
    var to by remember { mutableStateOf<TripPlace?>(null) }
    var mode by remember { mutableStateOf(TripMode.TRANSIT) }
    var time by remember { mutableStateOf<Instant?>(null) }
    var arriveBy by remember { mutableStateOf(false) }
    var stepFree by remember { mutableStateOf(false) }
    var request by remember { mutableStateOf<TripQuery?>(null) }
    var plans by remember { mutableStateOf<List<TripPlan>?>(null) }
    var selected by remember { mutableStateOf<TripPlan?>(null) }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var attempt by remember { mutableStateOf(0) }
    val focus = LocalFocusManager.current
    val context = LocalContext.current

    fun clearResult() {
        request = null
        plans = null
        selected = null
        loading = false
        error = null
    }

    LaunchedEffect(request, attempt) {
        val query = request ?: return@LaunchedEffect
        loading = true
        error = null
        plans = null
        try {
            plans = repository.plans(query)
        } catch (e: Exception) {
            if (e is CancellationException) throw e
            error = if (e is TransportException && e.status in listOf(401, 403)) "Accès au serveur refusé."
                else "Le calcul a échoué. Vérifie ta connexion et réessaie."
        } finally {
            loading = false
        }
    }

    BackHandler(selected != null) { selected = null }
    val plan = selected
    if (plan != null) {
        Column(Modifier.fillMaxSize()) {
            TextButton(onClick = { selected = null }) { Text("Retour aux itinéraires") }
            NetworkMap(Load(), null, null, tripPaths = plan.paths)
        }
        return
    }

    LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item {
            PlaceInput("Départ", from, stops, repository) { from = it; clearResult() }
        }
        item {
            PlaceInput("Destination", to, stops, repository) { to = it; clearResult() }
        }
        item {
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                TripMode.entries.forEach { option ->
                    FilterChip(selected = mode == option, onClick = { mode = option; clearResult() }, label = { Text(option.label) })
                }
            }
        }
        if (mode == TripMode.TRANSIT) item {
            Column {
                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterChip(selected = time == null, onClick = { time = null; arriveBy = false; clearResult() },
                        label = { Text("Maintenant") })
                    TextButton(onClick = {
                        val initial = (time ?: Instant.now()).atZone(plannerZone)
                        DatePickerDialog(context, { _, year, month, day ->
                            val date = LocalDate.of(year, month + 1, day)
                            TimePickerDialog(context, { _, hour, minute ->
                                time = ZonedDateTime.of(date, LocalTime.of(hour, minute), plannerZone).toInstant()
                                clearResult()
                            }, initial.hour, initial.minute, true).show()
                        }, initial.year, initial.monthValue - 1, initial.dayOfMonth).show()
                    }) { Text(time?.let(tripDate::format) ?: "Choisir la date et l’heure") }
                }
                if (time != null) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        FilterChip(selected = !arriveBy, onClick = { arriveBy = false; clearResult() }, label = { Text("Partir à") })
                        FilterChip(selected = arriveBy, onClick = { arriveBy = true; clearResult() }, label = { Text("Arriver avant") })
                    }
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(stepFree, onCheckedChange = { stepFree = it; clearResult() })
                    Text("Trajet sans escaliers")
                }
            }
        }
        item {
            val origin = from
            val destination = to
            val valid = origin != null && destination != null && origin.position.distance(destination.position) >= 15
            Button(enabled = valid && !loading, onClick = {
                focus.clearFocus()
                if (origin != null && destination != null) {
                    request = TripQuery(origin, destination, mode, time, arriveBy, stepFree)
                    attempt++
                }
            }) { Text("Calculer l’itinéraire") }
            if (origin != null && destination != null && !valid) Text("Choisis deux lieux différents.")
        }
        if (demo) item { Text("Démo · trajets simulés", color = LocalAlsace.current.muted) }
        if (loading) item { LinearProgressIndicator(Modifier.fillMaxWidth()) }
        error?.let { message -> item { Text(message, color = MaterialTheme.colorScheme.error) } }
        if (plans?.isEmpty() == true) item { Text("Aucun trajet trouvé pour ce mode.") }
        plans.orEmpty().forEachIndexed { index, result ->
            item(key = "plan-$index") {
                Surface(shape = MaterialTheme.shapes.medium, color = LocalAlsace.current.card) {
                    Column(Modifier.fillMaxWidth().padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        val times = if (result.start != null && result.end != null)
                            " · ${tripClock.format(result.start)} → ${tripClock.format(result.end)}" else ""
                        Text("${((result.seconds + 30) / 60).coerceAtLeast(1)} min$times", style = MaterialTheme.typography.titleMedium)
                        result.legs.forEach { leg ->
                            HorizontalDivider(color = LocalAlsace.current.line)
                            val departure = leg.start?.let { " · " + tripClock.format(it) }.orEmpty()
                            Text(leg.label + departure, style = MaterialTheme.typography.labelLarge)
                            if (leg.detail.isNotBlank()) Text(leg.detail, style = MaterialTheme.typography.bodyMedium)
                        }
                        if (result.paths.isNotEmpty()) TextButton(onClick = { selected = result }) { Text("Voir le trajet sur la carte") }
                    }
                }
            }
        }
    }
}

@Composable
private fun PlaceInput(label: String, selected: TripPlace?, stops: List<Stop>,
    repository: TransportRepository, select: (TripPlace?) -> Unit) {
    var value by rememberSaveable { mutableStateOf(selected?.name.orEmpty()) }
    var focused by remember { mutableStateOf(false) }
    var addresses by remember { mutableStateOf<List<TripPlace>>(emptyList()) }
    val focus = LocalFocusManager.current
    val query = fold(value)
    LaunchedEffect(value, selected, focused) {
        addresses = emptyList()
        if (focused && selected == null && query.length >= 2) {
            delay(350)
            try {
                addresses = repository.addresses(value)
            } catch (e: Exception) {
                if (e is CancellationException) throw e
            }
        }
    }
    Column {
        OutlinedTextField(value, onValueChange = {
            value = it
            if (selected != null) select(null)
        }, label = { Text(label) }, singleLine = true,
            modifier = Modifier.fillMaxWidth().onFocusChanged { focused = it.isFocused })
        if (focused && selected == null) {
            val matches = stops.asSequence().filter { fold(it.name).contains(query) }.take(5)
                .map { TripPlace(it.name, it.position) }.toList()
            (matches + addresses).distinctBy { fold(it.name) }.take(8).forEach { match ->
                ListItem(headlineContent = { Text(match.name) }, modifier = Modifier.clickable {
                    value = match.name
                    select(match)
                    focus.clearFocus()
                })
            }
        }
    }
}
