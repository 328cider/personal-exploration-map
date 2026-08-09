"""Explainable live B0/B1 baselines over Android-shaped sensor evidence.

The estimators intentionally accept only ``NormalizedSensorSession``. Synthetic or
public-dataset truth is available only to the separate evaluation layer.
"""

from __future__ import annotations

from bisect import bisect_right
import math

from .contracts import (
    EstimatePoint,
    EstimatorOutput,
    EstimatorRequirement,
    EstimatorRun,
    NormalizedSensorSession,
    SensorSample,
)
from .profiles import PROFILES


ACCELEROMETER = "TYPE_ACCELEROMETER"
GYROSCOPE = "TYPE_GYROSCOPE"
MAGNETOMETER = "TYPE_MAGNETIC_FIELD"
ROTATION_VECTOR = "TYPE_ROTATION_VECTOR"
GAME_ROTATION_VECTOR = "TYPE_GAME_ROTATION_VECTOR"
STEP_DETECTOR = "TYPE_STEP_DETECTOR"

ORIENTATION_SENSORS = frozenset({ROTATION_VECTOR, GAME_ROTATION_VECTOR})

B0_REQUIREMENT = EstimatorRequirement(
    estimator="B0 step + platform orientation + fixed stride",
    version="1.0.0",
    required_capability_profile="step-enabled",
    required_sensor_types=frozenset({STEP_DETECTOR}),
    any_of_sensor_types=(ORIENTATION_SENSORS,),
    optional_sensor_types=frozenset(),
)


def _wrap_angle(angle: float) -> float:
    return (angle + math.pi) % (2.0 * math.pi) - math.pi


def _samples(session: NormalizedSensorSession, sensor_type: str) -> tuple[SensorSample, ...]:
    return tuple(
        sorted(
            (sample for sample in session.samples if sample.sensor_type == sensor_type),
            key=lambda sample: sample.sensor_timestamp_ns,
        )
    )


def _available_sensor_types(session: NormalizedSensorSession) -> frozenset[str]:
    return frozenset(sample.sensor_type for sample in session.samples)


def _missing_requirements(
    requirement: EstimatorRequirement, available: frozenset[str]
) -> tuple[str, ...]:
    missing = [
        sensor_type
        for sensor_type in sorted(requirement.required_sensor_types)
        if sensor_type not in available
    ]
    for group in requirement.any_of_sensor_types:
        if not group & available:
            missing.append("one-of:" + "|".join(sorted(group)))
    return tuple(missing)


def _unsupported(
    requirement: EstimatorRequirement, missing: tuple[str, ...]
) -> EstimatorRun:
    return EstimatorRun(
        requirement=requirement,
        supported=False,
        output=None,
        used_sensor_types=frozenset(),
        missing_requirements=missing,
    )


def _yaw_from_rotation_vector(values: tuple[float, ...]) -> float:
    if len(values) < 3:
        raise ValueError("Rotation vector requires at least x/y/z")
    x, y, z = values[:3]
    if len(values) >= 4:
        w = values[3]
    else:
        w = math.sqrt(max(0.0, 1.0 - x * x - y * y - z * z))
    return _wrap_angle(math.atan2(2.0 * (w * z + x * y), 1.0 - 2.0 * (y * y + z * z)))


def _orientation_heading_timeline(
    session: NormalizedSensorSession, *, game_first: bool
) -> tuple[tuple[tuple[int, float], ...], str] | None:
    priority = (
        (GAME_ROTATION_VECTOR, ROTATION_VECTOR)
        if game_first
        else (ROTATION_VECTOR, GAME_ROTATION_VECTOR)
    )
    for sensor_type in priority:
        sensor_samples = _samples(session, sensor_type)
        if sensor_samples:
            return (
                tuple(
                    (sample.sensor_timestamp_ns, _yaw_from_rotation_vector(sample.values))
                    for sample in sensor_samples
                ),
                sensor_type,
            )
    return None


