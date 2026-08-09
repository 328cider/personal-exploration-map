from __future__ import annotations

from pathlib import Path
from dataclasses import replace
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from pdr_research.benchmark import (  # noqa: E402
    SCENARIOS,
    build_scenario_fixture,
    run_synthetic_matrix,
    summarize_records,
)
from pdr_research.compatibility import validate_estimator_output  # noqa: E402
from pdr_research.estimators import run_b0, run_b1, run_common_baselines  # noqa: E402
from pdr_research.metrics import evaluate_estimator_output  # noqa: E402
from pdr_research.synthetic import (  # noqa: E402
    drop_sensor,
    drop_time_ranges,
    generate_fixture,
    rebatch_session,
)


def complete_fixture(*, rate: int = 100, magnetic_anomaly=None):
    return generate_fixture(
        route="rectangle",
        sample_rate_hz=rate,
        seed=31,
        include_magnetometer=True,
        include_rotation_vector=True,
        include_game_rotation_vector=True,
        include_step_detector=True,
        magnetic_anomaly=magnetic_anomaly,
    )


class CommonBaselineTests(unittest.TestCase):
    def test_estimators_cannot_receive_truth(self) -> None:
        source = (ROOT / "pdr_research" / "estimators.py").read_text(encoding="utf-8")
        self.assertNotIn("ground_truth", source)
        self.assertNotIn("from .synthetic", source)

    def test_b0_rejects_missing_step_or_platform_orientation(self) -> None:
        imu6 = generate_fixture(route="straight", seed=2)
        run = run_b0(imu6.session)
        self.assertFalse(run.supported)
        self.assertIn("TYPE_STEP_DETECTOR", run.missing_requirements)
        self.assertTrue(any(item.startswith("one-of:") for item in run.missing_requirements))

    def test_b0_live_output_is_causal_and_declares_inputs(self) -> None:
        fixture = complete_fixture()
        run = run_b0(fixture.session)
        self.assertTrue(run.supported)
        self.assertEqual(run.used_sensor_types, {"TYPE_STEP_DETECTOR", "TYPE_ROTATION_VECTOR"})
        assert run.output is not None
        validate_estimator_output(run.output)
        self.assertTrue(
            all(
                point.source_end_ns <= point.timestamp_ns
                for point in run.output.points
            )
        )

    def test_b1_runs_at_50_and_100_hz_for_each_declared_profile(self) -> None:
        for rate in (50, 100):
            fixture = complete_fixture(rate=rate)
            for profile in ("imu6", "platform-fused", "step-enabled"):
                run = run_b1(fixture.session, capability_profile=profile)
                self.assertTrue(run.supported, (rate, profile, run.missing_requirements))
                assert run.output is not None
                validate_estimator_output(run.output)
                result = evaluate_estimator_output(
                    session_id=fixture.session.session_id,
                    truth=fixture.ground_truth,
                    output=run.output,
                    seed=31,
                    dataset_hash=fixture.dataset_hash,
                )
                self.assertEqual(result.metrics["future_sample_violations"], 0)
                self.assertGreater(result.metrics["output_point_count"], 10)
                self.assertGreater(result.metrics["evaluated_turn_count"], 0)

    def test_missing_optional_sensors_take_explicit_b1_fallbacks(self) -> None:
        fixture = complete_fixture()
        session = fixture.session
        for sensor_type in (
            "TYPE_STEP_DETECTOR",
            "TYPE_ROTATION_VECTOR",
            "TYPE_GAME_ROTATION_VECTOR",
            "TYPE_MAGNETIC_FIELD",
        ):
            session = drop_sensor(session, sensor_type)
        platform = run_b1(session, capability_profile="platform-fused")
        steps = run_b1(session, capability_profile="step-enabled")
        self.assertTrue(platform.supported)
        self.assertTrue(steps.supported)
        self.assertIn("gyro-heading-fallback", platform.fallback_flags)
        self.assertIn("custom-step-detector-fallback", steps.fallback_flags)

    def test_batch_delivery_does_not_change_sensor_time_estimates(self) -> None:
        fixture = complete_fixture()
        batched = rebatch_session(fixture.session, batch_latency_ms=250)
        baseline = run_common_baselines(fixture.session)
        replayed = run_common_baselines(batched)
        for left, right in zip(baseline, replayed):
            self.assertEqual(left.supported, right.supported)
            if left.output is not None and right.output is not None:
                self.assertEqual(left.output.points, right.output.points)

    def test_b1_live_prefix_does_not_change_when_future_samples_arrive(self) -> None:
        fixture = complete_fixture()
        cutoff_ns = 5_000_000_000
        prefix_samples = tuple(
            sample
            for sample in fixture.session.samples
            if sample.sensor_timestamp_ns <= cutoff_ns
        )
        prefix_session = replace(fixture.session, samples=prefix_samples)
        complete = run_b1(fixture.session, capability_profile="imu6")
        prefix = run_b1(prefix_session, capability_profile="imu6")
        assert complete.output is not None and prefix.output is not None
        prefix_live_points = prefix.output.points
        if (
            len(prefix_live_points) >= 2
            and prefix_live_points[-1].x_m == prefix_live_points[-2].x_m
            and prefix_live_points[-1].y_m == prefix_live_points[-2].y_m
        ):
            prefix_live_points = prefix_live_points[:-1]
        complete_points = {
            point.timestamp_ns: point
            for point in complete.output.points
            if point.timestamp_ns <= prefix_live_points[-1].timestamp_ns
        }
        prefix_points = {point.timestamp_ns: point for point in prefix_live_points}
        self.assertEqual(complete_points, prefix_points)

    def test_gap_is_replayed_as_increased_uncertainty(self) -> None:
        fixture = complete_fixture()
        gapped = drop_time_ranges(fixture.session, ((2.0, 2.6),))
        ideal = run_b0(fixture.session)
        degraded = run_b0(gapped)
        assert ideal.output is not None and degraded.output is not None
        self.assertGreater(
            degraded.output.points[-1].uncertainty_m,
            ideal.output.points[-1].uncertainty_m,
        )

    def test_b1_gap_penalty_is_visible_even_when_a_step_is_missed(self) -> None:
        fixture = complete_fixture(rate=50)
        gapped = drop_time_ranges(fixture.session, ((2.0, 2.6),))
        ideal = run_b1(fixture.session, capability_profile="imu6")
        degraded = run_b1(gapped, capability_profile="imu6")
        assert ideal.output is not None and degraded.output is not None
        self.assertGreater(
            degraded.output.points[-1].uncertainty_m,
            ideal.output.points[-1].uncertainty_m,
        )

    def test_magnetic_anomaly_is_rejected_not_used_as_heading(self) -> None:
        fixture = complete_fixture(magnetic_anomaly=(4.0, 5.0))
        run = run_b1(fixture.session, capability_profile="platform-fused")
        self.assertTrue(run.supported)
        self.assertIn("magnetic-field-rejected", run.fallback_flags)
        self.assertNotIn("TYPE_MAGNETIC_FIELD", run.used_sensor_types)

    def test_matrix_replays_one_fixture_to_every_estimator(self) -> None:
        scenario = SCENARIOS[0]
        fixture = build_scenario_fixture(
            route="straight", sample_rate_hz=50, seed=23, scenario=scenario
        )
        before = fixture.session.samples
        runs = run_common_baselines(fixture.session)
        self.assertEqual(len(runs), 4)
        self.assertEqual(fixture.session.samples, before)
        self.assertEqual(
            {run.requirement.required_capability_profile for run in runs},
            {"imu6", "platform-fused", "step-enabled"},
        )

    def test_synthetic_summary_cannot_claim_go_narrow_or_stop(self) -> None:
        records = run_synthetic_matrix(
            routes=("straight",),
            rates_hz=(50, 100),
            scenarios=(SCENARIOS[0], SCENARIOS[3]),
            seed=23,
        )
        summaries = summarize_records(records)
        self.assertTrue(summaries)
        self.assertTrue(
            all(
                summary["evidence_decision"] == "pipeline-only-not-go-narrow-stop"
                for summary in summaries
            )
        )
        b0_imu6_only = [
            record
            for record in records
            if record.estimator.startswith("B0") and record.scenario == "imu6-only"
        ]
        self.assertTrue(b0_imu6_only)
        self.assertTrue(all(not record.supported for record in b0_imu6_only))


if __name__ == "__main__":
    unittest.main()
