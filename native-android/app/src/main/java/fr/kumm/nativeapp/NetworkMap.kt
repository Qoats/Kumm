package fr.kumm.nativeapp

import android.os.SystemClock
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.FilterChip
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.delay
import org.maplibre.android.camera.CameraPosition
import org.maplibre.android.camera.CameraUpdateFactory
import org.maplibre.android.geometry.LatLng
import org.maplibre.android.maps.MapLibreMap
import org.maplibre.android.maps.MapView
import org.maplibre.android.maps.Style
import org.maplibre.android.style.layers.CircleLayer
import org.maplibre.android.style.expressions.Expression
import org.maplibre.android.style.layers.PropertyFactory
import org.maplibre.android.style.sources.GeoJsonSource
import org.maplibre.geojson.Feature
import org.maplibre.geojson.FeatureCollection
import org.maplibre.geojson.Point

private const val VEHICLES = "kumm-vehicles"
private const val VEHICLE_LAYER = "kumm-vehicles-layer"
private const val STOP = "kumm-stop"
private val strasbourg = Position(48.5846, 7.7507)

@Composable
internal fun NetworkMap(fleet: Load<Fleet>, focus: Position?, line: String?) {
    var filter by rememberSaveable { mutableStateOf<Mode?>(null) }
    var selected by rememberSaveable { mutableStateOf<String?>(null) }
    var mapFailed by remember { mutableStateOf(false) }
    var map by remember { mutableStateOf<MapLibreMap?>(null) }
    var style by remember { mutableStateOf<Style?>(null) }
    var tick by remember { mutableLongStateOf(SystemClock.elapsedRealtime()) }
    val vehicles = fleet.value?.vehicles.orEmpty().filter { line == null || it.line == line || (line == "TER" && it.mode == Mode.TER) }
    val currentVehicle = vehicles.firstOrNull { it.id == selected && (filter == null || it.mode == filter) }
    val context = LocalContext.current
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val mapView = remember(context) { MapView(context) }

    DisposableEffect(mapView, lifecycle) {
        var active = true
        var started = false
        var resumed = false
        mapView.onCreate(null)
        val failure = MapView.OnDidFailLoadingMapListener { if (active) mapFailed = true }
        mapView.addOnDidFailLoadingMapListener(failure)
        val events = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_START -> { mapView.onStart(); started = true }
                Lifecycle.Event.ON_RESUME -> { mapView.onResume(); resumed = true }
                Lifecycle.Event.ON_PAUSE -> { mapView.onPause(); resumed = false }
                Lifecycle.Event.ON_STOP -> { mapView.onStop(); started = false }
                else -> Unit
            }
        }
        lifecycle.addObserver(events)
        mapView.getMapAsync { instance ->
            if (active) {
                map = instance
                instance.cameraPosition = CameraPosition.Builder().target(strasbourg.latLng()).zoom(12.5).build()
                instance.addOnMapClickListener { position ->
                    val pixel = instance.projection.toScreenLocation(position)
                    selected = instance.queryRenderedFeatures(pixel, VEHICLE_LAYER).firstOrNull()?.getStringProperty("id")
                    selected != null
                }
                instance.setStyle(Style.Builder().fromUri("https://tiles.openfreemap.org/styles/liberty")) { loaded ->
                    if (active) {
                        configureLayers(loaded)
                        style = loaded
                        mapFailed = false
                    }
                }
            }
        }
        onDispose {
            active = false
            lifecycle.removeObserver(events)
            mapView.removeOnDidFailLoadingMapListener(failure)
            if (resumed) mapView.onPause()
            if (started) mapView.onStop()
            mapView.onDestroy()
        }
    }

    LaunchedEffect(map, focus) {
        if (focus != null) map?.moveCamera(CameraUpdateFactory.newLatLngZoom(focus.latLng(), 15.0))
    }
    LaunchedEffect(lifecycle) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            while (true) {
                tick = SystemClock.elapsedRealtime()
                delay(1_000)
            }
        }
    }
    LaunchedEffect(style, fleet.value, filter, line, tick) {
        val sample = fleet.value
        val elapsed = if (sample == null) 0 else (tick - sample.receivedAt).coerceIn(0, 45_000)
        val now = (sample?.serverTime ?: 0) + elapsed
        val features = vehicles.filter { filter == null || it.mode == filter }.map { vehicle ->
            Feature.fromGeometry(vehicle.positionAt(now).point()).apply {
                addStringProperty("id", vehicle.id)
                addStringProperty("mode", vehicle.mode.name)
            }
        }
        style?.getSourceAs<GeoJsonSource>(VEHICLES)?.setGeoJson(FeatureCollection.fromFeatures(features))
    }
    LaunchedEffect(style, focus) {
        val points = listOfNotNull(focus?.let { Feature.fromGeometry(it.point()) })
        style?.getSourceAs<GeoJsonSource>(STOP)?.setGeoJson(FeatureCollection.fromFeatures(points))
    }

    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            FilterChip(selected = filter == null, onClick = { filter = null }, label = { Text("Tout") })
            Mode.entries.forEach { mode ->
                FilterChip(selected = filter == mode, onClick = { filter = mode }, label = { Text(mode.label) })
            }
        }
        if (fleet.loading && fleet.value == null) LinearProgressIndicator(Modifier.fillMaxWidth())
        val notice = when {
            mapFailed -> "Fond de carte indisponible."
            fleet.error != null -> if (fleet.value == null) fleet.error else "Dernières positions connues."
            currentVehicle != null -> "${currentVehicle.line} · ${currentVehicle.destination} · position estimée"
            fleet.value != null && vehicles.none { filter == null || it.mode == filter } -> "Aucun véhicule dans ce filtre."
            else -> "Positions estimées · touche un véhicule pour l’identifier"
        }
        Text(notice.orEmpty(), Modifier.padding(horizontal = 12.dp, vertical = 6.dp), style = MaterialTheme.typography.bodySmall)
        AndroidView(factory = { mapView }, modifier = Modifier.weight(1f).fillMaxWidth())
    }
}

private fun configureLayers(style: Style) {
    style.addSource(GeoJsonSource(VEHICLES))
    style.addSource(GeoJsonSource(STOP))
    val colors = Expression.match(Expression.get("mode"), Expression.literal("#167159"),
        Expression.stop("TRAM", "#B23A2B"), Expression.stop("BUS", "#176CAC"), Expression.stop("TER", "#6F46B8"))
    style.addLayer(CircleLayer(VEHICLE_LAYER, VEHICLES).withProperties(
        PropertyFactory.circleRadius(8f), PropertyFactory.circleColor(colors),
        PropertyFactory.circleStrokeColor("#FFFFFF"), PropertyFactory.circleStrokeWidth(2f)
    ))
    style.addLayer(CircleLayer("kumm-stop-layer", STOP).withProperties(
        PropertyFactory.circleRadius(10f), PropertyFactory.circleColor("#211711"),
        PropertyFactory.circleStrokeColor("#FFFFFF"), PropertyFactory.circleStrokeWidth(3f)
    ))
}

private fun Position.latLng() = LatLng(lat, lon)
private fun Position.point(): Point = Point.fromLngLat(lon, lat)