def _gyro_heading_timeline(
    session: NormalizedSensorSession,
) -> tuple[tuple[tuple[int, float], ...], str]:
    sensor_samples = _samples(session, GYROSCOPE)
    if not sensor_samples:
        return (), GYROSCOPE
    heading = 0.0
    previous_timestamp = sensor_samples[0].sensor_timestamp_ns
    timeline: list[tuple[int, float]] = [(previous_timestamp, heading)]
    for sample in sensor_samples[1:]:
        delta_s = (sample.sensor_timestamp_ns - previous_timestamp) / 1_000_000_000
        heading = _wrap_angle(heading + sample.values[2] * delta_s)
        timeline.append((sample.sensor_timestamp_ns, heading))
        previous_timestamp = sample.sensor_timestamp_ns
    return tuple(timeline), GYROSCOPE


def _latest_heading(timeline: tuple[tuple[int, float], ...], timestamp_ns: int) -> float:
    timestamps = [item[0] for item in timeline]
    index = bisect_right(timestamps, timestamp_ns) - 1
    return timeline[max(0, index)][1]


def _acceleration_step_candidates(
    session: NormalizedSensorSession,
) -> tuple[tuple[int, float], ...]:
    sensor_samples = _samples(session, ACCELEROMETER)
    if len(sensor_samples) < 3:
        return ()
    magnitudes = [
        math.sqrt(sum(value * value for value in sample.values[:3]))
        for sample in sensor_samples
    ]
    result: list[tuple[int, float]] = []
    valley = magnitudes[0]
    last_step_timestamp = -10**18
    minimum_interval_ns = 320_000_000
    for index in range(1, len(sensor_samples) - 1):
        magnitude = magnitudes[index]
        valley = min(valley, magnitude)
        is_peak = magnitude >= magnitudes[index - 1] and magnitude > magnitudes[index + 1]
        timestamp = sensor_samples[index].sensor_timestamp_ns
        if (
            is_peak
            and magnitude - 9.80665 >= 0.25
            and timestamp - last_step_timestamp >= minimum_interval_ns
        ):
            detection_timestamp = sensor_samples[index + 1].sensor_timestamp_ns
            result.append((detection_timestamp, max(0.01, magnitude - valley)))
            last_step_timestamp = detection_timestamp
            valley = magnitude
    return tuple(result)


def _step_detector_events(session: NormalizedSensorSession) -> tuple[tuple[int, None], ...]:
    return tuple(
        (sample.sensor_timestamp_ns, None)
        for sample in _samples(session, STEP_DETECTOR)
        if sample.values and sample.values[0] > 0.0
    )


def _nearest_amplitude(
    timestamp_ns: int, candidates: tuple[tuple[int, float], ...]
) -> float | None:
    causal_candidates = tuple(item for item in candidates if item[0] <= timestamp_ns)
    if not causal_candidates:
        return None
    nearest_timestamp, amplitude = max(causal_candidates, key=lambda item: item[0])
    return amplitude if abs(nearest_timestamp - timestamp_ns) <= 250_000_000 else None


def _adaptive_stride(amplitude: float | None, *, fallback_stride_m: float) -> float:
    if amplitude is None:
        return fallback_stride_m
    return min(0.90, max(0.45, 0.64 * amplitude ** 0.25))


def magnetic_field_is_usable(session: NormalizedSensorSession) -> bool | None:
    sensor_samples = _samples(session, MAGNETOMETER)
    if not sensor_samples:
        return None
    return all(
        sample.accuracy > 0
        and 20.0 <= math.sqrt(sum(value * value for value in sample.values[:3])) <= 70.0
        for sample in sensor_samples
    )


