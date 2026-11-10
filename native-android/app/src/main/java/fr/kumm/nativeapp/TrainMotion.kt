package fr.kumm.nativeapp

internal object TrainMotion {
    init { System.loadLibrary("kumm_motion") }

    external fun distance(metres: Double, durationSeconds: Double, elapsedSeconds: Double): Double
}
