from __future__ import annotations

from pathlib import Path
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from pdr_research.compatibility import validate_session  # noqa: E402
from pdr_research.ipin import (  # noqa: E402
    build_normalized_session,
    parse_ipin_log,
    preflight_summary,
    stream_gap_count,
    with_callback_batches,
    with_gap,
    without_sensor,
)


def synthetic_log(*, duplicate_accelerometer_time: bool = False, malformed: bool = False) -> str:
    lines = ["% synthetic parser fixture; no public or personal row"]
    for index in range(121):
        sensor_time = 1000.0 + index * 0.01
        app_time = index * 0.01 + 0.004 + (0.002 if index % 10 == 0 else 0.0)
        acceleration_time = sensor_time
        if duplicate_accelerometer_time and index == 50:
            acceleration_time -= 0.01
        dynamic = 1.2 if index % 40 in {10, 11, 12} else 0.0
        lines.append(
            f"ACCE;{app_time:.6f};{acceleration_time:.6f};{dynamic:.6f};0.0;9.80665;3"
        )
        lines.append(
            f"GYRO;{app_time + 0.001:.6f};{sensor_time:.6f};0.0;0.0;0.02;3"
        )
        if index % 2 == 0:
            lines.append(
                f"MAGN;{app_time + 0.002:.6f};{sensor_time:.6f};25.0;5.0;40.0;3"
            )
    lines.extend(
        (
            "AHRS;0.5;1000.5;1;2;3;0;0;0;3",
            "POSI;0.5;1;40.0;-8.0;1;1",
            "GNSS;0.5;1000.5;40.0;-8.0;0.0;90.0;5.0;1.0;8;6",
            "IMUX;0.5;1000.5;1;0;0;9.8;0;0;0;20;0;40;0;0;0;1;0;0;0;1000;20",
        )
    )
    if malformed:
        lines.append("ACCE;bad;row")
    return "\n".join(lines) + "\n"


class IPINAdapterTests(unittest.TestCase):
    def parse(self, content: str):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        path = Path(directory.name) / "fixture.txt"
        path.write_text(content, encoding="utf-8")
        return parse_ipin_log(path)

    def test_parser_counts_but_never_admits_reference_records(self) -> None:
        raw = self.parse(synthetic_log())
        summary = preflight_summary(raw)
        self.assertEqual(summary["malformed_eligible_rows"], 0)
        self.assertEqual(summary["record_counts"]["ACCE"], 121)
        self.assertEqual(summary["record_counts"]["GYRO"], 121)
        self.assertEqual(summary["record_counts"]["MAGN"], 61)
        self.assertEqual(summary["admitted_record_types"], ["ACCE", "GYRO", "MAGN"])
        for record_type in ("AHRS", "POSI", "GNSS", "IMUX"):
            self.assertEqual(summary["excluded_record_counts"][record_type], 1)
        self.assertEqual(
            {event.record_type for event in raw.events}, {"ACCE", "GYRO", "MAGN"}
        )

    def test_adapter_maps_only_android_raw_fields_at_frozen_rates(self) -> None:
        raw = self.parse(synthetic_log())
        sessions = {
            rate: build_normalized_session(raw, session_id="fixture", target_rate_hz=rate)
            for rate in (50, 100)
        }
        for rate, session in sessions.items():
            validate_session(session)
            self.assertEqual(session.capability_profile, "imu6")
            self.assertEqual(
                {sample.sensor_type for sample in session.samples},
                {
                    "TYPE_ACCELEROMETER",
                    "TYPE_GYROSCOPE",
                    "TYPE_MAGNETIC_FIELD",
                },
            )
            self.assertTrue(
                all(
                    sample.callback_timestamp_ns >= sample.sensor_timestamp_ns
                    for sample in session.samples
                )
            )
            accelerometer_count = sum(
                sample.sensor_type == "TYPE_ACCELEROMETER"
                for sample in session.samples
            )
            self.assertGreater(accelerometer_count, rate)

    def test_callback_batching_and_magnet_removal_preserve_valid_session(self) -> None:
        raw = self.parse(synthetic_log())
        session = build_normalized_session(raw, session_id="fixture", target_rate_hz=100)
        batched = with_callback_batches(session)
        no_magnet = without_sensor(session, "TYPE_MAGNETIC_FIELD")
        validate_session(batched)
        validate_session(no_magnet)
        self.assertEqual(
            [(sample.sensor_timestamp_ns, sample.values) for sample in session.samples],
            [(sample.sensor_timestamp_ns, sample.values) for sample in batched.samples],
        )
        self.assertEqual(
            {sample.sensor_type for sample in no_magnet.samples},
            {"TYPE_ACCELEROMETER", "TYPE_GYROSCOPE"},
        )

    def test_gap_transform_is_explicit(self) -> None:
        raw = self.parse(synthetic_log())
        session = build_normalized_session(raw, session_id="fixture", target_rate_hz=100)
        baseline = stream_gap_count(session, "TYPE_ACCELEROMETER")
        gapped = with_gap(session, start_ns=400_000_000, end_ns=1_000_000_000)
        validate_session(gapped)
        self.assertGreater(stream_gap_count(gapped, "TYPE_ACCELEROMETER"), baseline)

    def test_nonpositive_sensor_time_is_rejected(self) -> None:
        raw = self.parse(synthetic_log(duplicate_accelerometer_time=True))
        summary = preflight_summary(raw)
        self.assertLess(
            summary["streams"]["TYPE_ACCELEROMETER"][
                "positive_sensor_delta_fraction"
            ],
            1.0,
        )
        with self.assertRaisesRegex(ValueError, "Nonpositive"):
            build_normalized_session(raw, session_id="fixture", target_rate_hz=100)

    def test_malformed_eligible_row_is_rejected(self) -> None:
        raw = self.parse(synthetic_log(malformed=True))
        self.assertEqual(raw.malformed_eligible_rows, 1)
        with self.assertRaisesRegex(ValueError, "Malformed"):
            build_normalized_session(raw, session_id="fixture", target_rate_hz=100)

    def test_invalid_target_rate_is_rejected(self) -> None:
        raw = self.parse(synthetic_log())
        with self.assertRaisesRegex(ValueError, "50 or 100"):
            build_normalized_session(raw, session_id="fixture", target_rate_hz=200)

    def test_missing_required_stream_is_rejected(self) -> None:
        content = "\n".join(
            line for line in synthetic_log().splitlines() if not line.startswith("GYRO;")
        )
        raw = self.parse(content + "\n")
        with self.assertRaisesRegex(ValueError, "Required IPIN stream is missing"):
            build_normalized_session(raw, session_id="fixture", target_rate_hz=100)


if __name__ == "__main__":
    unittest.main()
