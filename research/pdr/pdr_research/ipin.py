"""IPIN 2022 raw-Android adapter with every reference field excluded."""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, replace
import hashlib
import json
import math
from pathlib import Path
import statistics
from typing import Iterable

from .contracts import NormalizedSensorSession, SensorMetadata, SensorSample


RECORD_TO_SENSOR = {
    "ACCE": "TYPE_ACCELEROMETER",
    "GYRO": "TYPE_GYROSCOPE",
    "MAGN": "TYPE_MAGNETIC_FIELD",
}
SENSOR_TO_ANDROID = {
    "TYPE_ACCELEROMETER": "Sensor.TYPE_ACCELEROMETER / SensorEvent.values and timestamp",
    "TYPE_GYROSCOPE": "Sensor.TYPE_GYROSCOPE / SensorEvent.values and timestamp",
    "TYPE_MAGNETIC_FIELD": "Sensor.TYPE_MAGNETIC_FIELD / SensorEvent.values and timestamp",
}
FORBIDDEN_RECORD_TYPES = frozenset(
    {"AHRS", "POSI", "GNSS", "IMUL", "IMUX", "WIFI", "BLE4", "RFID"}
)
ADAPTER_VERSION = "ipin-2022-android-raw-v1"


@dataclass(frozen=True)
class IPINSensorEvent:
    record_type: str
    app_timestamp_s: float
    sensor_timestamp_s: float
    values: tuple[float, float, float]
    accuracy: int
    line_number: int


@dataclass(frozen=True)
class IPINRawLog:
    source_name: str
    source_sha256: str
    source_size_bytes: int
    events: tuple[IPINSensorEvent, ...]
    record_counts: dict[str, int]
    blank_line_count: int
    comment_line_count: int
    malformed_eligible_rows: int
    nonfinite_eligible_rows: int
    malformed_line_numbers: tuple[int, ...]


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def parse_ipin_log(path: Path) -> IPINRawLog:
    events: list[IPINSensorEvent] = []
    record_counts: Counter[str] = Counter()
    blank_lines = 0
    comment_lines = 0
    malformed = 0
    nonfinite = 0
    malformed_lines: list[int] = []

    with path.open("r", encoding="utf-8-sig", errors="replace", newline="") as stream:
        for line_number, raw_line in enumerate(stream, start=1):
            line = raw_line.strip()
            if not line:
                blank_lines += 1
                continue
            if line.startswith("%"):
                comment_lines += 1
                continue
            record_type = line.partition(";")[0].strip().upper() or "UNKNOWN"
            record_counts[record_type] += 1
            if record_type not in RECORD_TO_SENSOR:
                continue
            parts = line.split(";")
            if len(parts) != 7:
                malformed += 1
                if len(malformed_lines) < 20:
                    malformed_lines.append(line_number)
                continue
            try:
                numeric = tuple(float(value) for value in parts[1:])
            except ValueError:
                malformed += 1
                if len(malformed_lines) < 20:
                    malformed_lines.append(line_number)
                continue
            if not all(math.isfinite(value) for value in numeric):
                nonfinite += 1
                if len(malformed_lines) < 20:
                    malformed_lines.append(line_number)
                continue
            app_timestamp_s, sensor_timestamp_s, x, y, z, raw_accuracy = numeric
            accuracy = int(raw_accuracy)
            if not math.isclose(raw_accuracy, accuracy, rel_tol=0.0, abs_tol=1e-9):
                malformed += 1
                if len(malformed_lines) < 20:
                    malformed_lines.append(line_number)
                continue
            events.append(
                IPINSensorEvent(
                    record_type=record_type,
                    app_timestamp_s=app_timestamp_s,
                    sensor_timestamp_s=sensor_timestamp_s,
                    values=(x, y, z),
                    accuracy=accuracy,
                    line_number=line_number,
                )
            )

    return IPINRawLog(
        source_name=path.name,
        source_sha256=_sha256_file(path),
        source_size_bytes=path.stat().st_size,
        events=tuple(events),
        record_counts=dict(sorted(record_counts.items())),
        blank_line_count=blank_lines,
        comment_line_count=comment_lines,
        malformed_eligible_rows=malformed,
        nonfinite_eligible_rows=nonfinite,
        malformed_line_numbers=tuple(malformed_lines),
    )


