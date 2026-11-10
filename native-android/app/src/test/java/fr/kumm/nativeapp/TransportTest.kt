package fr.kumm.nativeapp

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

class TransportTest {
    @Test
    fun mergesCtsQuaysAndStrasbourgTerStation() {
        val cts = JSONObject("""
            {"StopPointsDelivery":{"AnnotatedStopPointRef":[
              {"StopPointRef":"GARE_01","StopName":"Gare centrale","Location":{"Latitude":48.58,"Longitude":7.73}},
              {"StopPointRef":"GARE_02","StopName":"Gare Centrale","Location":{"Latitude":48.59,"Longitude":7.73}}
            ]}}
        """)
        val rail = JSONObject("""
            {"items":[{"uic":"87212027","name":"Strasbourg-Ville","lat":48.585,"lon":7.734}]}
        """)
        val stop = parseStops(cts, rail).single()
        assertEquals("87212027", stop.uic)
        assertEquals(listOf("GARE", "GARE_01", "GARE_02"), stop.refs)
        assertEquals(48.585, stop.position.lat, 1e-9)
        assertEquals("esplanade", fold("ÉSPLANÀDE"))
    }

    @Test
    fun usesExpectedDepartureAndKeepsCancellation() {
        val cts = JSONObject("""
            {"ServiceDelivery":{"StopMonitoringDelivery":[{"MonitoredStopVisit":[{"MonitoredVehicleJourney":{
              "LineRef":"A","DestinationName":"Illkirch","MonitoredCall":{
                "ExpectedDepartureTime":"2026-11-10T19:04:00+01:00",
                "AimedDepartureTime":"2026-11-10T18:01:00Z","DepartureStatus":"cancelled"
              }}}]}]}}
        """)
        val departure = parseCtsDepartures(cts).single()
        assertEquals("A", departure.line)
        assertEquals(Instant.parse("2026-11-10T18:04:00Z").toEpochMilli(), departure.time)
        assertTrue(departure.cancelled)
    }

    @Test
    fun busFollowsThePolylineAndRejectsMalformedVehicles() {
        val fleet = JSONObject("""
            {"vehicles":[
              {"id":"bus-1","line":"15","m":"bus","a":[48.0,7.0,1000],"b":[48.01,7.01,11000],
               "p":[[48.0,7.0],[48.01,7.0],[48.01,7.01]]},
              {"id":"invalid","line":"15","a":[-100,7,1000],"b":[48,7,11000]}
            ]}
        """)
        val bus = parseFleet(fleet).single()
        assertEquals(Position(48.0, 7.0), bus.positionAt(0))
        assertEquals(7.0, bus.positionAt(5000).lon, 1e-9)
        assertEquals(Position(48.01, 7.01), bus.positionAt(12000))
    }
}
