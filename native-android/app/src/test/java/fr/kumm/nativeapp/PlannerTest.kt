package fr.kumm.nativeapp

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

class PlannerTest {
    @Test
    fun decodesGeometryAndRejectsIncompletePairs() {
        val encoded = "_p~iF~ps|U_ulLnnqC_mqNvxq`@"
        assertEquals(listOf(Position(38.5, -120.2), Position(40.7, -120.95), Position(43.252, -126.453)),
            decodeRoutePolyline(encoded, 5))
        assertTrue(decodeRoutePolyline(encoded.dropLast(1), 5).isEmpty())
    }

    @Test
    fun keepsTransitRoutesAndOrdersLegsWithFallbackGeometry() {
        val json = JSONObject("""
            {"itineraries":[
              {"startTime":"2026-11-10T19:00:00Z","endTime":"2026-11-10T19:10:00Z","duration":600,
               "legs":[{"mode":"WALK","from":{},"to":{}}]},
              {"startTime":"2026-11-10T19:00:00Z","endTime":"2026-11-10T19:12:00Z","duration":720,
               "legs":[{"mode":"TRAM","routeShortName":"A","startTime":"2026-11-10T19:01:00Z",
                        "from":{"name":"Gare Centrale","lat":48.585,"lon":7.734},
                        "to":{"name":"Homme de Fer","lat":48.584,"lon":7.744}}]}
            ]}
        """)
        val result = parseTransit(json).single()
        assertEquals(720, result.seconds)
        assertEquals("A", result.legs.single().label)
        assertEquals(2, result.paths.single().size)
    }

    @Test
    fun keepsStreetDirectionsAndCoordinatesInMapOrder() {
        val response = JSONObject("""
            {"code":"Ok","routes":[{"duration":125,"geometry":{"coordinates":[[7.73,48.58],[7.74,48.59]]},
             "legs":[{"steps":[{"name":"rue du Jeu-des-Enfants","maneuver":{"type":"turn","modifier":"left"}}]}]}]}
        """)
        val result = parseStreetPlans(response, TripMode.WALK).single()
        assertEquals("Tournez à gauche · rue du Jeu-des-Enfants", result.legs.single().detail)
        assertEquals(Position(48.58, 7.73), result.paths.single().first())
    }

    @Test
    fun usesRequestedArrivalInDemo() {
        val arrival = Instant.parse("2026-11-10T19:00:00Z")
        val result = demoPlan(TripQuery(TripPlace("Gare", Position(48.58, 7.73)),
            TripPlace("Esplanade", Position(48.59, 7.76)), TripMode.TRANSIT, arrival, arriveBy = true)).single()
        assertEquals(arrival, result.end)
        assertTrue(result.start!!.isBefore(arrival))
    }
    @Test
    fun usesTheSameStopOrderAsTheLineFeed() {
        val data = JSONObject("""
            {"main":[{"dest":"Illkirch","names":["Gare Centrale","Homme de Fer"],"codes":["GARE","HDF"]}],
             "other":[{"dest":"Branche incomplète","names":["Gare Centrale"],"codes":["GARE"]}]}
        """)
        val direction = parseLineDirections(data).single()
        assertEquals("Illkirch", direction.destination)
        assertEquals(listOf("GARE", "HDF"), direction.stops.map { it.code })
    }
}
