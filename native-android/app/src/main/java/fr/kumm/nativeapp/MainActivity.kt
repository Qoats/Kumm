package fr.kumm.nativeapp

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Place
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.repeatOnLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.delay
import org.maplibre.android.MapLibre
import java.time.Instant
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.util.Locale

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        MapLibre.getInstance(this)
        setContent {
            val dark = isSystemInDarkTheme()
            MaterialTheme(colorScheme = if (dark) nightColors else dayColors) {
                KummApp()
            }
        }
    }
}

private val dayColors = lightColorScheme(
    primary = Color(0xFF9F3224), onPrimary = Color.White,
    primaryContainer = Color(0xFFFCE3DC), onPrimaryContainer = Color(0xFF672319),
    background = Color(0xFFFBF8F4), surface = Color(0xFFFBF8F4),
    surfaceVariant = Color(0xFFF2E9E2), onSurface = Color(0xFF211711)
)
private val nightColors = darkColorScheme(
    primary = Color(0xFFFFAB9C), onPrimary = Color(0xFF5C1B12),
    primaryContainer = Color(0xFF612B21), onPrimaryContainer = Color(0xFFFFDAD2),
    background = Color(0xFF17110F), surface = Color(0xFF17110F),
    surfaceVariant = Color(0xFF342722), onSurface = Color(0xFFF9F0EB)
)

private enum class Tab(val title: String) { HOME("Accueil"), SEARCH("Recherche"), MAP("Carte") }
private val paris = ZoneId.of("Europe/Paris")
private val clockFormat = DateTimeFormatter.ofPattern("HH:mm", Locale.FRANCE).withZone(paris)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun KummApp(model: KummViewModel = viewModel()) {
    val state by model.state.collectAsStateWithLifecycle()
    var tab by rememberSaveable { mutableStateOf(Tab.HOME) }
    var query by rememberSaveable { mutableStateOf("") }
    var mapFocus by remember { mutableStateOf<Position?>(null) }
    val lifecycle = LocalLifecycleOwner.current.lifecycle

    LaunchedEffect(tab, lifecycle) {
        if (tab != Tab.MAP) return@LaunchedEffect
        lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            while (true) {
                model.refreshFleet()
                delay(20_000)
            }
        }
    }

    val stop = state.selectedStop
    BackHandler(tab != Tab.HOME || stop != null) {
        if (stop != null) model.selectStop(null) else tab = Tab.HOME
    }

    Scaffold(
        contentWindowInsets = WindowInsets.safeDrawing,
        topBar = {
            if (tab != Tab.HOME || stop != null) {
                TopAppBar(
                    title = { Text(stop?.name ?: if (tab == Tab.MAP) "Carte du réseau" else "Trouver un arrêt") },
                    navigationIcon = {
                        if (stop != null) IconButton(onClick = { model.selectStop(null) }) {
                            Icon(Icons.Filled.ArrowBack, "Retour")
                        }
                    }
                )
            }
        },
        bottomBar = {
            NavigationBar {
                for (item in Tab.entries) {
                    NavigationBarItem(
                        selected = tab == item,
                        onClick = {
                            model.selectStop(null)
                            tab = item
                        },
                        label = { Text(item.title) },
                        icon = {
                            Icon(when (item) {
                                Tab.HOME -> Icons.Filled.Home
                                Tab.SEARCH -> Icons.Filled.Search
                                Tab.MAP -> Icons.Filled.Place
                            }, null)
                        }
                    )
                }
            }
        }
    ) { insets ->
        Column(Modifier.fillMaxSize().padding(insets).consumeWindowInsets(insets)) {
            if (model.isDemo && (tab != Tab.HOME || stop != null)) DemoLabel()
            when {
                stop != null -> StopScreen(stop, state.departures, model::loadDepartures) {
                    mapFocus = stop.position
                    model.selectStop(null)
                    tab = Tab.MAP
                }
                tab == Tab.HOME -> HomeScreen(model.isDemo, { tab = Tab.SEARCH }, {
                    mapFocus = null
                    tab = Tab.MAP
                })
                tab == Tab.SEARCH -> SearchScreen(query, { query = it }, state.stops, model::loadStops, model::selectStop)
                tab == Tab.MAP -> NetworkMap(state.fleet, mapFocus)
            }
        }
    }
}

@Composable
private fun DemoLabel() {
    Surface(color = MaterialTheme.colorScheme.primaryContainer) {
        Text("Mode démo · horaires et positions simulés", Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
            style = MaterialTheme.typography.labelMedium)
    }
}

