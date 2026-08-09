"""Audit one mounted public dataset sequence without emitting raw rows."""

from __future__ import annotations

import argparse
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from pdr_research.preflight import (  # noqa: E402
    audit_csv_sequence,
    audit_hdf_inventory,
    load_adapter_specs,
)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--adapter", required=True)
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()

    specs = load_adapter_specs(ROOT / "datasets" / "adapter_specs.json")
    if args.adapter not in specs:
        raise ValueError(f"Unknown adapter: {args.adapter}")
    spec = specs[args.adapter]
    if spec["format"] == "csv":
        result = audit_csv_sequence(args.input, spec)
    elif spec["format"] == "hdf5-inventory":
        result = audit_hdf_inventory(args.input, spec)
    else:
        raise ValueError(f"Unsupported format: {spec['format']}")
    output = result.to_json()
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(output + "\n", encoding="utf-8")
    else:
        print(output)
    return 1 if any(finding.severity == "critical" for finding in result.findings) else 0


if __name__ == "__main__":
    raise SystemExit(main())
