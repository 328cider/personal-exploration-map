"""Build and execute the reader-facing Phase 3 common-baseline notebook."""

from __future__ import annotations

from pathlib import Path

import nbformat
from nbclient import NotebookClient


REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
OUTPUT = REPOSITORY_ROOT / "research" / "pdr" / "notebooks" / "03_common_baselines.ipynb"


def markdown(source: str):
    return nbformat.v4.new_markdown_cell(source.strip())


def code(source: str):
    return nbformat.v4.new_code_cell(source.strip())


def build():
    notebook = nbformat.v4.new_notebook()
    notebook["metadata"] = {
        "kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},
        "language_info": {"name": "python", "version": "3.12"},
        "pdr_research": {
            "phase": 3,
            "seed": 23,
            "evidence_kind": "synthetic-pipeline-only",
            "claim_boundary": "validates replay and failure gates; does not establish real-device accuracy",
        },
    }
    notebook["cells"] = [
        markdown(
            """
# Phase 3 — Common B0/B1 baseline replay

## tl;dr

- Executed **160** estimator/scenario/rate/route records from identical per-scenario raw sessions.
- B0 correctly rejected all 8 `imu6-only` runs instead of silently inventing step/orientation inputs.
- A 250 ms callback batch changed no sensor-time trajectory metric relative to the ideal replay.
- The injected 90-degree phone-handling change caused a **100% catastrophic-session rate** for every baseline profile; magnetic anomalies were rejected rather than used as heading.
- Even the synthetic ideal `B1/imu6` path produced catastrophic false intersections in 3 of 8 runs, so average drift alone is not a safe selection criterion.
- These are pipeline checks, not pocket-walking accuracy results. No Go/Narrow/Stop product decision is permitted from this notebook.
"""
        ),
        markdown(
            """
## Context & Methods

The notebook evaluates the minimum B0 and classical B1 contracts before any public-data or personal walking run. Every estimator receives only a `NormalizedSensorSession`; truth is passed later to the evaluation layer.

### Key Assumptions

1. Synthetic acceleration, step, and orientation channels exercise software behavior only.
2. Rotation Vector represents device orientation, not guaranteed body heading; a phone-orientation change is therefore an explicit failure test.
3. Sensor timestamps drive live estimates. Callback timestamps may be delayed by batching but cannot alter the trajectory.
4. B0 requires Step Detector plus Rotation Vector/Game Rotation Vector. B1 requires accelerometer and gyroscope and declares every optional fallback.
5. Magnetometer input is never used without a norm/accuracy quality gate; this baseline currently rejects or leaves it unused.
6. Ground truth is evaluation-only, and live output source ranges cannot extend past output time.
"""
        ),
        code(
            """
from pathlib import Path
import math
import sys

cwd = Path.cwd().resolve()
candidates = (cwd / "research" / "pdr", cwd, cwd.parent)
research_root = next(path for path in candidates if (path / "pdr_research").is_dir())
sys.path.insert(0, str(research_root))

from pdr_research.benchmark import run_synthetic_matrix, summarize_records
"""
        ),
        markdown(
            """
## Data

Four deterministic route shapes (`straight`, `rectangle`, `out-and-back`, `loop`) are replayed at 50 and 100 Hz under five conditions: ideal optional sensors, 250 ms callback batching, a 600 ms all-sensor gap, `imu6` only, and a 90-degree phone-handling change plus magnetic anomaly. The fixed seed is 23.
"""
        ),
        code(
            """
records = run_synthetic_matrix(seed=23)
summaries = summarize_records(records)

print(f"records={len(records)} supported={sum(record.supported for record in records)} unsupported={sum(not record.supported for record in records)}")
print(f"dataset_hashes={len({record.dataset_hash for record in records})} future_violations={sum(int(record.metrics.get('future_sample_violations', 0)) for record in records)}")
"""
        ),
        markdown("## Results\n\n### Scenario summary"),
        code(
            """
print(f"{'estimator/profile':<58} {'scenario':<19} {'ok':>3} {'med drift':>10} {'p90':>10} {'catastrophic':>13}")
print("-" * 121)
for summary in summaries:
    label = f"{summary['estimator']} [{summary['capability_profile']}]"
    if summary["supported_runs"]:
        median = f"{summary['endpoint_drift_median']:.3f}"
        p90 = f"{summary['endpoint_drift_p90']:.3f}"
        catastrophic = f"{summary['catastrophic_rate']:.3f}"
    else:
        median = p90 = catastrophic = "unsupported"
    print(
        f"{label:<58} {summary['scenario']:<19} {summary['supported_runs']:>3} "
        f"{median:>10} {p90:>10} {catastrophic:>13}"
    )
"""
        ),
        markdown("### Acceptance assertions"),
        code(
            """
assert len(records) == 160
assert all(record.evidence_kind == "synthetic-pipeline-only" for record in records)
assert sum(int(record.metrics.get("future_sample_violations", 0)) for record in records) == 0

b0_imu6_only = [record for record in records if record.estimator.startswith("B0") and record.scenario == "imu6-only"]
assert len(b0_imu6_only) == 8 and all(not record.supported for record in b0_imu6_only)

handling = [summary for summary in summaries if summary["scenario"] == "handling-magnetic"]
assert len(handling) == 4 and all(summary["catastrophic_rate"] == 1.0 for summary in handling)

summary_index = {
    (summary["estimator"], summary["capability_profile"], summary["scenario"]): summary
    for summary in summaries
}
for summary in summaries:
    if summary["scenario"] != "ideal-all":
        continue
    batched = summary_index[(summary["estimator"], summary["capability_profile"], "batch-250ms")]
    if summary["supported_runs"]:
        assert math.isclose(summary["endpoint_drift_median"], batched["endpoint_drift_median"], abs_tol=1e-12)
        assert math.isclose(summary["catastrophic_rate"], batched["catastrophic_rate"], abs_tol=1e-12)

assert all(summary["evidence_decision"] == "pipeline-only-not-go-narrow-stop" for summary in summaries)
print("All causality, capability, batching, failure, and claim-boundary assertions passed.")
"""
        ),
        markdown(
            """
## Takeaways

1. The common replay interface is usable at both 50 and 100 Hz without future-sample access.
2. Capability failure is explicit: B0 is unsupported when Step Detector and platform orientation are absent, while B1 records its custom-step and gyro-heading fallbacks.
3. Callback batching is operational metadata, not estimator time. The 250 ms batch replay leaves sensor-time results unchanged.
4. Phone/device orientation is still the dominant synthetic failure: every baseline is catastrophic after the injected 90-degree change, even when ideal drift values look small.
5. `B1/imu6` also demonstrates why topology flags remain separate from median endpoint drift: false intersections survive otherwise low synthetic errors.
6. Confidence is **Share with caveats** for software-pipeline readiness only. Public-sequence and real-device validation remain blocked by artifact terms and native capability evidence.
"""
        ),
    ]
    return notebook


def main() -> None:
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    notebook = build()
    client = NotebookClient(
        notebook,
        timeout=180,
        kernel_name="python3",
        resources={"metadata": {"path": str(REPOSITORY_ROOT)}},
    )
    client.execute()
    nbformat.validate(notebook)
    nbformat.write(notebook, OUTPUT)
    print(f"Wrote and executed {OUTPUT}")


if __name__ == "__main__":
    main()