@Composable
private fun HomeScreen(demo: Boolean, search: () -> Unit, map: () -> Unit) {
    val date = ZonedDateTime.now(paris)
    val greeting = if (date.hour < 12) "Güete Morje !" else if (date.hour < 18) "Güete Dàà !" else "Güete Owe !"
    LazyColumn(contentPadding = PaddingValues(20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        item {
            Column {
                Text("KUMM  /  STRASBOURG", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary)
                Text(date.format(DateTimeFormatter.ofPattern("EEEE d MMMM", Locale.FRANCE)), Modifier.padding(top = 16.dp),
                    style = MaterialTheme.typography.bodyMedium)
                Text(greeting, style = MaterialTheme.typography.headlineLarge, fontWeight = FontWeight.Bold)
                Text("Tes transports, au même endroit.", style = MaterialTheme.typography.bodyLarge)
            }
        }
        if (demo) item { DemoLabel() }
        item {
            HomeCard("Prochains départs", "Trouve ton arrêt et consulte les passages CTS et TER.",
                "Chercher un arrêt", search, featured = true)
        }
        item {
            HomeCard("Sur la carte", "Repère les trams, les bus et les TER en circulation.",
                "Ouvrir la carte", map)
        }
    }
}

@Composable
private fun HomeCard(title: String, description: String, action: String, click: () -> Unit, featured: Boolean = false) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = if (featured) MaterialTheme.colorScheme.primaryContainer
            else MaterialTheme.colorScheme.surfaceVariant)
    ) {
        Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(title, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
            Text(description, style = MaterialTheme.typography.bodyMedium)
            Button(onClick = click) { Text(action) }
        }
    }
}

@Composable
private fun SearchScreen(query: String, updateQuery: (String) -> Unit, stops: Load<List<Stop>>, retry: () -> Unit, open: (Stop) -> Unit) {
    val matches = remember(query, stops.value) {
        val words = fold(query).split(' ').filter(String::isNotEmpty)
        stops.value.orEmpty().filter { stop -> words.all { it in fold(stop.name) } }.take(60)
    }
    Column(Modifier.fillMaxSize()) {
        OutlinedTextField(
            value = query, onValueChange = updateQuery, singleLine = true, label = { Text("Nom de l’arrêt") },
            leadingIcon = { Icon(Icons.Filled.Search, null) },
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)
        )
        Status(stops, retry)
        LazyColumn {
            if (!stops.loading && stops.error == null && matches.isEmpty()) {
                item { Text("Aucun arrêt trouvé.", Modifier.padding(16.dp)) }
            }
            items(matches, key = Stop::id) { stop ->
                Surface(onClick = { open(stop) }, modifier = Modifier.fillMaxWidth()) {
                    ListItem(headlineContent = { Text(stop.name) },
                        supportingContent = { Text(if (stop.uic != null) "Gare TER" else "Arrêt CTS") },
                        leadingContent = { Icon(Icons.Filled.Place, null) })
                }
                HorizontalDivider(Modifier.padding(horizontal = 16.dp))
            }
        }
    }
}

@Composable
private fun StopScreen(stop: Stop, departures: Load<List<Departure>>, retry: () -> Unit, showOnMap: () -> Unit) {
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp), horizontalArrangement = Arrangement.SpaceBetween) {
            TextButton(onClick = showOnMap) { Text("Voir sur la carte") }
            IconButton(onClick = retry) { Icon(Icons.Filled.Refresh, "Actualiser les départs") }
        }
        Status(departures, retry)
        LazyColumn {
            if (!departures.loading && departures.error == null && departures.value?.isEmpty() == true) {
                item { Text("Aucun départ prévu pour ${stop.name}.", Modifier.padding(16.dp)) }
            }
            items(departures.value.orEmpty()) { departure ->
                ListItem(
                    headlineContent = { Text(departure.destination.ifBlank { "Destination inconnue" }) },
                    leadingContent = { Text(departure.line, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.primary) },
                    trailingContent = {
                        Text(if (departure.cancelled) "Supprimé" else clockFormat.format(Instant.ofEpochMilli(departure.time)))
                    }
                )
                HorizontalDivider(Modifier.padding(horizontal = 16.dp))
            }
        }
    }
}

@Composable
private fun Status(load: Load<*>, retry: () -> Unit) {
    if (load.loading) LinearProgressIndicator(Modifier.fillMaxWidth())
    load.error?.let {
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp), horizontalArrangement = Arrangement.SpaceBetween) {
            Box(Modifier.weight(1f).padding(top = 12.dp)) { Text(it, color = MaterialTheme.colorScheme.error) }
            TextButton(onClick = retry) { Text("Réessayer") }
        }
    }
}
