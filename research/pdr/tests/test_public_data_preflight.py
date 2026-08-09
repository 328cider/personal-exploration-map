from __future__ import annotations

import csv
import json
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from pdr_research.contracts import CompatibilityDecision  # noqa: E402
from pdr_research.model_registry import audit_model_registry, load_model_registry  # noqa: E402
from pdr_research.preflight import (  # noqa: E402
    adapter_roles_by_dataset,
    audit_csv_sequence,
    audit_hdf_inventory,
    load_adapter_specs,
    validate_adapter_specs,
)


class PublicDataPreflightTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.specs = load_adapter_specs(ROOT / "datasets" / "adapter_specs.json")

    def test_adapter_allowlists_are_complete_and_leak_free(self) -> None:
        self.assertEqual(validate_adapter_specs(self.specs), ())
        self.assertEqual(
            set(self.specs),
            {
                "ronin-hdf5-v1",
                "ronin-raw-hdf5-v1",
                "ridi-processed-csv-v1",
                "oxiod-synced-csv-v1",
            },
        )

    def test_public_models_remain_benchmark_only(self) -> None:
        models = load_model_registry(ROOT / "models" / "registry.json")
        roles = adapter_roles_by_dataset(self.specs)
        self.assertEqual(audit_model_registry(models, roles), ())
        self.assertTrue(models)
        self.assertTrue(
            all(model.declared_decision is CompatibilityDecision.BENCHMARK_ONLY for model in models)
        )
        oxiod = next(model for model in models if model.dataset == "OxIOD")
        self.assertIn("user_acc_x(G)", oxiod.required_inputs)
        self.assertNotIn("user_acc_x(G)", self.specs["oxiod-synced-csv-v1"]["inference_fields"])

    def test_source_evidence_is_revision_pinned(self) -> None:
        payload = json.loads((ROOT / "datasets" / "source_evidence.json").read_text(encoding="utf-8"))
        self.assertEqual(payload["retrieved_on"], "2026-08-09")
        source_groups = {source["dataset"] for source in payload["sources"]}
        self.assertTrue({"RoNIN", "OxIOD", "RIDI"}.issubset(source_groups))
        self.assertIn("Android platform", source_groups)
        self.assertIn("stride-model reference", source_groups)
        for source in payload["sources"]:
            self.assertTrue(source["url"].startswith("https://"))
            self.assertTrue(source["revision"])
            self.assertTrue(source["supports"])

    def test_ridi_csv_reports_200_hz_downsample_gate_without_exposing_rows(self) -> None:
        spec = self.specs["ridi-processed-csv-v1"]
        columns = list(spec["required_fields"])
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "data.csv"
            with path.open("w", newline="", encoding="utf-8") as stream:
                writer = csv.DictWriter(stream, fieldnames=columns)
                writer.writeheader()
                for index in range(4):
                    row = {column: "0" for column in columns}
                    row["time"] = str(index * 5_000_000)
                    writer.writerow(row)
            audit = audit_csv_sequence(path, spec)
        self.assertEqual(audit.row_count, 4)
        self.assertAlmostEqual(audit.estimated_rate_hz or 0.0, 200.0)
        self.assertEqual(audit.null_inference_value_count, 0)
        self.assertIn("downsample-required", {finding.code for finding in audit.findings})
        serialized = audit.to_json()
        self.assertNotIn("gyro_x\": \"0", serialized)

    def test_csv_duplicate_and_non_monotonic_time_are_explicit(self) -> None:
        spec = {
            "id": "test",
            "dataset": "test",
            "timestamp_field": "time",
            "timestamp_scale_to_seconds": 1.0,
            "required_fields": ["time", "gyro"],
            "inference_fields": ["time", "gyro"],
        }
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "bad.csv"
            path.write_text("time,gyro\n1,0\n1,0\n0.5,\n", encoding="utf-8")
            audit = audit_csv_sequence(path, spec)
        codes = {finding.code for finding in audit.findings}
        self.assertIn("duplicate-timestamps", codes)
        self.assertIn("non-monotonic-time", codes)
        self.assertIn("null-inference-values", codes)

    def test_ronin_inventory_requires_input_and_truth_paths_but_separates_roles(self) -> None:
        spec = self.specs["ronin-hdf5-v1"]
        datasets = {
            field: {"shape": [401, 3], "dtype": "float64"}
            for field in spec["required_fields"]
        }
        datasets["synced/time"] = {
            "shape": [401],
            "dtype": "float64",
            "start_time_s": 0.0,
            "end_time_s": 2.0,
            "estimated_rate_hz": 200.0,
            "duplicate_timestamp_count": 0,
            "non_monotonic_timestamp_count": 0,
        }
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "manifest.json"
            path.write_text(json.dumps({"sequence": "seq", "datasets": datasets}), encoding="utf-8")
            audit = audit_hdf_inventory(path, spec)
        self.assertEqual(audit.row_count, 401)
        self.assertIn("downsample-required", {finding.code for finding in audit.findings})
        self.assertNotIn("pose/tango_pos", spec["inference_fields"])


if __name__ == "__main__":
    unittest.main()
