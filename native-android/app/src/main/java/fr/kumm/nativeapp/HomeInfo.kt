package fr.kumm.nativeapp

internal data class TrafficNotice(val title: String, val lines: List<String>, val text: String)
internal data class BikeStation(val name: String, val position: Position, val bikes: Int)
internal data class HomeInfo(val traffic: List<TrafficNotice>?, val bike: BikeStation?)

internal val demoHome = HomeInfo(
    listOf(TrafficNotice("Lignes C4 et N3 – arrêt Contades déplacé", listOf("N3", "C4"),
        "Exemple de perturbation pour la version de démonstration.")),
    BikeStation("Broglie · 110 m", Position(48.5856, 7.7493), 15)
)
