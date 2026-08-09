from __future__ import annotations

import json
from pathlib import Path
import sys
import unittest


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from pdr_research.training_data_gate import (  # noqa: E402
    assert_no_label_leakage,
    computed_classification,
    validate_manifest,
)


class TrainingDataGateTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        path = ROOT / "datasets" / "manifests" / "learned-training-data-v1.json"
        cls.manifest = json.loads(path.read_text(encoding="utf-8"))
        cls.by_id = {item["id"]: item for item in cls.manifest["candidates"]}

    def test_manifest_is_internally_valid(self) -> None:
        self.assertEqual(validate_manifest(self.manifest), [])

    def test_no_public_source_passes_product_training_gate(self) -> None:
        self.assertEqual(self.manifest["product_training_compatible_candidates"], [])
        self.assertEqual(self.manifest["decision"], "stop-product-oriented-training")

    def test_classification_is_computed_not_asserted(self) -> None:
        for candidate in self.manifest["candidates"]:
            self.assertEqual(candidate["classification"], computed_classification(candidate))

    def test_unknown_rights_are_rejected(self) -> None:
        unresolved = {
            candidate["id"]
            for candidate in self.manifest["candidates"]
            if candidate["gate"]["rights"]["state"] == "unknown"
        }
        self.assertEqual(unresolved, {"ridi", "oxiod", "fda-wearables", "rudacop"})
        for candidate_id in unresolved:
            self.assertEqual(self.by_id[candidate_id]["classification"], "reject-unresolved")

    def test_open_or_downloadable_does_not_imply_product_rights(self) -> None:
        self.assertEqual(self.by_id["advio"]["gate"]["rights"]["state"], "fail")
        self.assertEqual(self.by_id["ronin"]["gate"]["rights"]["state"], "fail")
        self.assertEqual(self.by_id["rudacop"]["gate"]["rights"]["state"], "unknown")

    def test_dryad_is_only_an_auxiliary_distance_and_gap_source(self) -> None:
        candidate = self.by_id["dryad-walking"]
        self.assertEqual(candidate["classification"], "auxiliary-only")
        self.assertEqual(candidate["gate"]["target_fitness"]["state"], "fail")
        self.assertEqual(candidate["gate"]["rights"]["state"], "pass")

    def test_iphone_or_pose_fields_never_enter_inference(self) -> None:
        for candidate in self.manifest["candidates"]:
            assert_no_label_leakage(candidate, candidate["inference_features"])
            for field in candidate["fields"]:
                if field["role"] in {"training-label", "evaluation-only", "forbidden"}:
                    with self.assertRaises(ValueError):
                        assert_no_label_leakage(candidate, [field["name"]])

    def test_every_live_field_maps_to_an_android_api(self) -> None:
        for candidate in self.manifest["candidates"]:
            for field in candidate["fields"]:
                if field["role"] in {"live-input", "post-session-input"}:
                    self.assertTrue(field["android_api"])


if __name__ == "__main__":
    unittest.main()