def _build_output(
    *,
    session: NormalizedSensorSession,
    requirement: EstimatorRequirement,
    steps: tuple[tuple[int, float | None], ...],
    heading_timeline: tuple[tuple[int, float], ...],
    fallback_stride_m: float,
    adaptive: bool,
    terminal_sensor_types: frozenset[str],
) -> EstimatorOutput:
    if not steps or not heading_timeline:
        raise ValueError("Supported estimator requires step and heading samples")
    source_samples = tuple(
        sample for sample in session.samples if sample.sensor_type in terminal_sensor_types
    )
    start_timestamp = min(sample.sensor_timestamp_ns for sample in source_samples)
    terminal_timestamp = max(sample.sensor_timestamp_ns for sample in source_samples)
    x_m = 0.0
    y_m = 0.0
    uncertainty_m = 0.25
    previous_step_timestamp = start_timestamp
    points: list[EstimatePoint] = [
        EstimatePoint(
            timestamp_ns=start_timestamp,
            x_m=0.0,
            y_m=0.0,
            heading_rad=_latest_heading(heading_timeline, start_timestamp),
            uncertainty_m=uncertainty_m,
            source_start_ns=start_timestamp,
            source_end_ns=start_timestamp,
        )
    ]
    for timestamp_ns, amplitude in steps:
        if timestamp_ns < start_timestamp or timestamp_ns > terminal_timestamp:
            continue
        heading = _latest_heading(heading_timeline, timestamp_ns)
        stride_m = (
            _adaptive_stride(amplitude, fallback_stride_m=fallback_stride_m)
            if adaptive
            else fallback_stride_m
        )
        x_m += stride_m * math.cos(heading)
        y_m += stride_m * math.sin(heading)
        step_gap_s = max(0.0, (timestamp_ns - previous_step_timestamp) / 1_000_000_000)
        uncertainty_m += 0.02 + max(0.0, step_gap_s - 0.8) * 0.25
        points.append(
            EstimatePoint(
                timestamp_ns=timestamp_ns,
                x_m=x_m,
                y_m=y_m,
                heading_rad=heading,
                uncertainty_m=uncertainty_m,
                source_start_ns=previous_step_timestamp,
                source_end_ns=timestamp_ns,
            )
        )
        previous_step_timestamp = timestamp_ns
    if points[-1].timestamp_ns < terminal_timestamp:
        tail_gap_s = (terminal_timestamp - points[-1].timestamp_ns) / 1_000_000_000
        uncertainty_m += max(0.0, tail_gap_s - 0.8) * 0.25
        points.append(
            EstimatePoint(
                timestamp_ns=terminal_timestamp,
                x_m=x_m,
                y_m=y_m,
                heading_rad=_latest_heading(heading_timeline, terminal_timestamp),
                uncertainty_m=uncertainty_m,
                source_start_ns=points[-1].timestamp_ns,
                source_end_ns=terminal_timestamp,
            )
        )
    return EstimatorOutput(
        estimator=requirement.estimator,
        version=requirement.version,
        required_capability_profile=requirement.required_capability_profile,
        frame="local-origin-relative-meters",
        mode=requirement.mode,
        points=tuple(points),
    )


def run_b0(session: NormalizedSensorSession, *, fixed_stride_m: float = 0.72) -> EstimatorRun:
    available = _available_sensor_types(session)
    missing = _missing_requirements(B0_REQUIREMENT, available)
    if missing:
        return _unsupported(B0_REQUIREMENT, missing)
    heading_result = _orientation_heading_timeline(session, game_first=False)
    assert heading_result is not None
    heading_timeline, heading_sensor = heading_result
    steps = _step_detector_events(session)
    if not steps:
        return _unsupported(B0_REQUIREMENT, ("TYPE_STEP_DETECTOR:no-events",))
    output = _build_output(
        session=session,
        requirement=B0_REQUIREMENT,
        steps=steps,
        heading_timeline=heading_timeline,
        fallback_stride_m=fixed_stride_m,
        adaptive=False,
        terminal_sensor_types=frozenset({STEP_DETECTOR, heading_sensor}),
    )
    return EstimatorRun(
        requirement=B0_REQUIREMENT,
        supported=True,
        output=output,
        used_sensor_types=frozenset({STEP_DETECTOR, heading_sensor}),
        fallback_flags=("fixed-stride",),
    )


