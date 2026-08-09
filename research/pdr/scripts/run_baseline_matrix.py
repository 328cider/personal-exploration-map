"""Run the synthetic-only B0/B1 replay matrix and emit bounded JSON summaries."""

from __future__ import annotations

import argparse
from dataclasses import asdict
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from pdr_research.benchmark import run_synthetic_matrix, summarize_records  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path)
    parser.add_argument("--include-records", action="store_true")
    args = parser.parse_args()

    records = run_synthetic_matrix()
    payload: dict[str, object] = {
        "schema_version": 1,
        "evidence_kind": "synthetic-pipeline-only",
        "record_count": len(records),
        "summary": summarize_records(records),
        "warning": "Not evidence of real pocket-PDR accuracy or Android feasibility.",
    }
    if args.include_records:
        payload["records"] = [asdict(record) for record in records]
    serialized = json.dumps(payload, indent=2, ensure_ascii=False, allow_nan=False)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(serialized + "\n", encoding="utf-8")
    else:
        print(serialized)


if __name__ == "__main__":
    main()
