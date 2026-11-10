package fr.kumm.nativeapp

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URI
import java.net.URLEncoder
import java.text.Normalizer
import java.time.Instant
import java.util.Locale
import kotlin.math.cos
import kotlin.math.hypot

data class Position(val lat: Double, val lon: Double) {
    fun distance(other: Position): Double =
        111_195 * hypot(other.lat - lat, (other.lon - lon) * cos(Math.toRadians((lat + other.lat) / 2)))
}

data class Stop(val id: String, val name: String, val position: Position, val refs: List<String> = emptyList(), val uic: String? = null)
data class Departure(val line: String, val destination: String, val time: Long, val cancelled: Boolean = false)
data class LegPoint(val position: Position, val time: Long)

enum class Mode(val label: String) { TRAM("Tram"), BUS("Bus"), TER("TER") }

data class Vehicle(
    val id: String, val line: String, val destination: String, val mode: Mode,
    val start: LegPoint, val end: LegPoint, val shape: List<Position>
) {
    private val path = if (shape.size > 1) shape else listOf(start.position, end.position)
    private val distances = path.zipWithNext { a, b -> a.distance(b) }.runningFold(0.0, Double::plus)

    fun positionAt(now: Long): Position {
        val duration = (end.time - start.time) / 1000.0
        val distance = distances.last()
        if (duration <= 0 || distance == 0.0) return end.position
        val elapsed = ((now - start.time) / 1000.0).coerceIn(0.0, duration)
        val progress = if (mode == Mode.TER) TrainMotion.distance(distance, duration, elapsed) else distance * elapsed / duration
        val search = distances.binarySearch(progress)
        if (search >= 0) return path[search]
        val next = (-search - 1).coerceIn(1, path.lastIndex)
        val a = path[next - 1]
        val b = path[next]
        val fraction = (progress - distances[next - 1]) / (distances[next] - distances[next - 1])
        return Position(a.lat + (b.lat - a.lat) * fraction, a.lon + (b.lon - a.lon) * fraction)
    }

}

data class Fleet(val vehicles: List<Vehicle>, val serverTime: Long, val receivedAt: Long = android.os.SystemClock.elapsedRealtime())

internal fun fold(value: String): String =
    Normalizer.normalize(value, Normalizer.Form.NFD).replace(Regex("\\p{M}+"), "").lowercase(Locale.ROOT)
        .replace(Regex("[^a-z0-9]+"), " ").trim()

internal fun parseFleet(json: JSONObject): List<Vehicle> = json.optJSONArray("vehicles").objects().mapNotNull { item ->
    val id = item.string("id") ?: return@mapNotNull null
    val line = item.string("line") ?: return@mapNotNull null
    val start = item.optJSONArray("a").legPoint() ?: return@mapNotNull null
    val end = item.optJSONArray("b").legPoint() ?: return@mapNotNull null
    val mode = when (item.string("m")) {
        "ter" -> Mode.TER
        "tram" -> Mode.TRAM
        "bus" -> Mode.BUS
        else -> if (line in listOf("A", "B", "C", "D", "E", "F")) Mode.TRAM else Mode.BUS
    }
    val shape = item.optJSONArray("p")?.let { array ->
        (0 until array.length()).mapNotNull { index -> array.optJSONArray(index).position() }
            .takeIf { it.size == array.length() }
    }.orEmpty()
    Vehicle(id, line, item.string("dest").orEmpty(), mode, start, end, shape)
}

internal fun parseStops(cts: JSONObject, rail: JSONObject): List<Stop> {
    val stops = cts.optJSONObject("StopPointsDelivery")?.optJSONArray("AnnotatedStopPointRef").objects()
        .groupBy { fold(it.string("StopName").orEmpty()) }
        .filterKeys { it.isNotEmpty() }
        .mapNotNull { (_, points) ->
            val first = points.first()
            val id = first.string("StopPointRef") ?: return@mapNotNull null
            val locations = points.mapNotNull {
                val location = it.optJSONObject("Location")
                position(location?.optDouble("Latitude"), location?.optDouble("Longitude"))
            }
            if (locations.isEmpty()) return@mapNotNull null
            val refs = points.mapNotNull { it.string("StopPointRef") }
            Stop(id, first.getString("StopName"), Position(locations.map { it.lat }.average(), locations.map { it.lon }.average()),
                (refs.map { it.replace(Regex("_\\d+$"), "") } + refs).distinct())
        }.toMutableList()
    rail.optJSONArray("items").objects().forEach { item ->
        val uic = item.string("uic") ?: return@forEach
        val name = item.string("name") ?: return@forEach
        val point = position(item.optDouble("lat"), item.optDouble("lon")) ?: return@forEach
        val central = if (uic == "87212027") stops.indexOfFirst { fold(it.name) == "gare centrale" } else -1
        if (central >= 0) stops[central] = stops[central].copy(uic = uic)
        else stops += Stop("SNCF:$uic", name, point, uic = uic)
    }
    return stops.sortedBy { fold(it.name) }
}

