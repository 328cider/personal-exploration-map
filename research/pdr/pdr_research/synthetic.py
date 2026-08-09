"""Deterministic Android-shaped synthetic sessions for pipeline tests only."""

from __future__ import annotations

from dataclasses import dataclass, replace
import hashlib
import json
import math
import random

from .contracts import NormalizedSensorSession, SensorMetadata, SensorSample


@dataclass(frozen=True)
class TruthPoint:
    timestamp_ns: int
    x_m: float
    y_m: float
    body_heading_rad: float
    stride_m: float


@dataclass(frozen=True)
class SyntheticFixture:
    session: NormalizedSensorSession
    ground_truth: tuple[TruthPoint, ...]
    dataset_hash: str


ROUTES: dict[str, tuple[tuple[float, float], ...]] = {
    "straight": ((0.0, 0.0), (100.0, 0.0)),
    "rectangle": ((0.0, 0.0), (20.0, 0.0), (20.0, 10.0), (0.0, 10.0), (0.0, 0.0)),
    "out-and-back": ((0.0, 0.0), (30.0, 0.0), (0.0, 0.0)),
    "loop": ((0.0, 0.0), (15.0, 2.0), (18.0, 14.0), (3.0, 18.0), (-2.0, 7.0), (0.0, 0.0)),
}


def _metadata(sensor_type: str) -> SensorMetadata:
    return SensorMetadata(
        sensor_type=sensor_type,
        android_api="android.hardware.SensorEvent",
        vendor="synthetic-not-a-device",
        version=1,
        resolution=0.001,
        maximum_range=100.0,
        power_ma=0.0,
        min_delay_us=10_000,
        max_delay_us=1_000_000,
        fifo_reserved_count=0,
        fifo_max_count=0,
        is_wake_up=False,
        reporting_mode="continuous",
    )


def _dense_truth(
    vertices: tuple[tuple[float, float], ...], sample_rate_hz: int, speed_mps: float
) -> tuple[TruthPoint, ...]:
    period_ns = round(1_000_000_000 / sample_rate_hz)
    elapsed_ns = 0
    result: list[TruthPoint] = []
    for segment_index, (start, end) in enumerate(zip(vertices, vertices[1:])):
        dx, dy = end[0] - start[0], end[1] - start[1]
        distance = math.hypot(dx, dy)
        heading = math.atan2(dy, dx)
        count = max(1, round(distance / speed_mps * sample_rate_hz))
        for offset in range(count):
            if segment_index > 0 and offset == 0:
                continue
            fraction = offset / count
            result.append(
                TruthPoint(
                    timestamp_ns=elapsed_ns,
                    x_m=start[0] + dx * fraction,
                    y_m=start[1] + dy * fraction,
                    body_heading_rad=heading,
                    stride_m=0.72,
                )
            )
            elapsed_ns += period_ns
    final_heading = result[-1].body_heading_rad
    result.append(
        TruthPoint(elapsed_ns, vertices[-1][0], vertices[-1][1], final_heading, 0.72)
    )
    return tuple(result)