def _nearest_rank(values: Iterable[float], percentile: float) -> float | None:
    ordered = sorted(values)
    if not ordered:
        return None
    index = max(0, min(len(ordered) - 1, math.ceil(percentile * len(ordered)) - 1))
    return float(ordered[index])


def _stream_summary(events: tuple[IPINSensorEvent, ...]) -> dict[str, object]:
    sensor_times = [event.sensor_timestamp_s for event in events]
    app_times = [event.app_timestamp_s for event in events]
    sensor_deltas = [right - left for left, right in zip(sensor_times, sensor_times[1:])]
    app_deltas = [right - left for left, right in zip(app_times, app_times[1:])]
    positive_deltas = [value for value in sensor_deltas if value > 0.0]
    norms = [math.sqrt(sum(value * value for value in event.values)) for event in events]
    clock_residuals = [
        event.app_timestamp_s - event.sensor_timestamp_s for event in events
    ]
    duration_s = sensor_times[-1] - sensor_times[0] if len(sensor_times) >= 2 else 0.0
    median_delta_s = statistics.median(positive_deltas) if positive_deltas else None
    return {
        "event_count": len(events),
        "duration_s": duration_s,
        "span_rate_hz": ((len(events) - 1) / duration_s if duration_s > 0 else None),
        "median_delta_s": median_delta_s,
        "median_rate_hz": (1.0 / median_delta_s if median_delta_s else None),
        "positive_sensor_delta_fraction": (
            sum(value > 0.0 for value in sensor_deltas) / len(sensor_deltas)
            if sensor_deltas
            else 0.0
        ),
        "positive_app_delta_fraction": (
            sum(value > 0.0 for value in app_deltas) / len(app_deltas)
            if app_deltas
            else 0.0
        ),
        "sensor_delta_p01_s": _nearest_rank(positive_deltas, 0.01),
        "sensor_delta_p50_s": _nearest_rank(positive_deltas, 0.50),
        "sensor_delta_p99_s": _nearest_rank(positive_deltas, 0.99),
        "maximum_sensor_gap_s": max(positive_deltas) if positive_deltas else None,
        "gaps_over_0_2_s": sum(value > 0.2 for value in positive_deltas),
        "gaps_over_1_s": sum(value > 1.0 for value in positive_deltas),
        "vector_norm_p01": _nearest_rank(norms, 0.01),
        "vector_norm_p50": _nearest_rank(norms, 0.50),
        "vector_norm_p99": _nearest_rank(norms, 0.99),
        "clock_residual_p01_s": _nearest_rank(clock_residuals, 0.01),
        "clock_residual_p50_s": _nearest_rank(clock_residuals, 0.50),
        "clock_residual_p99_s": _nearest_rank(clock_residuals, 0.99),
        "accuracy_counts": dict(
            sorted(Counter(str(event.accuracy) for event in events).items())
        ),
        "first_sensor_timestamp_s": sensor_times[0] if sensor_times else None,
        "last_sensor_timestamp_s": sensor_times[-1] if sensor_times else None,
        "first_app_timestamp_s": app_times[0] if app_times else None,
        "last_app_timestamp_s": app_times[-1] if app_times else None,
    }


def preflight_summary(raw: IPINRawLog) -> dict[str, object]:
    by_record = {
        record_type: tuple(
            event for event in raw.events if event.record_type == record_type
        )
        for record_type in RECORD_TO_SENSOR
    }
    stream_summaries = {
        RECORD_TO_SENSOR[record_type]: _stream_summary(events)
        for record_type, events in by_record.items()
    }
    accelerometer = by_record["ACCE"]
    gyroscope = by_record["GYRO"]
    common_start = max(
        (events[0].sensor_timestamp_s for events in (accelerometer, gyroscope) if events),
        default=0.0,
    )
    common_end = min(
        (events[-1].sensor_timestamp_s for events in (accelerometer, gyroscope) if events),
        default=0.0,
    )
    return {
        "source_name": raw.source_name,
        "source_sha256": raw.source_sha256,
        "source_size_bytes": raw.source_size_bytes,
        "record_counts": raw.record_counts,
        "admitted_record_types": sorted({event.record_type for event in raw.events}),
        "eligible_event_count": len(raw.events),
        "blank_line_count": raw.blank_line_count,
        "comment_line_count": raw.comment_line_count,
        "malformed_eligible_rows": raw.malformed_eligible_rows,
        "nonfinite_eligible_rows": raw.nonfinite_eligible_rows,
        "malformed_line_numbers": list(raw.malformed_line_numbers),
        "common_imu_coverage_s": max(0.0, common_end - common_start),
        "streams": stream_summaries,
        "excluded_record_counts": {
            record_type: raw.record_counts.get(record_type, 0)
            for record_type in sorted(FORBIDDEN_RECORD_TYPES)
        },
    }


