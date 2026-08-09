from __future__ import annotations

import json
from pathlib import Path
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from fetch_ipin_sequences import (  # noqa: E402
    selected_sequences,
    validate_phase_unlock,
)


class IPINFetchGuardTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        path = ROOT / "datasets" / "manifests" / "ipin-classical-preregistration-v1.json"
        cls.preregistration = json.loads(path.read_text(encoding="utf-8"))

    def test_phase_selection_is_frozen_to_two_members(self) -> None:
        development = selected_sequences(self.preregistration, "development")
        validation = selected_sequences(self.preregistration, "validation")
        self.assertEqual([item["user"] for item in development], ["03", "03"])
        self.assertEqual([item["user"] for item in validation], ["05", "05"])
        self.assertEqual({item["trial"] for item in development}, {"12", "13"})
        self.assertEqual({item["trial"] for item in validation}, {"12", "13"})

    def test_validation_is_sealed_without_freeze(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            missing = Path(directory) / "missing.json"
            with self.assertRaisesRegex(ValueError, "Validation remains sealed"):
                validate_phase_unlock(
                    phase="validation",
                    preregistration=self.preregistration,
                    development_freeze=missing,
                )

    def test_development_needs_no_validation_unlock(self) -> None:
        result = validate_phase_unlock(
            phase="development",
            preregistration=self.preregistration,
            development_freeze=Path("does-not-exist"),
        )
        self.assertIsNone(result)

    def test_validation_requires_matching_frozen_contract(self) -> None:
        valid = {
            "status": "development-frozen",
            "validation_authorized": True,
            "protocol_sha256": self.preregistration["protocol_sha256"],
            "parameter_search_performed": False,
        }
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "freeze.json"
            path.write_text(json.dumps(valid), encoding="utf-8")
            self.assertEqual(
                validate_phase_unlock(
                    phase="validation",
                    preregistration=self.preregistration,
                    development_freeze=path,
                ),
                valid,
            )
            for key, value in (
                ("validation_authorized", False),
                ("protocol_sha256", "0" * 64),
                ("parameter_search_performed", True),
            ):
                mutated = {**valid, key: value}
                path.write_text(json.dumps(mutated), encoding="utf-8")
                with self.assertRaisesRegex(ValueError, "Validation remains sealed"):
                    validate_phase_unlock(
                        phase="validation",
                        preregistration=self.preregistration,
                        development_freeze=path,
                    )


if __name__ == "__main__":
    unittest.main()
