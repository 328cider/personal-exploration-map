"""Causal Android-compatible body-heading research candidates.

The estimator consumes only raw accelerometer samples, an optional Android Game
Rotation Vector stream, and monotonic sensor timestamps.  It never sees body
heading labels, trajectory truth, synchronized future samples, or route shape.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass
import math

from .contracts import NormalizedSensorSession, SensorSample


ACCELEROMETER = "TYPE_ACCELEROMETER"
GAME_ROTATION_VECTOR = "TYPE_GAME_ROTATION_VECTOR"


@dataclass(frozen=True)
class BodyHeadingConfig:
    config_id: str
    window_s: float
    weighting: str
    smoothing_tau_s: float
    minimum_anisotropy: float
    output_rate_hz: int = 10
    reset_gap_s: float = 0.50
    minimum_principal_variance_mps4: float = 0.02
    minimum_window_fraction: float = 0.80


@dataclass(frozen=True)
class HorizontalAccelerationSample:
    timestamp_ns: int
    x_mps2: float
    y_mps2: float
    z_mps2: float
    orientation_timestamp_ns: int


@dataclass(frozen=True)
class PreparedHeadingSignal:
    session_id: str
    samples: tuple[HorizontalAccelerationSample, ...]
    missing_requirements: tuple[str, ...] = ()


@dataclass(frozen=True)
class BodyHeadingPoint:
    timestamp_ns: int
    heading_rad: float
    anisotropy: float
    fresh: bool
    source_start_ns: int
    source_end_ns: int


@dataclass(frozen=True)
class BodyHeadingRun:
    estimator: str
    version: str
    required_capability_profile: str
    supported: bool
    used_sensor_types: frozenset[str]
    points: tuple[BodyHeadingPoint, ...]
    missing_requirements: tuple[str, ...] = ()


def _config_id(
    *, window_s: float, weighting: str, smoothing_tau_s: float, anisotropy: float
) -> str:
    weight_code = {"uniform": "u", "horizontal-energy": "e"}[weighting]
    return (
        f"bhpca-w{round(window_s * 1000):04d}-{weight_code}"
        f"-s{round(smoothing_tau_s * 1000):03d}-a{round(anisotropy * 10):02d}"
    )


def _candidate_configs() -> tuple[BodyHeadingConfig, ...]:
    result = []
    for window_s in (1.0, 1.5, 2.0, 3.0, 5.0):
        for weighting in ("uniform", "horizontal-energy"):
            for smoothing_tau_s in (0.0, 0.25, 0.5):
                for anisotropy in (1.0, 1.5, 2.0):
                    result.append(
                        BodyHeadingConfig(
                            config_id=_config_id(
                                window_s=window_s,
                                weighting=weighting,
                                smoothing_tau_s=smoothing_tau_s,
                                anisotropy=anisotropy,
                            ),
                            window_s=window_s,
                            weighting=weighting,
                            smoothing_tau_s=smoothing_tau_s,
                            minimum_anisotropy=anisotropy,
                        )
                    )
    return tuple(sorted(result, key=lambda config: config.config_id))


CANDIDATE_CONFIGS = _candidate_configs()
CONFIGS_BY_ID = {config.config_id: config for config in CANDIDATE_CONFIGS}


def get_body_heading_config(config_id: str) -> BodyHeadingConfig:
    try:
        return CONFIGS_BY_ID[config_id]
    except KeyError as error:
        raise ValueError(f"Unknown body-heading config: {config_id}") from error


def _wrap_angle(angle: float) -> float:
    return (angle + math.pi) % (2.0 * math.pi) - math.pi


def _sensor_samples(
    session: NormalizedSensorSession, sensor_type: str
) -> tuple[SensorSample, ...]:
    return tuple(
        sorted(
            (
                sample
                for sample in session.samples
                if sample.sensor_type == sensor_type
            ),
            key=lambda sample: (sample.sensor_timestamp_ns, sample.sequence_id),
        )
    )


def _normalized_xyzw(values: tuple[float, ...]) -> tuple[float, float, float, float]:
    if len(values) < 3:
        raise ValueError("Game Rotation Vector requires at least x/y/z")
    x, y, z = values[:3]
    w = values[3] if len(values) >= 4 else math.sqrt(max(0.0, 1.0 - x*x - y*y - z*z))
    norm = math.sqrt(w*w + x*x + y*y + z*z)
    if norm <= 1e-12:
        raise ValueError("Game Rotation Vector quaternion has zero norm")
    return x / norm, y / norm, z / norm, w / norm


def _device_to_reference(
    values: tuple[float, ...], rotation_values: tuple[float, ...]
) -> tuple[float, float, float]:
    """Apply Android's row-major device-to-reference rotation matrix."""

    if len(values) < 3:
        raise ValueError("Accelerometer sample requires x/y/z")
    x, y, z, w = _normalized_xyzw(rotation_values)
    r00 = 1.0 - 2.0 * (y*y + z*z)
    r01 = 2.0 * (x*y - w*z)
    r02 = 2.0 * (x*z + w*y)
    r10 = 2.0 * (x*y + w*z)
    r11 = 1.0 - 2.0 * (x*x + z*z)
    r12 = 2.0 * (y*z - w*x)
    r20 = 2.0 * (x*z - w*y)
    r21 = 2.0 * (y*z + w*x)
    r22 = 1.0 - 2.0 * (x*x + y*y)
    ax, ay, az = values[:3]
    return (
        r00 * ax + r01 * ay + r02 * az,
        r10 * ax + r11 * ay + r12 * az,
        r20 * ax + r21 * ay + r22 * az,
    )


