package fr.kumm.nativeapp

import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import kotlin.math.pow

internal data class TripPlace(val name: String, val position: Position)
internal data class TripQuery(val from: TripPlace, val to: TripPlace, val mode: TripMode,
    val time: Instant? = null, val arriveBy: Boolean = false, val stepFree: Boolean = false)
internal enum class TripMode(val label: String, val path: String) {
    TRANSIT("Transports", "transit"), WALK("À pied", "walk"), BIKE("À vélo", "bike")
}
internal data class TripLeg(val label: String, val detail: String, val path: List<Position>, val start: Instant? = null)
internal data class TripPlan(val seconds: Int, val legs: List<TripLeg>, val start: Instant? = null, val end: Instant? = null) {
    val paths: List<List<Position>> get() = legs.map { it.path }.filter { it.size >= 2 }
}

internal fun parseAddresses(json: JSONObject): List<TripPlace> {
    val places = json.optJSONArray("features").objects().mapNotNull { feature ->
        val properties = feature.optJSONObject("properties") ?: return@mapNotNull null
        val name = properties.optString("label").takeIf(String::isNotBlank) ?: return@mapNotNull null
        val point = feature.optJSONObject("geometry")?.optJSONArray("coordinates").lngLat() ?: return@mapNotNull null
        TripPlace(name, point) to properties.optString("context").startsWith("67")
    }
    return places.filter { it.second }.ifEmpty { places }.take(5).map { it.first }
}

internal fun parseTransit(json: JSONObject): List<TripPlan> = json.optJSONArray("itineraries").objects().mapNotNull { itinerary ->
    val start = itinerary.instant("startTime") ?: return@mapNotNull null
    val end = itinerary.instant("endTime") ?: return@mapNotNull null
    val duration = itinerary.optInt("duration").takeIf { it > 0 } ?: return@mapNotNull null
    val source = itinerary.optJSONArray("legs").objects()
    val legs = source.mapNotNull { leg ->
        val mode = leg.optString("mode")
        val from = leg.optJSONObject("from") ?: return@mapNotNull null
        val to = leg.optJSONObject("to") ?: return@mapNotNull null
        val destination = to.optString("name").takeUnless { it in listOf("START", "END", "") }.orEmpty()
        val origin = from.optString("name").takeUnless { it in listOf("START", "END", "") }.orEmpty()
        val label = when (mode) {
            "WALK" -> "À pied"
            "BIKE" -> "À vélo"
            else -> leg.optString("routeShortName").ifBlank { leg.optString("displayName").ifBlank { mode } }
        }
        val geometry = leg.optJSONObject("legGeometry")
        val path = geometry?.let { decodeRoutePolyline(it.optString("points"), it.optInt("precision", 6)) }
            .orEmpty().takeIf { it.size >= 2 }
            ?: (listOf(from) + leg.optJSONArray("intermediateStops").objects() + to).mapNotNull {
                routePoint(it.optDouble("lat"), it.optDouble("lon"))
            }
        TripLeg(label, listOf(origin, destination).filter(String::isNotBlank).joinToString(" → "), path, leg.instant("startTime"))
    }
    if (legs.size != source.size || source.none { it.optString("mode") !in listOf("", "WALK", "BIKE", "CAR", "FLEX", "ODM") }) return@mapNotNull null
    TripPlan(duration, legs, start, end)
}.sortedBy { it.start }

internal fun parseStreetPlans(json: JSONObject, mode: TripMode): List<TripPlan> {
    if (json.optString("code") != "Ok") return emptyList()
    return json.optJSONArray("routes").objects().mapNotNull { route ->
        val duration = route.optDouble("duration").takeIf { it.isFinite() && it > 0 } ?: return@mapNotNull null
        val geometry = route.optJSONObject("geometry")?.optJSONArray("coordinates") ?: return@mapNotNull null
        val path = (0 until geometry.length()).map { geometry.optJSONArray(it).lngLat() ?: return@mapNotNull null }
        if (path.size < 2) return@mapNotNull null
        val steps = route.optJSONArray("legs").objects().flatMap { it.optJSONArray("steps").objects() }.map { step ->
            val maneuver = step.optJSONObject("maneuver")
            val instruction = when (maneuver?.optString("type")) {
                "depart" -> "Partez"
                "arrive" -> "Vous êtes arrivé"
                "roundabout", "rotary" -> maneuver.optInt("exit").takeIf { it > 0 }?.let { "Prenez la sortie $it du rond-point" } ?: "Prenez le rond-point"
                else -> when (maneuver?.optString("modifier")) {
                    "left", "slight left", "sharp left" -> "Tournez à gauche"
                    "right", "slight right", "sharp right" -> "Tournez à droite"
                    "uturn" -> "Faites demi-tour"
                    else -> "Continuez"
                }
            }
            listOf(instruction, step.optString("name")).filter(String::isNotBlank).joinToString(" · ")
        }
        TripPlan(duration.toInt(), listOf(TripLeg(mode.label, steps.joinToString("\n"), path)))
    }
}

internal fun decodeRoutePolyline(encoded: String, precision: Int): List<Position> {
    if (precision !in 0..7) return emptyList()
    val scale = 10.0.pow(precision)
    var index = 0
    fun delta(): Long? {
        var result = 0L
        for (shift in 0..30 step 5) {
            val value = encoded.getOrNull(index++)?.code?.minus(63) ?: return null
            if (value !in 0..63) return null
            result = result or ((value and 31).toLong() shl shift)
            if (value < 32) return if ((result and 1L) != 0L) (result shr 1).inv() else result shr 1
        }
        return null
    }
    var lat = 0L
    var lon = 0L
    val points = mutableListOf<Position>()
    while (index < encoded.length) {
        lat += delta() ?: return emptyList()
        lon += delta() ?: return emptyList()
        points += routePoint(lat / scale, lon / scale) ?: return emptyList()
    }
    return points
}

private fun JSONArray?.lngLat(): Position? =
    this?.let { routePoint(optDouble(1), optDouble(0)) }

private fun JSONArray?.objects(): List<JSONObject> =
    if (this == null) emptyList() else (0 until length()).mapNotNull(::optJSONObject)

private fun routePoint(lat: Double, lon: Double): Position? =
    if (lat in -90.0..90.0 && lon in -180.0..180.0) Position(lat, lon) else null

private fun JSONObject.instant(key: String): Instant? =
    runCatching { Instant.parse(optString(key)) }.getOrNull()

internal fun demoPlan(query: TripQuery): List<TripPlan> {
    val distance = query.from.position.distance(query.to.position)
    val duration = when (query.mode) {
        TripMode.TRANSIT -> (distance / 7.0 + 300).toInt()
        TripMode.WALK -> (distance / 1.3).toInt()
        TripMode.BIKE -> (distance / 4.0).toInt()
    }.coerceAtLeast(60)
    val requested = query.time ?: Instant.now()
    val start = if (query.arriveBy) requested.minusSeconds(duration.toLong()) else requested
    val path = listOf(query.from.position, query.to.position)
    return listOf(TripPlan(duration, listOf(TripLeg(query.mode.label,
        "${query.from.name} → ${query.to.name}\nTrajet fictif pour essayer l’écran.", path, start)),
        start, start.plusSeconds(duration.toLong())))
}
