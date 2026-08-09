from __future__ import annotations

from dataclasses import replace
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from pdr_research.compatibility import (  # noqa: E402
    audit_report,
    computed_decision,
    validate_estimator_output,
    validate_inference_fields,
    validate_session,
)
from pdr_research.contracts import (  # noqa: E402
    CompatibilityDecision,
    EstimatePoint,
    EstimatorOutput,
)
from pdr_research.registry import load_registry  # noqa: E402
from pdr_research.synthetic import drop_sensor, generate_fixture  # noqa: E402


class CompatibilityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.reports = load_registry(ROOT / "datasets" / "registry.json")

    def test_initial_public_datasets_stay_benchmark_only(self) -> None:
        self.assertEqual({report.dataset for report in self.reports}, {"RoNIN", "OxIOD", "RIDI"})
        for report in self.reports:
            self.assertEqual(computed_decision(report), CompatibilityDecision.BENCHMARK_ONLY)

    def test_product_rights_are_explicit_for_every_initial_dataset(self) -> None:
        for report in self.reports:
            codes = {finding.code for finding in audit_report(report)}
            if report.dataset == "RoNIN":
                self.assertIn("prohibited", report.product_license.lower())
                self.assertNotIn("product-license-unresolved", codes)
            else:
                self.assertIn("product-license-unresolved", codes)

    def test_training_and_evaluation_fields_cannot_leak_into_live_input(self) -> None:
        ronin = next(report for report in self.reports if report.dataset == "RoNIN")
        validate_inference_fields(ronin, {"raw_accelerometer", "raw_gyroscope"}, live=True)
        with self.assertRaisesRegex(ValueError, "true_body_heading"):
            validate_inference_fields(ronin, {"raw_accelerometer", "true_body_heading"}, live=True)
        with self.assertRaisesRegex(ValueError, "tango_pose"):
            validate_inference_fields(ronin, {"tango_pose"}, live=False)

    def test_iphone_fused_attitude_is_forbidden(self) -> None:
        oxiod = next(report for report in self.reports if report.dataset == "OxIOD")
        with self.assertRaisesRegex(ValueError, "core_motion_attitude"):
            validate_inference_fields(oxiod, {"core_motion_attitude"}, live=True)

    def test_missing_required_sensor_is_not_silent_degradation(self) -> None:
        fixture = generate_fixture()
        validate_session(fixture.session)
        without_gyro = drop_sensor(fixture.session, "TYPE_GYROSCOPE")
        with self.assertRaisesRegex(ValueError, "TYPE_GYROSCOPE"):
            validate_session(without_gyro)

    def test_live_output_cannot_use_future_samples(self) -> None:
        point = EstimatePoint(
            timestamp_ns=10,
            x_m=0.0,
            y_m=0.0,
            heading_rad=0.0,
            uncertainty_m=1.0,
            source_start_ns=0,
            source_end_ns=11,
        )
        output = EstimatorOutput("b1", "0", "imu6", "local-origin", "live", (point,))
        with self.assertRaisesRegex(ValueError, "future"):
            validate_estimator_output(output)
        validate_estimator_output(replace(output, mode="post-session"))


if __name__ == "__main__":
    unittest.main()
