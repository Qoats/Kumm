use std::ffi::c_void;

const ACCELERATION: f64 = 0.45;
const MAX_SPEED: f64 = 160.0 / 3.6;

/// Distance along the supplied route, in metres. The schedule takes precedence
/// when it cannot fit a plausible acceleration profile.
fn train_distance(distance: f64, duration: f64, elapsed: f64) -> f64 {
    if !distance.is_finite() || !duration.is_finite() || !elapsed.is_finite() {
        return 0.0;
    }
    if distance <= 0.0 || duration <= 0.0 || elapsed <= 0.0 {
        return 0.0;
    }
    if elapsed >= duration {
        return distance;
    }

    let discriminant = duration * duration - 4.0 * distance / ACCELERATION;
    if discriminant < 0.0 {
        return distance * (elapsed / duration);
    }
    let ramp = (2.0 * distance / ACCELERATION) / (duration + discriminant.sqrt());
    let speed = distance / (duration - ramp);
    if speed > MAX_SPEED {
        return distance * (elapsed / duration);
    }

    let travelled = if elapsed < ramp {
        0.5 * ACCELERATION * elapsed * elapsed
    } else if elapsed > duration - ramp {
        let remaining = duration - elapsed;
        distance - 0.5 * ACCELERATION * remaining * remaining
    } else {
        speed * (elapsed - ramp / 2.0)
    };
    travelled.clamp(0.0, distance)
}

// Primitive JNI signature. The two opaque JNI arguments are unused.
#[unsafe(no_mangle)]
pub extern "system" fn Java_fr_kumm_nativeapp_TrainMotion_distance(
    _env: *mut c_void,
    _receiver: *mut c_void,
    distance: f64,
    duration: f64,
    elapsed: f64,
) -> f64 {
    train_distance(distance, duration, elapsed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn starts_slowly_and_brakes_to_the_destination() {
        let (distance, duration) = (10_000.0, 360.0);
        assert_eq!(train_distance(distance, duration, -1.0), 0.0);
        assert_eq!(train_distance(distance, duration, 10.0), 22.5);
        assert!((train_distance(distance, duration, 180.0) - 5_000.0).abs() < 1e-8);
        assert_eq!(train_distance(distance, duration, 350.0), 9_977.5);
        assert_eq!(train_distance(distance, duration, 361.0), distance);
    }

    #[test]
    fn advances_without_reversing() {
        let values: Vec<_> = (0..=360)
            .map(|time| train_distance(10_000.0, 360.0, f64::from(time)))
            .collect();
        assert!(values.windows(2).all(|pair| pair[0] <= pair[1]));
    }

    #[test]
    fn impossible_schedule_falls_back_to_bounded_progress() {
        assert_eq!(train_distance(10_000.0, 30.0, 15.0), 5_000.0);
        assert_eq!(train_distance(10_000.0, 0.0, 1.0), 0.0);
    }
}