def prepare_heading_signal(session: NormalizedSensorSession) -> PreparedHeadingSignal:
    accelerometer = _sensor_samples(session, ACCELEROMETER)
    orientations = _sensor_samples(session, GAME_ROTATION_VECTOR)
    missing = []
    if not accelerometer:
        missing.append(ACCELEROMETER)
    if not orientations:
        missing.append(GAME_ROTATION_VECTOR)
    if missing:
        return PreparedHeadingSignal(
            session_id=session.session_id,
            samples=(),
            missing_requirements=tuple(missing),
        )

    orientation_index = -1
    result: list[HorizontalAccelerationSample] = []
    for sample in accelerometer:
        while (
            orientation_index + 1 < len(orientations)
            and orientations[orientation_index + 1].sensor_timestamp_ns
            <= sample.sensor_timestamp_ns
        ):
            orientation_index += 1
        if orientation_index < 0:
            continue
        orientation = orientations[orientation_index]
        reference_acceleration = _device_to_reference(sample.values, orientation.values)
        result.append(
            HorizontalAccelerationSample(
                timestamp_ns=sample.sensor_timestamp_ns,
                x_mps2=reference_acceleration[0],
                y_mps2=reference_acceleration[1],
                z_mps2=reference_acceleration[2],
                orientation_timestamp_ns=orientation.sensor_timestamp_ns,
            )
        )
    if not result:
        return PreparedHeadingSignal(
            session_id=session.session_id,
            samples=(),
            missing_requirements=("causal-accelerometer/orientation-overlap",),
        )
    return PreparedHeadingSignal(session_id=session.session_id, samples=tuple(result))


def _sample_weight(sample: HorizontalAccelerationSample, weighting: str) -> float:
    if weighting == "uniform":
        return 1.0
    if weighting == "horizontal-energy":
        # The cap prevents a single impact/outlier from determining the axis.
        energy = sample.x_mps2 * sample.x_mps2 + sample.y_mps2 * sample.y_mps2
        return 1.0 + min(25.0, energy)
    raise ValueError(f"Unknown body-heading weighting: {weighting}")


def _principal_axis(
    *,
    sum_weight: float,
    sum_x: float,
    sum_y: float,
    sum_xx: float,
    sum_xy: float,
    sum_yy: float,
) -> tuple[float, float, float]:
    if sum_weight <= 0.0:
        return 0.0, 0.0, 0.0
    mean_x = sum_x / sum_weight
    mean_y = sum_y / sum_weight
    covariance_xx = max(0.0, sum_xx / sum_weight - mean_x * mean_x)
    covariance_xy = sum_xy / sum_weight - mean_x * mean_y
    covariance_yy = max(0.0, sum_yy / sum_weight - mean_y * mean_y)
    discriminant = math.sqrt(
        max(
            0.0,
            (covariance_xx - covariance_yy) ** 2
            + 4.0 * covariance_xy * covariance_xy,
        )
    )
    principal = max(0.0, 0.5 * (covariance_xx + covariance_yy + discriminant))
    secondary = max(0.0, 0.5 * (covariance_xx + covariance_yy - discriminant))
    anisotropy = principal / max(secondary, 1e-12)
    axis = 0.5 * math.atan2(
        2.0 * covariance_xy, covariance_xx - covariance_yy
    )
    return axis, principal, anisotropy


def _closest_axis(axis: float, previous_axis: float) -> float:
    direct = _wrap_angle(axis - previous_axis)
    opposite_axis = _wrap_angle(axis + math.pi)
    opposite = _wrap_angle(opposite_axis - previous_axis)
    return _wrap_angle(previous_axis + (opposite if abs(opposite) < abs(direct) else direct))