def _b1_requirement(capability_profile: str) -> EstimatorRequirement:
    if capability_profile not in PROFILES:
        raise ValueError(f"Unknown capability profile: {capability_profile}")
    return EstimatorRequirement(
        estimator=f"B1 classical PDR/{capability_profile}",
        version="1.0.0",
        required_capability_profile=capability_profile,
        required_sensor_types=frozenset({ACCELEROMETER, GYROSCOPE}),
        optional_sensor_types=frozenset(
            {STEP_DETECTOR, ROTATION_VECTOR, GAME_ROTATION_VECTOR, MAGNETOMETER}
        ),
    )


def run_b1(
    session: NormalizedSensorSession,
    *,
    capability_profile: str = "imu6",
    fallback_stride_m: float = 0.66,
) -> EstimatorRun:
    requirement = _b1_requirement(capability_profile)
    available = _available_sensor_types(session)
    missing = _missing_requirements(requirement, available)
    if missing:
        return _unsupported(requirement, missing)

    acceleration_candidates = _acceleration_step_candidates(session)
    use_android_steps = capability_profile in {
        "step-enabled",
        "enriched-with-pressure/GNSS",
    } and STEP_DETECTOR in available
    fallback_flags: set[str] = set()
    used_sensor_types: set[str] = {ACCELEROMETER}
    if use_android_steps:
        android_steps = _step_detector_events(session)
        steps = tuple(
            (timestamp, _nearest_amplitude(timestamp, acceleration_candidates))
            for timestamp, _ in android_steps
        )
        used_sensor_types.add(STEP_DETECTOR)
        fallback_flags.add("android-step-detector")
    else:
        steps = tuple((timestamp, amplitude) for timestamp, amplitude in acceleration_candidates)
        fallback_flags.add(
            "custom-step-detector-fallback"
            if capability_profile in {"step-enabled", "enriched-with-pressure/GNSS"}
            else "custom-step-detector"
        )
    if not steps:
        return _unsupported(requirement, ("walking-events:not-detected",))

    prefer_platform_heading = capability_profile != "imu6"
    heading_result = (
        _orientation_heading_timeline(session, game_first=True)
        if prefer_platform_heading
        else None
    )
    if heading_result is None:
        heading_timeline, heading_sensor = _gyro_heading_timeline(session)
        fallback_flags.add(
            "gyro-heading-fallback" if prefer_platform_heading else "gyro-heading"
        )
    else:
        heading_timeline, heading_sensor = heading_result
        fallback_flags.add("platform-orientation-heading")
    used_sensor_types.add(heading_sensor)

    magnetic_usable = magnetic_field_is_usable(session)
    if magnetic_usable is False:
        fallback_flags.add("magnetic-field-rejected")
    elif magnetic_usable is True:
        fallback_flags.add("magnetic-field-quality-ok-not-used")

    output = _build_output(
        session=session,
        requirement=requirement,
        steps=steps,
        heading_timeline=heading_timeline,
        fallback_stride_m=fallback_stride_m,
        adaptive=True,
        terminal_sensor_types=frozenset(used_sensor_types),
    )
    return EstimatorRun(
        requirement=requirement,
        supported=True,
        output=output,
        used_sensor_types=frozenset(used_sensor_types),
        fallback_flags=tuple(sorted(fallback_flags)),
    )


def run_common_baselines(session: NormalizedSensorSession) -> tuple[EstimatorRun, ...]:
    return (
        run_b0(session),
        run_b1(session, capability_profile="imu6"),
        run_b1(session, capability_profile="platform-fused"),
        run_b1(session, capability_profile="step-enabled"),
    )
