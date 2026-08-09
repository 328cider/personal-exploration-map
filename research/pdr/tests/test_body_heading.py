from __future__ import annotations

from dataclasses import replace
import json
import math
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from pdr_research.body_heading import (  # noqa: E402
    CANDIDATE_CONFIGS,
    BodyHeadingConfig,
    _device_to_reference,
    estimate_body_heading,
    estimate_device_heading_baseline,
    get_body_heading_config,
)
from pdr_research.body_heading_evaluation import (  # noqa: E402
    compare_heading_rates,
    evaluate_body_heading,
)
from pdr_research.contracts import (  # noqa: E402
    NormalizedSensorSession,
    SensorMetadata,
    SensorSample,
)
from pdr_research.synthetic import TruthPoint, rebatch_session  # noqa: E402


def _body_heading(time_s: float) -> float:
    if time_s < 6.0:
        return 0.0
    if time_s < 9.0:
        return (time_s - 6.0) / 3.0 * math.pi / 2.0
    return math.pi / 2.0


def _phone_yaw(time_s: float) -> float:
    return 0.85 * math.sin(0.63 * time_s) + (0.75 if time_s >= 10.0 else 0.0)


def heading_session(
    rate_hz: int, *, duration_s: float = 18.0
) -> tuple[NormalizedSensorSession, tuple[TruthPoint, ...]]:
    samples: list[SensorSample] = []
    sequence_id = 0
    for index in range(round(duration_s * rate_hz) + 1):
        time_s = index / rate_hz
        timestamp_ns = round(time_s * 1_000_000_000)
        heading = _body_heading(time_s)
        phase = 2.0 * math.pi * 1.8 * time_s
        forward = 1.45 * math.sin(phase) + 0.18 * math.sin(2.0 * phase)
        lateral = 0.12 * math.sin(phase + 0.7)
        world_x = forward * math.cos(heading) - lateral * math.sin(heading)
        world_y = forward * math.sin(heading) + lateral * math.cos(heading)
        yaw = _phone_yaw(time_s)
        cosine = math.cos(yaw)
        sine = math.sin(yaw)
        device_x = cosine * world_x + sine * world_y
        device_y = -sine * world_x + cosine * world_y
        samples.append(
            SensorSample(
                sensor_type="TYPE_ACCELEROMETER",
                sensor_timestamp_ns=timestamp_ns,
                callback_timestamp_ns=timestamp_ns,
                values=(device_x, device_y, 9.80665),
                accuracy=3,
                sequence_id=sequence_id,
                batch_id=sequence_id,
            )
        )
        sequence_id += 1
    orientation_count = round(duration_s * 50) + 1
    for index in range(orientation_count):
        time_s = index / 50
        timestamp_ns = round(time_s * 1_000_000_000)
        yaw = _phone_yaw(time_s)
        samples.append(
            SensorSample(
                sensor_type="TYPE_GAME_ROTATION_VECTOR",
                sensor_timestamp_ns=timestamp_ns,
                callback_timestamp_ns=timestamp_ns,
                values=(0.0, 0.0, math.sin(yaw / 2.0), math.cos(yaw / 2.0)),
                accuracy=3,
                sequence_id=sequence_id,
                batch_id=sequence_id,
            )
        )
        sequence_id += 1
    samples.sort(key=lambda sample: (sample.sensor_timestamp_ns, sample.sensor_type))
    metadata = tuple(
        SensorMetadata(
            sensor_type=sensor_type,
            android_api="android.hardware.SensorEvent.values",
            vendor="analytic",
            version=1,
            resolution=0.001,
            maximum_range=40.0,
            power_ma=0.1,
            min_delay_us=20_000 if sensor_type.endswith("ROTATION_VECTOR") else round(1_000_000 / rate_hz),
            max_delay_us=0,
            fifo_reserved_count=0,
            fifo_max_count=0,
            is_wake_up=False,
            reporting_mode="continuous",
        )
        for sensor_type in ("TYPE_ACCELEROMETER", "TYPE_GAME_ROTATION_VECTOR")
    )
    session = NormalizedSensorSession(
        session_id=f"heading-analytic-{rate_hz}hz",
        capability_profile="platform-fused",
        sensor_metadata=metadata,
        samples=tuple(samples),
        provenance={"kind": "analytic-heading-test"},
    )
    x_m = 0.0
    y_m = 0.0
    truth = []
    for index in range(round(duration_s * 10) + 1):
        time_s = index / 10
        heading = _body_heading(time_s)
        if truth:
            x_m += 0.1 * math.cos(heading)
            y_m += 0.1 * math.sin(heading)
        truth.append(
            TruthPoint(
                timestamp_ns=round(time_s * 1_000_000_000),
                x_m=x_m,
                y_m=y_m,
                body_heading_rad=heading,
                stride_m=0.0,
            )
        )
    return session, tuple(truth)


def analytic_config() -> BodyHeadingConfig:
    return get_body_heading_config("bhpca-w1000-u-s250-a15")


