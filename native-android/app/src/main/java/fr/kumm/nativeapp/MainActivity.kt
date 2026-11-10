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
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Place
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.RadioButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.core.view.WindowCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.repeatOnLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.delay
import org.maplibre.android.MapLibre
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        MapLibre.getInstance(this)
        setContent {
            val preferences = remember { getSharedPreferences("alsace", MODE_PRIVATE) }
            var appearance by remember { mutableStateOf(preferences.getString("theme", "system") ?: "system") }
            val dark = appearance == "dark" || (appearance == "system" && isSystemInDarkTheme())
            SideEffect {
                WindowCompat.getInsetsController(window, window.decorView).apply {
                    isAppearanceLightStatusBars = !dark
                    isAppearanceLightNavigationBars = !dark
                }
            }
            CompositionLocalProvider(LocalAlsace provides if (dark) alsaceNight else alsaceDay) {
                MaterialTheme(colorScheme = if (dark) nightColors else dayColors) {
                    KummApp(appearance = appearance, changeAppearance = {
                        appearance = it
                        preferences.edit().putString("theme", it).apply()
                    })
                }
            }
        }
    }
}

private val dayColors = lightColorScheme(
    primary = Color(0xFFB23A2B), onPrimary = Color.White,
    primaryContainer = Color(0xFFFCE3DC), onPrimaryContainer = Color(0xFF672319),
    background = Color(0xFFFBF8F4), surface = Color(0xFFFBF8F4),
    surfaceVariant = Color(0xFFF3ECE6), onSurface = Color(0xFF231A16)
)
private val nightColors = darkColorScheme(
    primary = Color(0xFFF0806C), onPrimary = Color(0xFF5C1B12),
    primaryContainer = Color(0xFF612B21), onPrimaryContainer = Color(0xFFFFDAD2),
    background = alsaceNightBackground, surface = alsaceNightBackground,
    surfaceVariant = Color(0xFF2E2420), onSurface = Color(0xFFF4ECE6)
)

