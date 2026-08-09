"""Print and enforce the current public-dataset compatibility decisions."""

from __future__ import annotations

from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from pdr_research.compatibility import audit_report, computed_decision  # noqa: E402
from pdr_research.registry import load_registry  # noqa: E402


def main() -> int:
    reports = load_registry(ROOT / "datasets" / "registry.json")
    exit_code = 0
    for report in reports:
        decision = computed_decision(report)
        print(f"{report.dataset}: {decision.value}")
        for finding in audit_report(report):
            print(f"  {finding.severity}: {finding.code}: {finding.message}")
        if decision.value != report.declared_decision.value:
            print(f"  error: declared {report.declared_decision.value}")
            exit_code = 1
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
