from __future__ import annotations

import json
import math
from pathlib import Path
import sys
import tempfile
import unittest

import h5py
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from pdr_research.compatibility import validate_session  # noqa: E402
from pdr_research.estimators import run_b0  # noqa: E402
from pdr_research.ronin import load_ronin_raw_fixture  # noqa: E402


class RoNINAdapterTests(unittest.TestCase):
    def _fixture(self, directory: Path) -> tuple[Path, Path]:
        data_path = directory / "data.hdf5"
        info_path = directory / "info.json"
        source_rate = 200
        count = 801
        seconds = np.arange(count) / source_rate
        raw_ns = np.rint(seconds * 1e9).astype(np.int64)
        phase = 2.0 * math.pi * 1.9 * seconds
        acceleration = np.stack(
            (
                0.1 * np.sin(phase),
                0.1 * np.cos(phase),
                9.80665 + 1.2 * np.sin(phase),
            ),
            axis=1,
        )
        gyro = np.zeros((count, 3))
        game_rv_wxyz = np.tile(np.array((1.0, 0.0, 0.0, 0.0)), (count, 1))
        with h5py.File(data_path, "w") as handle:
            handle.create_dataset("raw/imu/acce", data=np.column_stack((raw_ns, acceleration)))
            handle.create_dataset("raw/imu/gyro", data=np.column_stack((raw_ns, gyro)))
            handle.create_dataset(
                "raw/imu/game_rv", data=np.column_stack((raw_ns, game_rv_wxyz))
            )
            handle.create_dataset("synced/time", data=seconds)
            handle.create_dataset(
                "pose/tango_pos", data=np.column_stack((seconds, np.zeros(count), np.zeros(count)))
            )
            handle.create_dataset(
                "pose/tango_ori",
                data=np.tile(np.array((1.0, 0.0, 0.0, 0.0)), (count, 1)),
            )
        info_path.write_text(
            json.dumps(
                {
                    "start_frame": 0,
                    "imu_time_offset": 0.0,
                    "device": "test-device",
                    "align_tango_to_body": [1.0, 0.0, 0.0, 0.0],
                }
            ),
            encoding="utf-8",
        )
        return data_path, info_path

    def test_raw_adapter_exposes_only_android_input_streams(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            data_path, info_path = self._fixture(Path(directory))
            fixture = load_ronin_raw_fixture(
                data_path=data_path,
                info_path=info_path,
                member_sha256="a" * 64,
                target_rate_hz=50,
            )
        validate_session(fixture.session)
        self.assertEqual(
            {sample.sensor_type for sample in fixture.session.samples},
            {
                "TYPE_ACCELEROMETER",
                "TYPE_GYROSCOPE",
                "TYPE_GAME_ROTATION_VECTOR",
            },
        )
        self.assertFalse(
            any("tango" in sample.sensor_type.lower() for sample in fixture.session.samples)
        )
        first_game_rv = next(
            sample
            for sample in fixture.session.samples
            if sample.sensor_type == "TYPE_GAME_ROTATION_VECTOR"
        )
        self.assertEqual(first_game_rv.values, (0.0, 0.0, 0.0, 1.0))
        self.assertFalse(run_b0(fixture.session).supported)

    def test_raw_adapter_downsamples_to_declared_rates(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            data_path, info_path = self._fixture(Path(directory))
            fixture = load_ronin_raw_fixture(
                data_path=data_path,
                info_path=info_path,
                member_sha256="b" * 64,
                target_rate_hz=100,
            )
        counts = {
            sensor_type: sum(
                sample.sensor_type == sensor_type for sample in fixture.session.samples
            )
            for sensor_type in {
                "TYPE_ACCELEROMETER",
                "TYPE_GYROSCOPE",
                "TYPE_GAME_ROTATION_VECTOR",
            }
        }
        self.assertTrue(395 <= counts["TYPE_ACCELEROMETER"] <= 402)
        self.assertTrue(395 <= counts["TYPE_GYROSCOPE"] <= 402)
        self.assertTrue(195 <= counts["TYPE_GAME_ROTATION_VECTOR"] <= 202)


if __name__ == "__main__":
    unittest.main()
