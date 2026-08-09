"""RoNIN raw-Android adapter with truth isolated to an evaluation fixture."""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
import math
from pathlib import Path

import h5py
import numpy as np

from .contracts import NormalizedSensorSession, SensorMetadata, SensorSample
from .synthetic import TruthPoint


@dataclass(frozen=True)
class RoNINFixture:
    session: NormalizedSensorSession
    ground_truth: tuple[TruthPoint, ...]
    dataset_hash: str
    sequence: str
    target_rate_hz: int
    evaluation_notes: tuple[str, ...]


def _metadata(sensor_type: str, target_rate_hz: int, device: str) -> SensorMetadata:
    return SensorMetadata(
        sensor_type=sensor_type,
        android_api="android.hardware.SensorEvent.values",
        vendor=f"RoNIN artifact device={device}; Sensor.getVendor not retained",
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


def _downsample_continuous(
    rows: np.ndarray,
    *,
    start_ns: int,
    end_ns: int,
    target_rate_hz: int,
    take_last_values: bool,
) -> tuple[tuple[int, tuple[float, ...]], ...]:
    timestamps = rows[:, 0].astype(np.int64)
    mask = (timestamps >= start_ns) & (timestamps <= end_ns)
    timestamps = timestamps[mask]
    values = rows[mask, 1:]
    if not len(timestamps):
        return ()
    bucket_ids = ((timestamps - start_ns) * target_rate_hz) // 1_000_000_000
    _, starts = np.unique(bucket_ids, return_index=True)
    ends = np.concatenate((starts[1:] - 1, np.array([len(timestamps) - 1])))
    if take_last_values:
        reduced = values[ends]
    else:
        sums = np.add.reduceat(values, starts, axis=0)
        counts = (ends - starts + 1).reshape(-1, 1)
        reduced = sums / counts
    return tuple(
        (
            int(timestamps[end] - start_ns),
            tuple(float(value) for value in row),
        )
        for end, row in zip(ends, reduced)
    )


def _quaternion_multiply(left: np.ndarray, right: np.ndarray) -> np.ndarray:
    lw, lx, ly, lz = np.moveaxis(left, -1, 0)
    rw, rx, ry, rz = np.moveaxis(right, -1, 0)
    return np.stack(
        (
            lw * rw - lx * rx - ly * ry - lz * rz,
            lw * rx + lx * rw + ly * rz - lz * ry,
            lw * ry - lx * rz + ly * rw + lz * rx,
            lw * rz + lx * ry - ly * rx + lz * rw,
        ),
        axis=-1,
    )


def _body_heading(
    tango_orientation_wxyz: np.ndarray,
    align_tango_to_body_wxyz: np.ndarray,
) -> np.ndarray:
    alignment_conjugate = align_tango_to_body_wxyz.copy()
    alignment_conjugate[1:] *= -1.0
    body = _quaternion_multiply(tango_orientation_wxyz, alignment_conjugate)
    norms = np.linalg.norm(body, axis=1, keepdims=True)
    body = body / np.where(norms == 0.0, 1.0, norms)
    _, x, y, z = np.moveaxis(body, -1, 0)
    w = body[:, 0]
    rotation_01 = 2.0 * (x * y - w * z)
    rotation_11 = 1.0 - 2.0 * (x * x + z * z)
    android_azimuth = np.unwrap(np.arctan2(rotation_01, rotation_11))
    return math.pi / 2.0 - android_azimuth


def _truth_points(
    timestamps_s: np.ndarray,
    positions: np.ndarray,
    tango_orientation_wxyz: np.ndarray,
    align_tango_to_body_wxyz: np.ndarray,
) -> tuple[TruthPoint, ...]:
    origin = positions[0, :2]
    xy = positions[:, :2] - origin
    absolute_heading = _body_heading(
        tango_orientation_wxyz, align_tango_to_body_wxyz
    )
    initial_heading = float(absolute_heading[0])
    cosine = math.cos(-initial_heading)
    sine = math.sin(-initial_heading)
    rotation = np.array(((cosine, -sine), (sine, cosine)))
    local_xy = xy @ rotation.T
    headings = np.arctan2(
        np.sin(absolute_heading - initial_heading),
        np.cos(absolute_heading - initial_heading),
    )
    relative_ns = np.rint((timestamps_s - timestamps_s[0]) * 1_000_000_000).astype(
        np.int64
    )
    return tuple(
        TruthPoint(
            timestamp_ns=int(timestamp_ns),
            x_m=float(point[0]),
            y_m=float(point[1]),
            body_heading_rad=float(heading),
            stride_m=0.0,
        )
        for timestamp_ns, point, heading in zip(relative_ns, local_xy, headings)
    )


def load_ronin_raw_fixture(
    *,
    data_path: Path,
    info_path: Path,
    member_sha256: str,
    target_rate_hz: int,
) -> RoNINFixture:
    if target_rate_hz not in {50, 100}:
        raise ValueError("RoNIN replay rate must be 50 or 100 Hz")
    info = json.loads(info_path.read_text(encoding="utf-8"))
    start_frame = int(info.get("start_frame", 0))
    imu_time_offset_s = float(info["imu_time_offset"])
    with h5py.File(data_path, "r") as handle:
        synced_time = np.asarray(handle["synced/time"])
        tango_position = np.asarray(handle["pose/tango_pos"])
        tango_orientation = np.asarray(handle["pose/tango_ori"])
        if start_frame >= len(synced_time) - 1:
            raise ValueError("RoNIN start_frame leaves no evaluation interval")
        evaluation_time = synced_time[start_frame:]
        evaluation_position = tango_position[start_frame:]
        evaluation_orientation = tango_orientation[start_frame:]
        raw_start_ns = round((evaluation_time[0] + imu_time_offset_s) * 1e9)
        raw_end_ns = round((evaluation_time[-1] + imu_time_offset_s) * 1e9)
        sensor_rows = {
            "TYPE_ACCELEROMETER": np.asarray(handle["raw/imu/acce"]),
            "TYPE_GYROSCOPE": np.asarray(handle["raw/imu/gyro"]),
            "TYPE_GAME_ROTATION_VECTOR": np.asarray(handle["raw/imu/game_rv"]),
        }

    streams: dict[str, tuple[tuple[int, tuple[float, ...]], ...]] = {}
    for sensor_type, rows in sensor_rows.items():
        rate = (
            min(50, target_rate_hz)
            if sensor_type == "TYPE_GAME_ROTATION_VECTOR"
            else target_rate_hz
        )
        stream = _downsample_continuous(
            rows,
            start_ns=raw_start_ns,
            end_ns=raw_end_ns,
            target_rate_hz=rate,
            take_last_values=sensor_type == "TYPE_GAME_ROTATION_VECTOR",
        )
        if sensor_type == "TYPE_GAME_ROTATION_VECTOR":
            stream = tuple(
                (timestamp_ns, (values[1], values[2], values[3], values[0]))
                for timestamp_ns, values in stream
            )
        streams[sensor_type] = stream

    samples_without_ids = sorted(
        (
            (timestamp_ns, sensor_type, values)
            for sensor_type, stream in streams.items()
            for timestamp_ns, values in stream
        ),
        key=lambda item: (item[0], item[1]),
    )
    samples = tuple(
        SensorSample(
            sensor_type=sensor_type,
            sensor_timestamp_ns=timestamp_ns,
            callback_timestamp_ns=timestamp_ns,
            values=values,
            accuracy=0,
            sequence_id=index,
            batch_id=index,
        )
        for index, (timestamp_ns, sensor_type, values) in enumerate(samples_without_ids)
    )
    if not samples:
        raise ValueError("RoNIN raw adapter produced no samples")

    sequence = info_path.parent.name
    session = NormalizedSensorSession(
        session_id=f"ronin-{sequence}-{target_rate_hz}hz",
        capability_profile="platform-fused",
        sensor_metadata=tuple(
            _metadata(
                sensor_type,
                min(50, target_rate_hz)
                if sensor_type == "TYPE_GAME_ROTATION_VECTOR"
                else target_rate_hz,
                str(info.get("device", "unknown")),
            )
            for sensor_type in sorted(streams)
        ),
        samples=samples,
        provenance={
            "dataset": "RoNIN",
            "sequence": sequence,
            "artifact_member_sha256": member_sha256,
            "adapter": "ronin-raw-hdf5-v1",
            "inference_hdf_paths": "raw/imu/acce,raw/imu/gyro,raw/imu/game_rv",
            "input_time_basis": "raw IMU Android system timestamp, sequence-relative",
            "callback_time_limitation": (
                "artifact does not retain callback timestamps; "
                "set equal to sensor time"
            ),
            "truth_isolation": (
                "synced/time, pose/*, start_frame, and imu_time_offset "
                "are evaluation-only"
            ),
            "license_scope": "non-commercial scientific research benchmark only",
        },
    )
    fixture_hash = hashlib.sha256(
        f"{member_sha256}:ronin-raw-hdf5-v1:{target_rate_hz}".encode("utf-8")
    ).hexdigest()
    return RoNINFixture(
        session=session,
        ground_truth=_truth_points(
            evaluation_time,
            evaluation_position,
            evaluation_orientation,
            np.asarray(info["align_tango_to_body"], dtype=float),
        ),
        dataset_hash=fixture_hash,
        sequence=sequence,
        target_rate_hz=target_rate_hz,
        evaluation_notes=(
            "Input uses only raw/imu Android streams and raw IMU timestamps.",
            "start_frame and imu_time_offset select/align evaluation truth only.",
            "Tango orientation and align_tango_to_body define body-heading truth "
            "and the evaluation frame; no later shape alignment is applied.",
            "The artifact lacks callback, Sensor metadata, accuracy, FIFO, and "
            "lifecycle diagnostics.",
        ),
    )