private enum class HomeDialog { TRAFFIC, BIKE, SETTINGS, ACCOUNT }
private enum class Pick { NONE, HOME, WORK, FAVOURITE }
private val paris = ZoneId.of("Europe/Paris")
private val clockFormat = DateTimeFormatter.ofPattern("HH:mm", Locale.FRANCE).withZone(paris)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun KummApp(appearance: String, changeAppearance: (String) -> Unit, model: KummViewModel = viewModel()) {
    val state by model.state.collectAsStateWithLifecycle()
    var tab by rememberSaveable { mutableStateOf(Tab.HOME) }
    var lineDetails by rememberSaveable { mutableStateOf<String?>(null) }
    var planning by rememberSaveable { mutableStateOf(false) }
    val plannerRepository = remember { TransportRepository() }
    var query by rememberSaveable { mutableStateOf("") }
    var mapFocus by remember { mutableStateOf<Position?>(null) }
    var mapLine by rememberSaveable { mutableStateOf<String?>(null) }
    var dialog by rememberSaveable { mutableStateOf<HomeDialog?>(null) }
    var pick by rememberSaveable { mutableStateOf(Pick.NONE) }
    val context = LocalContext.current
    val preferences = remember(context) { context.getSharedPreferences("alsace", 0) }
    var homeId by remember { mutableStateOf(preferences.getString("home", null)) }
    var workId by remember { mutableStateOf(preferences.getString("work", null)) }
    var favIds by remember { mutableStateOf(preferences.getStringSet("favourites", emptySet()).orEmpty().toSet()) }
    val stops = state.stops.value.orEmpty()
    val home = stops.firstOrNull { it.id == homeId }
    val work = stops.firstOrNull { it.id == workId }
    fun findStop(reason: Pick) {
        pick = reason
        query = ""
        model.selectStop(null)
        tab = Tab.SEARCH
    }
    fun toggleFavourite(stop: Stop) {
        favIds = if (stop.id in favIds) favIds - stop.id else favIds + stop.id
        preferences.edit().putStringSet("favourites", favIds).apply()
    }
    fun showMap(focus: Position? = null, line: String? = null) {
        lineDetails = null
        mapFocus = focus
        mapLine = line
        model.selectStop(null)
        dialog = null
        tab = Tab.MAP
    }
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
    BackHandler(planning || lineDetails != null || tab != Tab.HOME || stop != null) {
        when {
            planning -> planning = false
            stop != null -> model.selectStop(null)
            lineDetails != null -> lineDetails = null
            else -> { pick = Pick.NONE; tab = Tab.HOME }
        }
    }

    Scaffold(
        contentWindowInsets = WindowInsets.safeDrawing,
        topBar = {
            if (planning || lineDetails != null || tab != Tab.HOME || stop != null) {
                TopAppBar(
                    title = { Text(if (planning) "Itinéraire" else stop?.name ?: lineDetails?.let { "Ligne $it" } ?: when (tab) {
                        Tab.MAP -> mapLine?.let { "Ligne $it" } ?: "Carte du réseau"
                        else -> when (pick) {
                            Pick.HOME -> "Arrêt près de la maison"
                            Pick.WORK -> "Arrêt près du boulot"
                            Pick.FAVOURITE -> "Ajouter un favori"
                            Pick.NONE -> "Trouver un arrêt"
                        }
                    }, fontFamily = bricolage, fontWeight = FontWeight.ExtraBold) },
                    navigationIcon = {
                        if (planning || lineDetails != null || stop != null) IconButton(onClick = {
                            when {
                                planning -> planning = false
                                stop != null -> model.selectStop(null)
                                else -> lineDetails = null
                            }
                        }) {
                            Icon(Icons.AutoMirrored.Filled.ArrowBack, "Retour")
                        }
                    }
                )
            }
        },
        bottomBar = {
            if (!planning && lineDetails == null) AlsaceTabs(tab) { item ->
                model.selectStop(null)
                pick = Pick.NONE
                if (item == Tab.MAP) showMap()
                tab = item
            }
        }
    ) { insets ->
        Column(Modifier.fillMaxSize().padding(insets).consumeWindowInsets(insets)) {
            if (model.isDemo && (tab != Tab.HOME || stop != null || lineDetails != null)) DemoLabel()
            when {
                planning -> PlannerScreen(stops, model.isDemo, plannerRepository)
                stop != null -> StopScreen(stop, state.departures, model::loadDepartures,
                    favourite = stop.id in favIds, toggleFavourite = { toggleFavourite(stop) }) {
                    showMap(focus = stop.position)
                }
                lineDetails != null -> LineScreen(lineDetails.orEmpty(), stops, plannerRepository, model::selectStop) {
                    showMap(line = lineDetails)
                }
                tab == Tab.HOME -> AlsaceHome(
                    model.isDemo, state.homeInfo, home, work, stops.filter { it.id in favIds },
                    search = { planning = true },
                    place = { isHome ->
                        val saved = if (isHome) home else work
                        if (saved != null) model.selectStop(saved) else findStop(if (isHome) Pick.HOME else Pick.WORK)
                    },
                    addFavourite = { findStop(Pick.FAVOURITE) },
                    openStop = model::selectStop,
                    traffic = { dialog = HomeDialog.TRAFFIC }, bike = { dialog = HomeDialog.BIKE },
                    settings = { dialog = HomeDialog.SETTINGS }, account = { dialog = HomeDialog.ACCOUNT },
                    openLine = { lineDetails = it }
                )
                tab == Tab.SEARCH -> SearchScreen(query, { query = it }, state.stops, model::loadStops) { chosen ->
                    when (pick) {
                        Pick.NONE -> model.selectStop(chosen)
                        Pick.HOME -> {
                            homeId = chosen.id
                            preferences.edit().putString("home", chosen.id).apply()
                        }
                        Pick.WORK -> {
                            workId = chosen.id
                            preferences.edit().putString("work", chosen.id).apply()
                        }
                        Pick.FAVOURITE -> if (chosen.id !in favIds) toggleFavourite(chosen)
                    }
                    if (pick != Pick.NONE) {
                        tab = Tab.HOME
                        pick = Pick.NONE
                    }
                }
                tab == Tab.MAP -> NetworkMap(state.fleet, mapFocus, mapLine)
            }
        }
    }
    dialog?.let { active ->
        AlsaceDialog(active, state.homeInfo, model.isDemo, appearance, changeAppearance,
            close = { dialog = null }, showBike = { showMap(focus = it) },
            changeHome = { dialog = null; findStop(Pick.HOME) },
            changeWork = { dialog = null; findStop(Pick.WORK) })
    }
}

