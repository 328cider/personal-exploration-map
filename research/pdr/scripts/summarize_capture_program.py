#!/usr/bin/env python3
"""Calculate preregistered capture KPIs without dropping failed attempts."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from pdr_research.capture_quality import (  # noqa: E402
    aggregate_capture_program,
    load_capture_program_plan,
    validate_capture_attempts,
)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--plan", type=Path, required=True)
    parser.add_argument("--capture-root", type=Path, required=True)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    plan_bytes = args.plan.read_bytes()
    plan_document = json.loads(plan_bytes)
    cells = load_capture_program_plan(args.plan)
    reports = validate_capture_attempts(
        args.capture_root,
        contract_path=ROOT / "capture-schema" / "v1" / "field-contract.json",
    )
    kpis = aggregate_capture_program(reports, plan_cells=cells)
    payload = {
        "plan": {
            "program_id": plan_document.get("program_id"),
            "program_revision": plan_document.get("program_revision"),
            "authorization": plan_document.get("authorization"),
            "frozen_before_collection": plan_document.get("frozen_before_collection"),
            "sha256": hashlib.sha256(plan_bytes).hexdigest(),
        },
        "program": kpis.to_dict(),
        "sessions": [report.to_dict() for report in reports],
    }
    rendered = json.dumps(payload, indent=2, sort_keys=True)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered + "\n", encoding="utf-8")
    else:
        print(rendered)
    return 0 if kpis.outcome == "capture-ready" else 2


if __name__ == "__main__":
    raise SystemExit(main())
