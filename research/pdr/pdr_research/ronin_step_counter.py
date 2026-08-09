"""Metadata-only RoNIN Android Step Counter reference extraction.

The platform counter is an optional Android-obtainable comparator, not motion
capture truth.  Only aggregate counts and callback-gap diagnostics leave this
module; raw counter rows are never serialized by the research scripts.
"""

from __future__ import annotations

from dataclasses import dataclass
import json
from pathlib import Path

import h5py
import numpy as np


@dataclass(frozen=True)
class PlatformStepCounterReference:
    sensor_type: str
    android_api: str
    counter_delta: int
    boundary_min_count: int
    boundary_max_count: int | None
    first_post_start_increment: int
    first_post_end_increment: int | None
    callback_rows_in_interval: int
    callback_jump_count: int
    unobserved_increment_count: int
    baseline_timestamp_ns: int
    terminal_timestamp_ns: int
    interval_start_ns: int
    interval_end_ns: int
    limitation: str


def load_ronin_step_counter_reference(
    *, data_path: Path, info_path: Path
) -> PlatformStepCounterReference:
    info = json.loads(info_path.read_text(encoding="utf-8"))
    start_frame = int(info.get("start_frame", 0))
    imu_time_offset_s = float(info["imu_time_offset"])
    with h5py.File(data_path, "r") as handle:
        synced_time = np.asarray(handle["synced/time"])
        if start_frame >= len(synced_time) - 1:
            raise ValueError("RoNIN start_frame leaves no counter interval")
        interval_start_ns = round(
            (synced_time[start_frame] + imu_time_offset_s) * 1e9
        )
        interval_end_ns = round((synced_time[-1] + imu_time_offset_s) * 1e9)
        if "raw/imu/step" not in handle:
            raise ValueError("RoNIN sequence has no raw Android Step Counter stream")
        rows = np.asarray(handle["raw/imu/step"])

    if rows.ndim != 2 or rows.shape[1] < 2 or len(rows) < 2:
        raise ValueError("RoNIN Step Counter stream has an invalid shape")
    timestamps = rows[:, 0].astype(np.int64)
    values = rows[:, 1]
    if np.any(np.diff(timestamps) <= 0):
        raise ValueError("RoNIN Step Counter timestamps are not strictly increasing")
    if np.any(np.abs(values - np.rint(values)) > 1e-6):
        raise ValueError("RoNIN Step Counter values are not integer-like")
    values = np.rint(values).astype(np.int64)
    if np.any(np.diff(values) < 0):
        raise ValueError("RoNIN Step Counter reset inside the sequence")

    baseline_indices = np.flatnonzero(timestamps <= interval_start_ns)
    terminal_indices = np.flatnonzero(timestamps <= interval_end_ns)
    if not len(baseline_indices) or not len(terminal_indices):
        raise ValueError("Step Counter does not bracket the evaluation interval")
    baseline_index = int(baseline_indices[-1])
    terminal_index = int(terminal_indices[-1])
    if terminal_index <= baseline_index:
        raise ValueError("Step Counter has no increment opportunity in interval")
    interval_values = values[baseline_index : terminal_index + 1]
    increments = np.diff(interval_values)
    positive = increments[increments > 0]
    counter_delta = int(interval_values[-1] - interval_values[0])
    if int(positive.sum()) != counter_delta:
        raise ValueError("Step Counter delta disagrees with positive increments")
    first_post_start_increment = int(values[baseline_index + 1] - values[baseline_index])
    if timestamps[baseline_index] == interval_start_ns:
        boundary_min_count = counter_delta
    else:
        boundary_min_count = counter_delta - first_post_start_increment + 1
    if terminal_index + 1 < len(values):
        first_post_end_increment = int(
            values[terminal_index + 1] - values[terminal_index]
        )
        boundary_max_count = counter_delta + max(0, first_post_end_increment - 1)
    else:
        first_post_end_increment = None
        boundary_max_count = None

    return PlatformStepCounterReference(
        sensor_type="TYPE_STEP_COUNTER",
        android_api="android.hardware.Sensor.TYPE_STEP_COUNTER",
        counter_delta=counter_delta,
        boundary_min_count=boundary_min_count,
        boundary_max_count=boundary_max_count,
        first_post_start_increment=first_post_start_increment,
        first_post_end_increment=first_post_end_increment,
        callback_rows_in_interval=terminal_index - baseline_index,
        callback_jump_count=int(np.count_nonzero(increments > 1)),
        unobserved_increment_count=int(sum(max(0, int(value) - 1) for value in positive)),
        baseline_timestamp_ns=int(timestamps[baseline_index]),
        terminal_timestamp_ns=int(timestamps[terminal_index]),
        interval_start_ns=interval_start_ns,
        interval_end_ns=interval_end_ns,
        limitation=(
            "OEM/platform Step Counter output is Android-obtainable but is not "
            "manual or motion-capture step truth; jumps recover total increments "
            "without exact timestamps for skipped callbacks, and jumps that "
            "straddle interval boundaries create the reported count bounds"
        ),
    )