internal fun parseCtsDepartures(json: JSONObject): List<Departure> =
    json.optJSONObject("ServiceDelivery")?.optJSONArray("StopMonitoringDelivery").objects().flatMap { delivery ->
        delivery.optJSONArray("MonitoredStopVisit").objects().mapNotNull { visit ->
            val journey = visit.optJSONObject("MonitoredVehicleJourney") ?: return@mapNotNull null
            val call = journey.optJSONObject("MonitoredCall") ?: return@mapNotNull null
            val time = sequenceOf("ExpectedDepartureTime", "AimedDepartureTime", "ExpectedArrivalTime", "AimedArrivalTime")
                .mapNotNull { key -> call.string(key)?.let { runCatching { Instant.parse(it).toEpochMilli() }.getOrNull() } }
                .firstOrNull() ?: return@mapNotNull null
            val cancelled = sequenceOf("DepartureStatus", "ArrivalStatus").any { call.string(it)?.contains("cancel", ignoreCase = true) == true }
            Departure(journey.string("PublishedLineName") ?: journey.string("LineRef") ?: "CTS",
                journey.string("DestinationName").orEmpty(), time, cancelled)
        }
    }

internal fun parseTrainDepartures(json: JSONObject): List<Departure> =
    json.optJSONArray("trains").objects().mapNotNull { train ->
        val time = train.optLong("t", 0).takeIf { it > 0 } ?: return@mapNotNull null
        Departure("TER", train.string("dest").orEmpty(), time, train.optBoolean("cancelled"))
    }

private fun JSONArray?.objects(): List<JSONObject> =
    if (this == null) emptyList() else (0 until length()).mapNotNull(::optJSONObject)

private fun JSONObject.string(key: String): String? =
    if (isNull(key)) null else optString(key).takeIf { it.isNotBlank() }

private fun position(lat: Double?, lon: Double?): Position? =
    if (lat != null && lon != null && lat in -90.0..90.0 && lon in -180.0..180.0) Position(lat, lon) else null

private fun JSONArray?.position(): Position? = this?.let { position(optDouble(0), optDouble(1)) }
private fun JSONArray?.legPoint(): LegPoint? = this?.let { array ->
    val point = array.position() ?: return null
    val time = array.optLong(2, 0).takeIf { it > 0 } ?: return null
    LegPoint(point, time)
}

class TransportRepository {
    val isDemo = !BuildConfig.LIVE_DATA

    suspend fun stops(): List<Stop> = withContext(Dispatchers.IO) {
        if (isDemo) return@withContext demoStops
        val (cts, ter) = feedPair(
            { get("stoppoints-discovery") }, { get("ter-stations") }
        )
        parseStops(cts ?: JSONObject(), ter ?: JSONObject())
    }

    suspend fun departures(stop: Stop): List<Departure> = withContext(Dispatchers.IO) {
        if (isDemo) return@withContext demoDepartures(stop)
        val (cts, ter) = feedPair(
            { if (stop.refs.isEmpty()) null else ctsDepartures(stop.refs) },
            { stop.uic?.let { parseTrainDepartures(get("trains?gare=" + encode(it))) } }
        )
        (cts.orEmpty() + ter.orEmpty()).distinct().sortedBy(Departure::time)
    }

    suspend fun fleet(): Fleet = withContext(Dispatchers.IO) {
        if (isDemo) return@withContext demoFleet()
        val json = get("vehicles")
        Fleet(parseFleet(json), json.optLong("now", System.currentTimeMillis()))
    }

