from __future__ import annotations

import copy
import json
from pathlib import Path
import sys
import unittest


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from pdr_research.evidence_unblocker import (  # noqa: E402
    assert_no_label_leakage,
    computed_classification,
    validate_manifest,
)


class EvidenceUnblockerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        path = ROOT / "datasets" / "manifests" / "evidence-unblocker-v2.json"
        cls.manifest = json.loads(path.read_text(encoding="utf-8"))
        cls.by_id = {item["id"]: item for item in cls.manifest["candidates"]}

    def test_manifest_is_internally_valid(self) -> None:
        self.assertEqual(validate_manifest(self.manifest), [])

    def test_zero_training_sources_preserves_stop(self) -> None:
        self.assertEqual(self.manifest["training_compatible_candidates"], [])
        self.assertEqual(self.manifest["training_decision"], "stop-product-oriented-training")
        self.assertEqual(self.manifest["next_action"], "preregister-classical-benchmark-only")

    def test_classifications_are_recomputed(self) -> None:
        for candidate in self.manifest["candidates"]:
            self.assertEqual(candidate["classification"], computed_classification(candidate))

    def test_unknown_rights_override_technical_promises(self) -> None:
        unresolved = {
            candidate["id"]
            for candidate in self.manifest["candidates"]
            if candidate["gate"]["rights"]["state"] == "unknown"
        }
        self.assertEqual(
            unresolved,
            {"xdr-2023", "wang-sle", "wang-wde", "forestback", "el-sle"},
        )
        for candidate_id in unresolved:
            self.assertEqual(self.by_id[candidate_id]["classification"], "reject-unresolved")

    def test_only_ipin_survives_as_product_input_benchmark(self) -> None:
        self.assertEqual(
            self.manifest["benchmark_only_candidates"],
            ["ipin-2022-t3", "ipin-2023-2024-t3"],
        )
        for candidate_id in self.manifest["benchmark_only_candidates"]:
            candidate = self.by_id[candidate_id]
            self.assertEqual(candidate["gate"]["android_inputs"]["state"], "pass")
            self.assertEqual(candidate["gate"]["raw_semantics"]["state"], "pass")
            self.assertEqual(candidate["gate"]["rights"]["state"], "pass")
            self.assertEqual(candidate["gate"]["target_supervision"]["state"], "fail")

    def test_duplicate_ipin_lineage_counts_once(self) -> None:
        checks = self.manifest["cross_source_checks"]
        self.assertTrue(checks["ipin_2023_2024_training_members_byte_identical"])
        self.assertTrue(checks["duplicate_lineage_counted_as_one_candidate"])
        self.assertEqual(checks["ipin_2023_training_count"], 54)
        self.assertEqual(checks["ipin_2024_training_count"], 54)

    def test_all_non_input_fields_are_rejected_from_features(self) -> None:
        for candidate in self.manifest["candidates"]:
            assert_no_label_leakage(candidate, candidate["inference_features"])
            for field in candidate["fields"]:
                if field["role"] in {"training-label", "evaluation-only", "forbidden"}:
                    with self.assertRaises(ValueError):
                        assert_no_label_leakage(candidate, [field["name"]])

    def test_every_eligible_input_has_android_mapping(self) -> None:
        for candidate in self.manifest["candidates"]:
            for field in candidate["fields"]:
                if field["role"] in {"live-input", "post-session-input"}:
                    self.assertTrue(field["android_api"])
                else:
                    self.assertIsNone(field["android_api"])

    def test_validator_detects_label_leakage(self) -> None:
        mutated = copy.deepcopy(self.by_id["xdr-2023"])
        mutated["inference_features"].append("lidar_orientation_quaternion")
        errors = validate_manifest(
            {
                **self.manifest,
                "candidates": [mutated, *self.manifest["candidates"][3:]],
                "classification_counts": self.manifest["classification_counts"],
                "training_compatible_candidates": [],
                "benchmark_only_candidates": [],
            }
        )
        self.assertTrue(any("label leakage" in error for error in errors))

    def test_paper_without_artifact_is_not_an_input_contract(self) -> None:
        for candidate_id in ("forestback", "el-sle"):
            candidate = self.by_id[candidate_id]
            self.assertEqual(candidate["inference_features"], [])
            self.assertEqual(candidate["gate"]["provenance"]["state"], "fail")


if __name__ == "__main__":
    unittest.main()