def _smooth_axis(
    previous_axis: float,
    new_axis: float,
    *,
    delta_s: float,
    tau_s: float,
) -> float:
    if tau_s <= 0.0 or delta_s <= 0.0:
        return _wrap_angle(new_axis)
    alpha = math.exp(-delta_s / tau_s)
    x = alpha * math.cos(previous_axis) + (1.0 - alpha) * math.cos(new_axis)
    y = alpha * math.sin(previous_axis) + (1.0 - alpha) * math.sin(new_axis)
    if math.hypot(x, y) <= 1e-12:
        return _wrap_angle(new_axis)
    return math.atan2(y, x)


def estimate_prepared_body_heading(
    signal: PreparedHeadingSignal, *, config: BodyHeadingConfig
) -> BodyHeadingRun:
    requirement = frozenset({ACCELEROMETER, GAME_ROTATION_VECTOR})
    if signal.missing_requirements or not signal.samples:
        return BodyHeadingRun(
            estimator="causal horizontal-acceleration PCA body heading",
            version=f"1.0.0+{config.config_id}",
            required_capability_profile="platform-fused",
            supported=False,
            used_sensor_types=frozenset(),
            points=(),
            missing_requirements=signal.missing_requirements or ("no-samples",),
        )
    if config.output_rate_hz <= 0 or 1_000_000_000 % config.output_rate_hz:
        raise ValueError("output_rate_hz must divide one second exactly")

    period_ns = 1_000_000_000 // config.output_rate_hz
    window_ns = round(config.window_s * 1_000_000_000)
    reset_gap_ns = round(config.reset_gap_s * 1_000_000_000)
    minimum_span_ns = round(window_ns * config.minimum_window_fraction)
    first_timestamp_ns = signal.samples[0].timestamp_ns
    first_tick_ns = ((first_timestamp_ns + period_ns - 1) // period_ns) * period_ns
    last_tick_ns = signal.samples[-1].timestamp_ns // period_ns * period_ns

    window: deque[tuple[HorizontalAccelerationSample, float]] = deque()
    sum_weight = 0.0
    sum_x = 0.0
    sum_y = 0.0
    sum_xx = 0.0
    sum_xy = 0.0
    sum_yy = 0.0

    def remove_left() -> None:
        nonlocal sum_weight, sum_x, sum_y, sum_xx, sum_xy, sum_yy
        old, weight = window.popleft()
        sum_weight -= weight
        sum_x -= weight * old.x_mps2
        sum_y -= weight * old.y_mps2
        sum_xx -= weight * old.x_mps2 * old.x_mps2
        sum_xy -= weight * old.x_mps2 * old.y_mps2
        sum_yy -= weight * old.y_mps2 * old.y_mps2

    def clear_window() -> None:
        while window:
            remove_left()

    sample_index = 0
    last_signal_timestamp_ns: int | None = None
    previous_axis: float | None = None
    reference_axis: float | None = None
    last_accepted_timestamp_ns: int | None = None
    result: list[BodyHeadingPoint] = []

    for tick_ns in range(first_tick_ns, last_tick_ns + 1, period_ns):
        while (
            sample_index < len(signal.samples)
            and signal.samples[sample_index].timestamp_ns <= tick_ns
        ):
            sample = signal.samples[sample_index]
            if (
                last_signal_timestamp_ns is not None
                and sample.timestamp_ns - last_signal_timestamp_ns > reset_gap_ns
            ):
                clear_window()
            weight = _sample_weight(sample, config.weighting)
            window.append((sample, weight))
            sum_weight += weight
            sum_x += weight * sample.x_mps2
            sum_y += weight * sample.y_mps2
            sum_xx += weight * sample.x_mps2 * sample.x_mps2
            sum_xy += weight * sample.x_mps2 * sample.y_mps2
            sum_yy += weight * sample.y_mps2 * sample.y_mps2
            last_signal_timestamp_ns = sample.timestamp_ns
            sample_index += 1

        if last_signal_timestamp_ns is None:
            continue
        if tick_ns - last_signal_timestamp_ns > reset_gap_ns:
            clear_window()
            continue
        cutoff_ns = tick_ns - window_ns
        while window and window[0][0].timestamp_ns < cutoff_ns:
            remove_left()
        if len(window) < 5:
            continue
        source_start_ns = window[0][0].timestamp_ns
        source_end_ns = window[-1][0].timestamp_ns
        if source_end_ns - source_start_ns < minimum_span_ns:
            continue

        axis, principal_variance, anisotropy = _principal_axis(
            sum_weight=sum_weight,
            sum_x=sum_x,
            sum_y=sum_y,
            sum_xx=sum_xx,
            sum_xy=sum_xy,
            sum_yy=sum_yy,
        )
        fresh = (
            principal_variance >= config.minimum_principal_variance_mps4
            and anisotropy >= config.minimum_anisotropy
        )
        if fresh:
            if previous_axis is not None:
                axis = _closest_axis(axis, previous_axis)
                assert last_accepted_timestamp_ns is not None
                axis = _smooth_axis(
                    previous_axis,
                    axis,
                    delta_s=(tick_ns - last_accepted_timestamp_ns) / 1_000_000_000,
                    tau_s=config.smoothing_tau_s,
                )
            previous_axis = axis
            last_accepted_timestamp_ns = tick_ns
            if reference_axis is None:
                reference_axis = axis
        if previous_axis is None or reference_axis is None:
            continue
        result.append(
            BodyHeadingPoint(
                timestamp_ns=tick_ns,
                heading_rad=_wrap_angle(previous_axis - reference_axis),
                anisotropy=anisotropy,
                fresh=fresh,
                source_start_ns=source_start_ns,
                source_end_ns=source_end_ns,
            )
        )

    return BodyHeadingRun(
        estimator="causal horizontal-acceleration PCA body heading",
        version=f"1.0.0+{config.config_id}",
        required_capability_profile="platform-fused",
        supported=bool(result),
        used_sensor_types=requirement if result else frozenset(),
        points=tuple(result),
        missing_requirements=() if result else ("body-heading:not-initialized",),
    )


def estimate_body_heading(
    session: NormalizedSensorSession, *, config: BodyHeadingConfig
) -> BodyHeadingRun:
    return estimate_prepared_body_heading(prepare_heading_signal(session), config=config)


def _device_y_heading(rotation_values: tuple[float, ...]) -> float:
    x, y, z, w = _normalized_xyzw(rotation_values)
    rotation_01 = 2.0 * (x*y - w*z)
    rotation_11 = 1.0 - 2.0 * (x*x + z*z)
    android_azimuth = math.atan2(rotation_01, rotation_11)
    return _wrap_angle(math.pi / 2.0 - android_azimuth)


def estimate_device_heading_baseline(
    session: NormalizedSensorSession, *, output_rate_hz: int = 10
) -> BodyHeadingRun:
    orientations = _sensor_samples(session, GAME_ROTATION_VECTOR)
    if not orientations:
        return BodyHeadingRun(
            estimator="direct Game Rotation Vector device heading",
            version="1.0.0",
            required_capability_profile="platform-fused",
            supported=False,
            used_sensor_types=frozenset(),
            points=(),
            missing_requirements=(GAME_ROTATION_VECTOR,),
        )
    if output_rate_hz <= 0 or 1_000_000_000 % output_rate_hz:
        raise ValueError("output_rate_hz must divide one second exactly")
    period_ns = 1_000_000_000 // output_rate_hz
    first_tick_ns = (
        (orientations[0].sensor_timestamp_ns + period_ns - 1) // period_ns
    ) * period_ns
    last_tick_ns = orientations[-1].sensor_timestamp_ns // period_ns * period_ns
    orientation_index = -1
    reference_heading: float | None = None
    result = []
    for tick_ns in range(first_tick_ns, last_tick_ns + 1, period_ns):
        while (
            orientation_index + 1 < len(orientations)
            and orientations[orientation_index + 1].sensor_timestamp_ns <= tick_ns
        ):
            orientation_index += 1
        if orientation_index < 0:
            continue
        orientation = orientations[orientation_index]
        heading = _device_y_heading(orientation.values)
        if reference_heading is None:
            reference_heading = heading
        result.append(
            BodyHeadingPoint(
                timestamp_ns=tick_ns,
                heading_rad=_wrap_angle(heading - reference_heading),
                anisotropy=0.0,
                fresh=True,
                source_start_ns=orientation.sensor_timestamp_ns,
                source_end_ns=orientation.sensor_timestamp_ns,
            )
        )
    return BodyHeadingRun(
        estimator="direct Game Rotation Vector device heading",
        version="1.0.0",
        required_capability_profile="platform-fused",
        supported=bool(result),
        used_sensor_types=frozenset({GAME_ROTATION_VECTOR}) if result else frozenset(),
        points=tuple(result),
        missing_requirements=() if result else ("device-heading:no-output",),
    )
