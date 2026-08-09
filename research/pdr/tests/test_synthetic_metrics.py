from __future__ import annotations

from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from pdr_research.compatibility import validate_session  # noqa: E402
from pdr_research.metrics import evaluate_trajectory  # noqa: E402
from pdr_research.synthetic import (  # noqa: E402
    downsample_session,
    generate_fixture,
    transform_truth,
)


class SyntheticFoundationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.fixture = generate_fixture(route="rectangle", seed=19)

    def evaluate(self, estimate):
        return evaluate_trajectory(
            session_id=self.fixture.session.session_id,
            truth=self.fixture.ground_truth,
            estimate_xy=estimate,
            estimator="golden-transform",
            estimator_version="1",
            capability_profile="imu6",
            seed=19,
            dataset_hash=self.fixture.dataset_hash,
        )

    def test_raw_samples_do_not_contain_ground_truth_fields(self) -> None:
        forbidden = {"x_m", "y_m", "body_heading_rad", "stride_m"}
        self.assertTrue(forbidden.isdisjoint(self.fixture.session.samples[0].__dataclass_fields__))
        self.assertIsNotNone(self.fixture.ground_truth[0].body_heading_rad)

    def test_50_and_100_hz_replay_validate(self) -> None:
        validate_session(self.fixture.session)
        at_50 = downsample_session(self.fixture.session, source_rate_hz=100, target_rate_hz=50)
        validate_session(at_50)
        self.assertLess(len(at_50.samples), len(self.fixture.session.samples))

    def test_batch_gap_jitter_and_magnetic_anomaly_are_replayable(self) -> None:
        fixture = generate_fixture(
            route="straight",
            seed=3,
            batch_latency_ms=250,
            gaps=((2.0, 2.6),),
            timestamp_jitter_us=500,
            include_magnetometer=True,
            magnetic_anomaly=(4.0, 5.0),
            device_yaw_changes=((6.0, 90.0),),
        )
        validate_session(fixture.session)
        delayed = [
            sample
            for sample in fixture.session.samples
            if sample.callback_timestamp_ns > sample.sensor_timestamp_ns
        ]
        self.assertTrue(delayed)
        magnetic = [sample for sample in fixture.session.samples if sample.sensor_type == "TYPE_MAGNETIC_FIELD"]
        self.assertGreater(max(abs(value) for sample in magnetic for value in sample.values), 80.0)
        gyroscope = [sample for sample in fixture.session.samples if sample.sensor_type == "TYPE_GYROSCOPE"]
        self.assertGreater(max(abs(sample.values[2]) for sample in gyroscope), 1.0)

    def test_perfect_track_has_no_failure(self) -> None:
        result = self.evaluate(transform_truth(self.fixture.ground_truth))
        self.assertEqual(result.failure_flags, ())
        self.assertAlmostEqual(result.metrics["distance_scale_error"], 0.0, places=9)

    def test_distance_multiplier_is_measured(self) -> None:
        result = self.evaluate(transform_truth(self.fixture.ground_truth, scale=1.15))
        self.assertAlmostEqual(result.metrics["distance_scale_error"], 0.15, places=3)

    def test_ninety_degree_rotation_is_not_hidden_by_shape_alignment(self) -> None:
        result = self.evaluate(transform_truth(self.fixture.ground_truth, rotation_deg=90.0))
        self.assertIn("catastrophic-rotation", result.failure_flags)
        self.assertAlmostEqual(result.metrics["origin_heading_error_deg"], 90.0, places=3)

    def test_mirror_is_catastrophic(self) -> None:
        result = self.evaluate(transform_truth(self.fixture.ground_truth, mirror_x=True))
        self.assertIn("catastrophic-mirror", result.failure_flags)
        self.assertFalse(result.metrics["topology_correct"])

    def test_false_self_intersection_is_detected(self) -> None:
        truth = self.fixture.ground_truth
        estimate = list(transform_truth(truth))
        one_third = len(estimate) // 3
        two_thirds = 2 * len(estimate) // 3
        estimate[one_third], estimate[two_thirds] = estimate[two_thirds], estimate[one_third]
        result = self.evaluate(tuple(estimate))
        self.assertIn("false-self-intersection", result.failure_flags)

    def test_false_loop_closure_is_detected(self) -> None:
        fixture = generate_fixture(route="straight", seed=19)
        count = len(fixture.ground_truth)
        estimate = tuple(
            (100.0 * (index / (count // 2)), 0.0)
            if index <= count // 2
            else (100.0 * ((count - 1 - index) / (count - 1 - count // 2)), 0.0)
            for index in range(count)
        )
        result = evaluate_trajectory(
            session_id=fixture.session.session_id,
            truth=fixture.ground_truth,
            estimate_xy=estimate,
            estimator="golden-false-loop",
            estimator_version="1",
            capability_profile="imu6",
            seed=19,
            dataset_hash=fixture.dataset_hash,
        )
        self.assertIn("false-loop-closure", result.failure_flags)
        self.assertFalse(result.metrics["topology_correct"])


if __name__ == "__main__":
    unittest.main()