    internal suspend fun homeInfo(): HomeInfo = withContext(Dispatchers.IO) {
        if (isDemo) return@withContext demoHome
        val (traffic, station) = feedPair(
            { get("messages").optJSONArray("items").objects().mapNotNull { message ->
                val title = message.string("title") ?: return@mapNotNull null
                val lines = message.optJSONArray("lines")
                TrafficNotice(title, (0 until (lines?.length() ?: 0)).mapNotNull { lines?.optString(it) },
                    message.string("text").orEmpty())
            } },
            { get("velhop", "poi").optJSONArray("items").objects().mapNotNull { item ->
                val name = item.string("name") ?: return@mapNotNull null
                val point = position(item.optDouble("lat"), item.optDouble("lon")) ?: return@mapNotNull null
                val count = Regex("""(\d+)\s*v[ée]lo""", RegexOption.IGNORE_CASE)
                    .find(item.string("info").orEmpty())?.groupValues?.get(1)?.toIntOrNull() ?: return@mapNotNull null
                BikeStation(name, point, count)
            }.minByOrNull { it.position.distance(Position(48.5846, 7.7507)) } }
        )
        HomeInfo(traffic, station)
    }

    internal suspend fun lineDirections(line: String): List<LineDirection> = withContext(Dispatchers.IO) {
        if (!isDemo) return@withContext parseLineDirections(get("line-route?line=" + encode(line)))
        val sample = when (line) {
            "A" -> demoStops.take(2)
            "C" -> demoStops.drop(1).take(2)
            "TER" -> listOf(demoStops.first(), demoStops.last())
            else -> emptyList()
        }.map { LineStop(it.id, it.name) }
        if (sample.size < 2) emptyList() else listOf(
            LineDirection(sample.last().name, sample), LineDirection(sample.first().name, sample.reversed())
        )
    }

    internal suspend fun addresses(query: String): List<TripPlace> = withContext(Dispatchers.IO) {
        if (isDemo) return@withContext emptyList()
        parseAddresses(get("address?q=" + encode(query.take(100)), "geo"))
    }

    internal suspend fun plans(query: TripQuery): List<TripPlan> = withContext(Dispatchers.IO) {
        if (isDemo) return@withContext demoPlan(query)
        val from = query.from.position
        val to = query.to.position
        val options = buildString {
            if (query.mode == TripMode.TRANSIT) {
                query.time?.let { append("&time=").append(encode(it.toString())) }
                if (query.arriveBy) append("&arrive=1")
                if (query.stepFree) append("&stepfree=1")
            }
        }
        val response = get("${query.mode.path}?from=${from.lat},${from.lon}&to=${to.lat},${to.lon}$options", "geo")
        if (query.mode == TripMode.TRANSIT) parseTransit(response) else parseStreetPlans(response, query.mode)
    }

    private fun ctsDepartures(refs: List<String>): List<Departure> {
        var answered = false
        var error: IOException? = null
        for (ref in refs.take(5)) {
            try {
                val entries = parseCtsDepartures(get("stop-monitoring?MonitoringRef=" + encode(ref)))
                answered = true
                if (entries.isNotEmpty()) return entries
            } catch (e: IOException) {
                error = e
                if (e is TransportException && e.status != 404) break
            }
        }
        if (!answered && error != null) throw error
        return emptyList()
    }

    private fun <A, B> feedPair(first: () -> A?, second: () -> B?): Pair<A?, B?> {
        val a = runCatching(first)
        val b = runCatching(second)
        val firstData = a.getOrNull()
        val secondData = b.getOrNull()
        if (firstData == null && secondData == null) {
            (a.exceptionOrNull() ?: b.exceptionOrNull())?.let { throw it }
        }
        return firstData to secondData
    }

    private fun get(route: String, namespace: String = "api"): JSONObject {
        val base = URI(BuildConfig.API_BASE.trimEnd('/'))
        require(base.scheme == "https" && base.host != null && base.rawUserInfo == null && base.rawQuery == null && base.rawFragment == null)
        val connection = URI("$base/$namespace/$route").toURL().openConnection() as HttpURLConnection
        connection.instanceFollowRedirects = false
        connection.connectTimeout = 6_000
        connection.readTimeout = 8_000
        connection.setRequestProperty("Accept", "application/json")
        if (BuildConfig.API_KEY.isNotBlank()) connection.setRequestProperty("X-App-Key", BuildConfig.API_KEY)
        return try {
            val status = connection.responseCode
            if (status != 200) throw TransportException(status)
            JSONObject(connection.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() })
        } finally {
            connection.disconnect()
        }
    }

    private fun encode(value: String): String = URLEncoder.encode(value, Charsets.UTF_8.name())
}

class TransportException(val status: Int) : IOException("HTTP $status")
