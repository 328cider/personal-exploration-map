#!/usr/bin/env python3
"""Validate Android emulator evidence without weakening physical-device KPIs."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from pdr_research.capture_quality import validate_capture_bundle  # noqa: E402
from pdr_research.emulator_gate import evaluate_emulator_plumbing  # noqa: E402


def _write(path: Path, value: dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("bundle", type=Path)
    parser.add_argument("--quality-output", type=Path, required=True)
    parser.add_argument("--gate-output", type=Path, required=True)
    args = parser.parse_args()

    report = validate_capture_bundle(
        args.bundle,
        contract_path=ROOT / "capture-schema" / "v1" / "field-contract.json",
    )
    quality = report.to_dict()
    gate = evaluate_emulator_plumbing(quality)
    _write(args.quality_output, quality)
    _write(args.gate_output, gate)
    print(json.dumps(gate, indent=2, sort_keys=True))
    return 0 if gate["accepted"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