@Composable
private fun AlsaceDialog(
    active: HomeDialog, info: Load<HomeInfo>, demo: Boolean, appearance: String,
    changeAppearance: (String) -> Unit, close: () -> Unit, showBike: (Position) -> Unit,
    changeHome: () -> Unit, changeWork: () -> Unit
) {
    val title = when (active) {
        HomeDialog.TRAFFIC -> "Info trafic"
        HomeDialog.BIKE -> "Vélhop"
        HomeDialog.SETTINGS -> "Réglages"
        HomeDialog.ACCOUNT -> "Compte"
    }
    AlertDialog(
        onDismissRequest = close,
        title = { Text(title, fontFamily = bricolage, fontWeight = FontWeight.ExtraBold) },
        text = {
            Column(Modifier.heightIn(max = 360.dp).verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(8.dp)) {
                when (active) {
                    HomeDialog.TRAFFIC -> {
                        val messages = info.value?.traffic
                        if (demo) Text("Démonstration")
                        if (messages.isNullOrEmpty()) Text(when {
                            info.loading -> "Chargement des messages…"
                            messages != null -> "Aucune perturbation signalée."
                            else -> "Infos CTS indisponibles."
                        })
                        messages.orEmpty().forEach { notice ->
                            Text(notice.title, fontFamily = bricolage, fontWeight = FontWeight.ExtraBold)
                            if (notice.text.isNotBlank()) Text(notice.text)
                        }
                    }
                    HomeDialog.BIKE -> {
                        val station = info.value?.bike
                        if (demo) Text("Démonstration")
                        if (station == null) Text("Disponibilité des vélos indisponible.")
                        else {
                            Text("${station.name} · ${station.bikes} vélos")
                            TextButton(onClick = { showBike(station.position) }) { Text("Voir sur la carte") }
                        }
                    }
                    HomeDialog.SETTINGS -> {
                        listOf("system" to "Système", "light" to "Clair", "dark" to "Sombre").forEach { (key, label) ->
                            Row(Modifier.fillMaxWidth().selectable(appearance == key, role = Role.RadioButton,
                                onClick = { changeAppearance(key) }).padding(vertical = 10.dp),
                                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                                RadioButton(selected = appearance == key, onClick = null)
                                Text(label)
                            }
                        }
                        TextButton(onClick = changeHome) { Text("Changer l’arrêt Maison") }
                        TextButton(onClick = changeWork) { Text("Changer l’arrêt Boulot") }
                    }
                    HomeDialog.ACCOUNT -> Text(if (demo) "Tu utilises la démonstration de Kumm natif. Tes favoris sont enregistrés sur ce téléphone."
                        else "Les raccourcis et favoris sont enregistrés sur ce téléphone.")
                }
            }
        },
        confirmButton = { TextButton(onClick = close) { Text("Fermer") } }
    )
}

@Composable
private fun DemoLabel() {
    Surface(color = MaterialTheme.colorScheme.primaryContainer) {
        Text("Mode démo · horaires et positions simulés", Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
            style = MaterialTheme.typography.labelMedium)
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
            leadingIcon = { AlsaceIcon(R.drawable.alsace_search, null, LocalAlsace.current.muted, 22) },
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
private fun StopScreen(stop: Stop, departures: Load<List<Departure>>, retry: () -> Unit,
    favourite: Boolean, toggleFavourite: () -> Unit, showOnMap: () -> Unit) {
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp), horizontalArrangement = Arrangement.SpaceBetween) {
            TextButton(onClick = showOnMap) { Text("Voir sur la carte") }
            IconButton(onClick = toggleFavourite) {
                AlsaceIcon(R.drawable.alsace_star, if (favourite) "Retirer des favoris" else "Ajouter aux favoris",
                    if (favourite) MaterialTheme.colorScheme.primary else LocalAlsace.current.muted, 24)
            }
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
                    leadingContent = { LineChip(departure.line) },
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