def generate_fixture(
    *,
    route: str = "rectangle",
    sample_rate_hz: int = 100,
    seed: int = 7,
    batch_latency_ms: int = 0,
    gaps: tuple[tuple[float, float], ...] = (),
    timestamp_jitter_us: int = 0,
    include_magnetometer: bool = False,
    magnetic_anomaly: tuple[float, float] | None = None,
    device_yaw_changes: tuple[tuple[float, float], ...] = (),
) -> SyntheticFixture:
    if route not in ROUTES:
        raise ValueError(f"Unknown route: {route}")
    if sample_rate_hz not in {50, 100}:
        raise ValueError("Foundation fixtures support the product target rates 50/100 Hz")
    rng = random.Random(seed)
    truth = _dense_truth(ROUTES[route], sample_rate_hz, speed_mps=1.25)
    period_ns = round(1_000_000_000 / sample_rate_hz)
    batch_ns = batch_latency_ms * 1_000_000
    sensor_types = ["TYPE_ACCELEROMETER", "TYPE_GYROSCOPE"]
    if include_magnetometer:
        sensor_types.append("TYPE_MAGNETIC_FIELD")
    samples: list[SensorSample] = []
    previous_ts = -1
    previous_device_yaw_rad = 0.0
    sequence_id = 0
    for index, point in enumerate(truth):
        t_s = point.timestamp_ns / 1_000_000_000
        if any(start <= t_s < end for start, end in gaps):
            continue
        jitter = rng.randint(-timestamp_jitter_us, timestamp_jitter_us) * 1_000
        sensor_ts = max(previous_ts + 1, point.timestamp_ns + jitter)
        previous_ts = sensor_ts
        if batch_ns:
            callback_ts = ((sensor_ts + batch_ns - 1) // batch_ns) * batch_ns
            batch_id = callback_ts // batch_ns
        else:
            callback_ts = sensor_ts
            batch_id = index
        phase = 2.0 * math.pi * 1.9 * t_s
        device_yaw_rad = math.radians(
            sum(change_deg for change_s, change_deg in device_yaw_changes if change_s <= t_s)
        )
        body_acceleration = (
            0.18 * math.sin(phase) + rng.gauss(0.0, 0.015),
            0.08 * math.cos(phase) + rng.gauss(0.0, 0.015),
            9.80665 + 0.55 * math.sin(phase) + rng.gauss(0.0, 0.02),
        )
        acceleration = (
            body_acceleration[0] * math.cos(device_yaw_rad)
            - body_acceleration[1] * math.sin(device_yaw_rad),
            body_acceleration[0] * math.sin(device_yaw_rad)
            + body_acceleration[1] * math.cos(device_yaw_rad),
            body_acceleration[2],
        )
        if index == 0:
            yaw_rate = 0.0
        else:
            delta = _wrap_angle(point.body_heading_rad - truth[index - 1].body_heading_rad)
            device_delta = _wrap_angle(device_yaw_rad - previous_device_yaw_rad)
            yaw_rate = (delta + device_delta) / max(period_ns / 1_000_000_000, 1e-9)
        previous_device_yaw_rad = device_yaw_rad
        gyro = (
            rng.gauss(0.0, 0.003),
            rng.gauss(0.0, 0.003),
            yaw_rate + 0.002 + rng.gauss(0.0, 0.003),
        )
        values_by_type = {
            "TYPE_ACCELEROMETER": acceleration,
            "TYPE_GYROSCOPE": gyro,
        }
        if include_magnetometer:
            disturbed = magnetic_anomaly is not None and magnetic_anomaly[0] <= t_s < magnetic_anomaly[1]
            values_by_type["TYPE_MAGNETIC_FIELD"] = (
                (90.0 if disturbed else 18.0) + rng.gauss(0.0, 0.3),
                (-70.0 if disturbed else 2.0) + rng.gauss(0.0, 0.3),
                (120.0 if disturbed else 43.0) + rng.gauss(0.0, 0.3),
            )
        for sensor_type in sensor_types:
            samples.append(
                SensorSample(
                    sensor_type=sensor_type,
                    sensor_timestamp_ns=sensor_ts,
                    callback_timestamp_ns=callback_ts,
                    values=values_by_type[sensor_type],
                    accuracy=3,
                    sequence_id=sequence_id,
                    batch_id=int(batch_id),
                )
            )
            sequence_id += 1
    session = NormalizedSensorSession(
        session_id=f"synthetic-{route}-{seed}",
        capability_profile="imu6",
        sensor_metadata=tuple(_metadata(sensor_type) for sensor_type in sensor_types),
        samples=tuple(samples),
        provenance={
            "kind": "synthetic-pipeline-fixture",
            "seed": str(seed),
            "sample_rate_hz": str(sample_rate_hz),
            "warning": "not evidence of real pocket motion performance",
        },
    )
    digest_payload = {
        "route": route,
        "sample_rate_hz": sample_rate_hz,
        "seed": seed,
        "batch_latency_ms": batch_latency_ms,
        "gaps": gaps,
        "timestamp_jitter_us": timestamp_jitter_us,
        "include_magnetometer": include_magnetometer,
        "magnetic_anomaly": magnetic_anomaly,
        "device_yaw_changes": device_yaw_changes,
    }
    dataset_hash = hashlib.sha256(
        json.dumps(digest_payload, sort_keys=True).encode("utf-8")
    ).hexdigest()
    return SyntheticFixture(session=session, ground_truth=truth, dataset_hash=dataset_hash)


def downsample_session(
    session: NormalizedSensorSession, *, source_rate_hz: int, target_rate_hz: int
) -> NormalizedSensorSession:
    if source_rate_hz % target_rate_hz:
        raise ValueError("Target rate must divide source rate for deterministic replay")
    divisor = source_rate_hz // target_rate_hz
    counters: dict[str, int] = {}
    kept: list[SensorSample] = []
    for sample in session.samples:
        counter = counters.get(sample.sensor_type, 0)
        if counter % divisor == 0:
            kept.append(replace(sample, sequence_id=len(kept)))
        counters[sample.sensor_type] = counter + 1
    return replace(session, samples=tuple(kept))


def drop_sensor(session: NormalizedSensorSession, sensor_type: str) -> NormalizedSensorSession:
    metadata = tuple(item for item in session.sensor_metadata if item.sensor_type != sensor_type)
    samples = tuple(item for item in session.samples if item.sensor_type != sensor_type)
    return replace(session, sensor_metadata=metadata, samples=samples)


def transform_truth(
    truth: tuple[TruthPoint, ...],
    *,
    scale: float = 1.0,
    rotation_deg: float = 0.0,
    mirror_x: bool = False,
) -> tuple[tuple[float, float], ...]:
    radians = math.radians(rotation_deg)
    cosine, sine = math.cos(radians), math.sin(radians)
    transformed: list[tuple[float, float]] = []
    for point in truth:
        x = -point.x_m if mirror_x else point.x_m
        y = point.y_m
        transformed.append(
            (scale * (x * cosine - y * sine), scale * (x * sine + y * cosine))
        )
    return tuple(transformed)


def _wrap_angle(angle: float) -> float:
    return (angle + math.pi) % (2.0 * math.pi) - math.pi
