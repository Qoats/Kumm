package fr.kumm.nativeapp

private const val MINUTE = 60_000L
private val central = Position(48.58511, 7.73388)
private val hommeDeFer = Position(48.58497, 7.74445)
private val esplanade = Position(48.57900, 7.76749)
private val vendenheim = Position(48.66592, 7.71778)

internal val demoStops = listOf(
    Stop("demo-gare", "Gare Centrale", central, uic = "87212027"),
    Stop("demo-homme", "Homme de Fer", hommeDeFer),
    Stop("demo-esplanade", "Esplanade", esplanade),
    Stop("demo-vendenheim", "Vendenheim", vendenheim, uic = "87212118")
)

internal fun demoDepartures(stop: Stop): List<Departure> {
    val now = System.currentTimeMillis()
    return if (stop.uic == "87212118") {
        listOf(Departure("TER", "Strasbourg", now + 9 * MINUTE))
    } else {
        listOf(
            Departure("A", "Illkirch Lixenbuhl", now + 3 * MINUTE),
            Departure("D", "Kehl Rathaus", now + 7 * MINUTE),
            if (stop.uic != null) Departure("TER", "Saverne", now + 12 * MINUTE)
            else Departure("C", "Neuhof Rodolphe Reuss", now + 12 * MINUTE)
        )
    }
}

internal fun demoFleet(): Fleet {
    val now = System.currentTimeMillis()
    val start = now - now % (4 * MINUTE)
    val trainPath = listOf(central, Position(48.5895, 7.7361), Position(48.6011, 7.7273),
        Position(48.6131, 7.7128), Position(48.6343, 7.7209), vendenheim)
    val tramPath = listOf(hommeDeFer, Position(48.58456, 7.749), Position(48.5862, 7.7573),
        Position(48.5834, 7.7668), esplanade)
    return Fleet(listOf(
        Vehicle("demo-train", "TER", "Vendenheim", Mode.TER,
            LegPoint(central, start), LegPoint(vendenheim, start + 4 * MINUTE), trainPath),
        Vehicle("demo-tram", "C", "Neuhof Rodolphe Reuss", Mode.TRAM,
            LegPoint(hommeDeFer, start), LegPoint(esplanade, start + 4 * MINUTE), tramPath)
    ), now)
}
