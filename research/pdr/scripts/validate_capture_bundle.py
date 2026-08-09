#!/usr/bin/env python3
"""Validate one Android PDR capture bundle and emit deterministic JSON."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from pdr_research.capture_quality import validate_capture_bundle  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("bundle", type=Path, help="Completed capture directory or exported ZIP")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    report = validate_capture_bundle(
        args.bundle,
        contract_path=ROOT / "capture-schema" / "v1" / "field-contract.json",
    )
    rendered = json.dumps(report.to_dict(), indent=2, sort_keys=True)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered + "\n", encoding="utf-8")
    else:
        print(rendered)
    return 0 if report.usable else 2


if __name__ == "__main__":
    raise SystemExit(main())