def _metadata(sensor_type: str, target_rate_hz: int) -> SensorMetadata:
    return SensorMetadata(
        sensor_type=sensor_type,
        android_api=SENSOR_TO_ANDROID[sensor_type],
        vendor="IPIN artifact; Android Sensor.getVendor metadata not retained",
        version=0,
        resolution=0.0,
        maximum_range=0.0,
        power_ma=0.0,
        min_delay_us=round(1_000_000 / target_rate_hz),
        max_delay_us=0,
        fifo_reserved_count=0,
        fifo_max_count=0,
        is_wake_up=False,
        reporting_mode="continuous",
    )


def _resample_stream(
    events: tuple[IPINSensorEvent, ...],
    *,
    sensor_origin_s: float,
    minimum_clock_residual_s: float,
    target_rate_hz: int,
) -> tuple[tuple[int, int, tuple[float, ...], int], ...]:
    period_ns = 1_000_000_000 // target_rate_hz
    ordered = sorted(events, key=lambda event: (event.sensor_timestamp_s, event.line_number))
    result: list[tuple[int, int, tuple[float, ...], int]] = []
    current_bucket: int | None = None
    bucket_events: list[IPINSensorEvent] = []

    def flush(bucket: int, values: list[IPINSensorEvent]) -> None:
        if not values:
            return
        boundary_ns = (bucket + 1) * period_ns
        callback_candidates = [
            round(
                (
                    event.app_timestamp_s
                    - minimum_clock_residual_s
                    - sensor_origin_s
                )
                * 1_000_000_000
            )
            for event in values
        ]
        callback_ns = max(boundary_ns, max(callback_candidates))
        axes = tuple(
            sum(event.values[index] for event in values) / len(values)
            for index in range(3)
        )
        result.append(
            (boundary_ns, callback_ns, axes, min(event.accuracy for event in values))
        )

    for event in ordered:
        relative_ns = round((event.sensor_timestamp_s - sensor_origin_s) * 1_000_000_000)
        if relative_ns < 0:
            raise ValueError("Sensor timestamp precedes the session origin")
        bucket = relative_ns // period_ns
        if current_bucket is None:
            current_bucket = bucket
        elif bucket != current_bucket:
            flush(current_bucket, bucket_events)
            current_bucket = bucket
            bucket_events = []
        bucket_events.append(event)
    # The final bucket stays open: a causal live stream needs the next event to
    # prove that its time boundary has passed.
    return tuple(result)