class BodyHeadingTests(unittest.TestCase):
    def test_registered_grid_is_complete_and_unique(self) -> None:
        self.assertEqual(len(CANDIDATE_CONFIGS), 90)
        ids = [config.config_id for config in CANDIDATE_CONFIGS]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertEqual(
            {config.window_s for config in CANDIDATE_CONFIGS},
            {1.0, 1.5, 2.0, 3.0, 5.0},
        )

    def test_android_rotation_matrix_maps_device_to_reference(self) -> None:
        yaw = math.pi / 2.0
        rotated = _device_to_reference(
            (1.0, 0.0, 0.0),
            (0.0, 0.0, math.sin(yaw / 2.0), math.cos(yaw / 2.0)),
        )
        self.assertAlmostEqual(rotated[0], 0.0, places=12)
        self.assertAlmostEqual(rotated[1], 1.0, places=12)
        self.assertAlmostEqual(rotated[2], 0.0, places=12)

    def test_pca_tracks_body_turn_despite_arbitrary_phone_yaw(self) -> None:
        session, truth = heading_session(100)
        pca = estimate_body_heading(session, config=analytic_config())
        device = estimate_device_heading_baseline(session)
        self.assertTrue(pca.supported)
        self.assertTrue(device.supported)
        pca_eval = evaluate_body_heading(
            session_id=session.session_id,
            truth=truth,
            run=pca,
            session_start_ns=0,
        )
        device_eval = evaluate_body_heading(
            session_id=session.session_id,
            truth=truth,
            run=device,
            session_start_ns=0,
        )
        self.assertLess(pca_eval.metrics["heading_mae_deg"], 20.0)
        self.assertLess(
            pca_eval.metrics["heading_mae_deg"],
            device_eval.metrics["heading_mae_deg"],
        )

    def test_analytic_50_and_100_hz_outputs_are_rate_stable(self) -> None:
        at_50, _ = heading_session(50)
        at_100, _ = heading_session(100)
        comparison = compare_heading_rates(
            estimate_body_heading(at_50, config=analytic_config()),
            estimate_body_heading(at_100, config=analytic_config()),
        )
        self.assertGreater(comparison.matched_output_count, 100)
        self.assertLess(comparison.median_disagreement_deg, 0.5)
        self.assertLess(comparison.p95_disagreement_deg, 2.0)

    def test_callback_batching_is_invariant(self) -> None:
        session, _ = heading_session(100)
        batched = rebatch_session(session, batch_latency_ms=250)
        self.assertEqual(
            estimate_body_heading(session, config=analytic_config()),
            estimate_body_heading(batched, config=analytic_config()),
        )

    def test_prefix_cannot_change_published_points(self) -> None:
        session, _ = heading_session(100)
        cutoff_ns = 12_345_000_000
        prefix = replace(
            session,
            samples=tuple(
                sample
                for sample in session.samples
                if sample.sensor_timestamp_ns <= cutoff_ns
            ),
        )
        complete = estimate_body_heading(session, config=analytic_config())
        partial = estimate_body_heading(prefix, config=analytic_config())
        self.assertTrue(partial.points)
        self.assertEqual(
            tuple(
                point
                for point in complete.points
                if point.timestamp_ns <= partial.points[-1].timestamp_ns
            ),
            partial.points,
        )
        self.assertTrue(
            all(point.source_end_ns <= point.timestamp_ns for point in complete.points)
        )

    def test_gap_clears_window_and_suppresses_rewarm_outputs(self) -> None:
        session, _ = heading_session(100)
        gapped = replace(
            session,
            samples=tuple(
                sample
                for sample in session.samples
                if not 8_000_000_000 <= sample.sensor_timestamp_ns < 8_700_000_000
            ),
        )
        run = estimate_body_heading(gapped, config=analytic_config())
        self.assertTrue(run.supported)
        self.assertFalse(
            any(8_500_000_000 <= point.timestamp_ns < 9_500_000_000 for point in run.points)
        )
        self.assertFalse(
            any(
                point.timestamp_ns >= 9_500_000_000
                and point.source_start_ns < 8_700_000_000
                for point in run.points
            )
        )

    def test_missing_platform_orientation_is_explicitly_unsupported(self) -> None:
        session, _ = heading_session(50)
        without_orientation = replace(
            session,
            samples=tuple(
                sample
                for sample in session.samples
                if sample.sensor_type != "TYPE_GAME_ROTATION_VECTOR"
            ),
        )
        run = estimate_body_heading(without_orientation, config=analytic_config())
        self.assertFalse(run.supported)
        self.assertEqual(run.missing_requirements, ("TYPE_GAME_ROTATION_VECTOR",))

    def test_unknown_config_is_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "Unknown body-heading config"):
            get_body_heading_config("not-registered")

    def test_preregistered_split_is_disjoint_and_validation_unfetched(self) -> None:
        split = json.loads(
            (ROOT / "datasets" / "splits" / "ronin-body-heading-v1.json").read_text(
                encoding="utf-8"
            )
        )
        development = {
            item["subject_key"] for item in split["development_assignments"]
        }
        validation = {
            item["subject_key"] for item in split["validation_assignments"]
        }
        self.assertFalse(development & validation)
        self.assertEqual(len(validation), len(split["validation_assignments"]))
        self.assertTrue(
            all(
                item["raw_state_at_registration"] == "not-fetched"
                for item in split["validation_assignments"]
            )
        )

    def test_estimator_source_has_no_truth_dependency(self) -> None:
        source = (ROOT / "pdr_research" / "body_heading.py").read_text(
            encoding="utf-8"
        )
        self.assertNotIn("ground_truth", source)
        self.assertNotIn("from .synthetic", source)
        self.assertNotIn("tango", source.lower())


if __name__ == "__main__":
    unittest.main()
