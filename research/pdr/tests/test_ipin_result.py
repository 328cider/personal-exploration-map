from __future__ import annotations

import hashlib
import json
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
MANIFEST = (
    ROOT / "datasets" / "manifests" / "ipin-classical-result-v1.json"
)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


class IPINResultTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.result = json.loads(MANIFEST.read_text(encoding="utf-8"))

    def test_frozen_artifact_hashes_are_complete(self) -> None:
        self.assertEqual(
            self.result["protocol_sha256"],
            sha256_file(ROOT / "IPIN_CLASSICAL_PROTOCOL.md"),
        )
        self.assertEqual(
            self.result["preregistration_sha256"],
            sha256_file(
                ROOT
                / "datasets"
                / "manifests"
                / "ipin-classical-preregistration-v1.json"
            ),
        )
        self.assertEqual(
            self.result["development_freeze_sha256"],
            sha256_file(
                ROOT
                / "datasets"
                / "manifests"
                / "ipin-classical-development-v1.json"
            ),
        )
        for relative_path, expected in self.result["implementation_sha256"].items():
            self.assertNotEqual(expected, "PENDING")
            self.assertEqual(expected, sha256_file(ROOT / relative_path))
        self.assertNotEqual(self.result["notebook"]["sha256"], "PENDING")
        self.assertEqual(
            self.result["notebook"]["sha256"],
            sha256_file(ROOT / self.result["notebook"]["path"]),
        )

    def test_different_user_validation_and_optional_magnet_are_explicit(self) -> None:
        development = [
            sequence
            for sequence in self.result["sequences"]
            if sequence["phase"] == "development"
        ]
        validation = [
            sequence
            for sequence in self.result["sequences"]
            if sequence["phase"] == "validation"
        ]
        self.assertEqual(len(development), 2)
        self.assertEqual(len(validation), 2)
        self.assertTrue(
            {sequence["user"] for sequence in development}.isdisjoint(
                {sequence["user"] for sequence in validation}
            )
        )
        self.assertTrue(all(sequence["magnetometer_present"] for sequence in development))
        self.assertTrue(
            all(not sequence["magnetometer_present"] for sequence in validation)
        )
        self.assertTrue(all(sequence["raw_gate_passed"] for sequence in self.result["sequences"]))
        self.assertTrue(all(sequence["replay_gate_passed"] for sequence in self.result["sequences"]))

    def test_aggregate_replay_bounds_are_bounded_not_accuracy_claims(self) -> None:
        aggregate = self.result["aggregate"]
        self.assertEqual(aggregate["raw_gate_pass_count"], 4)
        self.assertEqual(aggregate["replay_gate_pass_count"], 4)
        self.assertEqual(aggregate["callback_batch_invariant_count"], 8)
        self.assertEqual(aggregate["magnetometer_removal_invariant_count"], 8)
        self.assertEqual(aggregate["gap_stress_pass_count"], 8)
        self.assertEqual(aggregate["future_sample_violations"], 0)
        self.assertLessEqual(
            aggregate["maximum_validation_step_count_relative_difference"], 0.02
        )
        self.assertLessEqual(
            aggregate["maximum_validation_amplitude_relative_difference"], 0.03
        )
        self.assertLessEqual(
            aggregate["maximum_validation_distance_relative_difference"], 0.03
        )
        self.assertLessEqual(
            aggregate[
                "maximum_validation_endpoint_separation_over_longer_distance"
            ],
            0.05,
        )
        self.assertFalse(self.result["accuracy_claim_allowed"])
        self.assertFalse(self.result["product_adoption_allowed"])
        self.assertFalse(self.result["personal_pilot_allowed"])

    def test_android_input_contract_excludes_truth_and_platform_pose(self) -> None:
        contract = self.result["input_contract"]
        self.assertEqual(contract["required_records"], ["ACCE", "GYRO"])
        self.assertEqual(contract["optional_records"], ["MAGN"])
        self.assertFalse(contract["magnetometer_used_by_estimator"])
        self.assertFalse(contract["ground_truth_available_to_estimator"])
        self.assertIn("AHRS", contract["forbidden_records"])
        self.assertIn("POSI", contract["forbidden_records"])
        self.assertIn("GNSS", contract["forbidden_records"])
        self.assertEqual(self.result["execution_control"]["ground_truth_rows_loaded"], 0)
        self.assertEqual(self.result["execution_control"]["platform_ahrs_rows_used"], 0)
        self.assertEqual(self.result["execution_control"]["model_weights_loaded"], 0)


if __name__ == "__main__":
    unittest.main()