def build_normalized_session(
    raw: IPINRawLog, *, session_id: str, target_rate_hz: int
) -> NormalizedSensorSession:
    if target_rate_hz not in {50, 100}:
        raise ValueError("IPIN replay rate must be 50 or 100 Hz")
    if raw.malformed_eligible_rows or raw.nonfinite_eligible_rows:
        raise ValueError("Malformed eligible IPIN rows cannot enter inference")
    by_record = {
        record_type: tuple(
            event for event in raw.events if event.record_type == record_type
        )
        for record_type in RECORD_TO_SENSOR
    }
    for record_type in ("ACCE", "GYRO"):
        events = by_record[record_type]
        if not events:
            raise ValueError(f"Required IPIN stream is missing: {record_type}")
        deltas = [
            right.sensor_timestamp_s - left.sensor_timestamp_s
            for left, right in zip(events, events[1:])
        ]
        if any(delta <= 0.0 for delta in deltas):
            raise ValueError(f"Nonpositive IPIN SensorTimestamp delta: {record_type}")

    sensor_origin_s = min(event.sensor_timestamp_s for event in raw.events)
    minimum_clock_residual_s = min(
        event.app_timestamp_s - event.sensor_timestamp_s for event in raw.events
    )
    streams: dict[str, tuple[tuple[int, int, tuple[float, ...], int], ...]] = {}
    for record_type, events in by_record.items():
        if events:
            sensor_type = RECORD_TO_SENSOR[record_type]
            streams[sensor_type] = _resample_stream(
                events,
                sensor_origin_s=sensor_origin_s,
                minimum_clock_residual_s=minimum_clock_residual_s,
                target_rate_hz=target_rate_hz,
            )

    merged = sorted(
        (
            (sensor_timestamp_ns, sensor_type, callback_timestamp_ns, values, accuracy)
            for sensor_type, stream in streams.items()
            for sensor_timestamp_ns, callback_timestamp_ns, values, accuracy in stream
        ),
        key=lambda item: (item[0], item[1]),
    )
    callback_ids = {
        timestamp: index
        for index, timestamp in enumerate(sorted({item[2] for item in merged}))
    }
    samples = tuple(
        SensorSample(
            sensor_type=sensor_type,
            sensor_timestamp_ns=sensor_timestamp_ns,
            callback_timestamp_ns=callback_timestamp_ns,
            values=values,
            accuracy=accuracy,
            sequence_id=index,
            batch_id=callback_ids[callback_timestamp_ns],
        )
        for index, (
            sensor_timestamp_ns,
            sensor_type,
            callback_timestamp_ns,
            values,
            accuracy,
        ) in enumerate(merged)
    )
    if not samples:
        raise ValueError("IPIN adapter produced no samples")
    return NormalizedSensorSession(
        session_id=f"{session_id}-{target_rate_hz}hz",
        capability_profile="imu6",
        sensor_metadata=tuple(
            _metadata(sensor_type, target_rate_hz) for sensor_type in sorted(streams)
        ),
        samples=samples,
        provenance={
            "dataset": "IPIN 2022 Track 3",
            "source_member": raw.source_name,
            "source_sha256": raw.source_sha256,
            "adapter": ADAPTER_VERSION,
            "target_rate_hz": str(target_rate_hz),
            "input_records": "ACCE,GYRO; MAGN quality-only",
            "input_time_basis": "SensorTimestamp, session-relative nanoseconds",
            "callback_proxy": (
                "AppTimestamp aligned by minimum observed App-Sensor residual; "
                "not claimed as a retained callback monotonic clock"
            ),
            "excluded_records": json.dumps(
                {
                    record_type: raw.record_counts.get(record_type, 0)
                    for record_type in sorted(FORBIDDEN_RECORD_TYPES)
                },
                sort_keys=True,
            ),
            "truth_isolation": "AHRS,POSI,GNSS,IMUL,IMUX and maps excluded",
            "license": "CC-BY-4.0 benchmark evidence",
        },
    )


def with_callback_batches(
    session: NormalizedSensorSession, *, batch_period_ns: int = 250_000_000
) -> NormalizedSensorSession:
    if batch_period_ns <= 0:
        raise ValueError("Batch period must be positive")
    samples = tuple(
        replace(
            sample,
            callback_timestamp_ns=(
                (sample.sensor_timestamp_ns + batch_period_ns - 1) // batch_period_ns
            )
            * batch_period_ns,
            batch_id=(sample.sensor_timestamp_ns // batch_period_ns),
        )
        for sample in session.samples
    )
    return replace(session, session_id=f"{session.session_id}-batch", samples=samples)


def without_sensor(
    session: NormalizedSensorSession, sensor_type: str
) -> NormalizedSensorSession:
    return replace(
        session,
        session_id=f"{session.session_id}-without-{sensor_type}",
        sensor_metadata=tuple(
            metadata
            for metadata in session.sensor_metadata
            if metadata.sensor_type != sensor_type
        ),
        samples=tuple(
            sample for sample in session.samples if sample.sensor_type != sensor_type
        ),
    )


def with_gap(
    session: NormalizedSensorSession, *, start_ns: int, end_ns: int
) -> NormalizedSensorSession:
    if end_ns <= start_ns:
        raise ValueError("Gap end must follow its start")
    return replace(
        session,
        session_id=f"{session.session_id}-gap",
        samples=tuple(
            sample
            for sample in session.samples
            if not start_ns <= sample.sensor_timestamp_ns < end_ns
        ),
    )


def stream_gap_count(
    session: NormalizedSensorSession,
    sensor_type: str,
    *,
    threshold_ns: int = 200_000_000,
) -> int:
    timestamps = sorted(
        sample.sensor_timestamp_ns
        for sample in session.samples
        if sample.sensor_type == sensor_type
    )
    return sum(right - left > threshold_ns for left, right in zip(timestamps, timestamps[1:]))
