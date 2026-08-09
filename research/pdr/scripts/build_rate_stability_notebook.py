"""Build and execute the rate-stable step detector notebook."""

from __future__ import annotations

from pathlib import Path

import nbformat
from nbclient import NotebookClient


REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
OUTPUT = (
    REPOSITORY_ROOT
    / "research"
    / "pdr"
    / "notebooks"
    / "06_rate_stable_step_detector.ipynb"
)


def markdown(source: str):
    return nbformat.v4.new_markdown_cell(source.strip())


def code(source: str):
    return nbformat.v4.new_code_cell(source.strip())


def build():
    notebook = nbformat.v4.new_notebook()
    notebook["metadata"] = {
        "kernelspec": {
            "display_name": "Python 3",
            "language": "python",
            "name": "python3",
        },
        "language_info": {"name": "python", "version": "3.12"},
        "pdr_research": {
            "phase": "rate-stable-step-detector-v1",
            "dataset": "RoNIN",
            "evidence_kind": "public-sequence-benchmark-only",
            "frozen_config": "rs25-a010-p025-r025",
            "claim_boundary": (
                "rate stability passed; count accuracy, body heading, Android "
                "lifecycle, product Go, and personal pilot remain blocked"
            ),
        },
    }
    notebook["cells"] = [
        markdown(
            """
# Causal rate-stable step detector

## tl;dr

- The split and gates were committed before assigned raw retrieval.
- The detector was frozen on `a051_3` before `a052_2` and `a049_1` were fetched.
- Both untouched sequences pass the 50/100 Hz stability gate.
- Android Step Counter comparison reveals up to 57.6% overcount, so stable does not mean correct.
- Distance and body heading remain blockers. Product adoption and a personal pilot stay Stop.
"""
        ),
        markdown(
            """
## Data contract and method

The frozen detector reads only raw `TYPE_ACCELEROMETER` values and monotonic sensor timestamps. It causally aggregates completed 40 ms buckets, uses timestamp-derived filters, and emits a peak/valley hysteresis event only after the falling edge is observable.

Trajectory and body-heading truth are evaluation-only. `TYPE_STEP_COUNTER` is added after validation as an Android-obtainable platform comparator, not as truth or a tuning input.
"""
        ),
        code(
            """
from pathlib import Path
import json
import subprocess
import sys

outputs = Path("/outputs")
development_path = outputs / "ronin-rate-stability-development.json"
validation_path = outputs / "ronin-rate-stability-validation.json"
platform_path = outputs / "ronin-platform-step-counter-comparison.json"
qa_path = outputs / "ronin-rate-stability-qa.json"

if not development_path.exists():
    subprocess.run([
        sys.executable, "research/pdr/scripts/analyze_step_rate_stability.py",
        "--phase", "development",
        "--sequence-root", "/data/ronin/a051_3",
        "--output", str(development_path),
    ], check=True)
if not validation_path.exists():
    subprocess.run([
        sys.executable, "research/pdr/scripts/analyze_step_rate_stability.py",
        "--phase", "validation",
        "--sequence-root", "/data/ronin/a052_2",
        "--sequence-root", "/data/ronin/a049_1",
        "--output", str(validation_path),
    ], check=True)
if not platform_path.exists():
    subprocess.run([
        sys.executable, "research/pdr/scripts/compare_platform_step_counter.py",
        "--sequence-root", "/data/ronin/a051_3",
        "--sequence-root", "/data/ronin/a052_2",
        "--sequence-root", "/data/ronin/a049_1",
        "--output", str(platform_path),
    ], check=True)

development = json.loads(development_path.read_text(encoding="utf-8"))
validation = json.loads(validation_path.read_text(encoding="utf-8"))
platform = json.loads(platform_path.read_text(encoding="utf-8"))
print("frozen config:", development["sequences"][0]["selected_development_config_id"])
print("validation pass:", validation["validation_pass"])
"""
        ),
        markdown("## Frozen development and untouched validation"),
        code(
            """
print(f"{'sequence':<9} {'role':<24} {'device':<9} {'count 50/100':<14} {'count diff':>11} {'amplitude diff':>15} {'B1 scale 50/100':>18} {'heading 50/100':>18}")
print("-" * 132)
all_sequences = [development["sequences"][0], *validation["sequences"]]
for sequence in all_sequences:
    selected = (
        sequence["selected_development_config_id"]
        if sequence["selected_development_config_id"] is not None
        else development["sequences"][0]["selected_development_config_id"]
    )
    result = next(item for item in sequence["rate_stable"] if item["config_id"] == selected)
    at_50, at_100 = result["rates"]["50"], result["rates"]["100"]
    print(
        f"{sequence['sequence']:<9} {sequence['role']:<24} {sequence['device']:<9} "
        f"{at_50['event_count']:>4}/{at_100['event_count']:<4}      "
        f"{result['relative_count_disagreement'] * 100:>9.3f}% "
        f"{result['relative_amplitude_score_disagreement'] * 100:>13.3f}% "
        f"{at_50['b1_metrics']['distance_scale_error'] * 100:>6.2f}/{at_100['b1_metrics']['distance_scale_error'] * 100:<6.2f}% "
        f"{at_50['b1_metrics']['heading_mae_deg']:>6.1f}/{at_100['b1_metrics']['heading_mae_deg']:<6.1f} deg"
    )
"""
        ),
        markdown("## Post-freeze Android Step Counter comparison"),
        code(
            """
print(f"{'sequence':<9} {'platform count':>14} {'custom 50/100':>16} {'signed error 50/100':>22} {'counter jumps':>14}")
print("-" * 84)
for record in platform["records"]:
    reference = record["platform_step_counter"]
    at_50, at_100 = record["rates"]["50"], record["rates"]["100"]
    print(
        f"{record['sequence']:<9} {reference['counter_delta']:>14} "
        f"{at_50['custom_event_count']:>6}/{at_100['custom_event_count']:<6} "
        f"{at_50['signed_count_error_vs_platform'] * 100:>8.2f}/{at_100['signed_count_error_vs_platform'] * 100:<8.2f}% "
        f"{reference['callback_jump_count']:>14}"
    )
print("maximum absolute disagreement:", f"{platform['maximum_absolute_count_error_vs_platform'] * 100:.2f}%")
"""
        ),
        markdown("## Independent QA"),
        code(
            """
qa_run = subprocess.run([
    sys.executable,
    "research/pdr/scripts/validate_step_rate_stability.py",
    "--development", str(development_path),
    "--validation", str(validation_path),
    "--platform-comparison", str(platform_path),
    "--output", str(qa_path),
], check=True, capture_output=True, text=True)
qa = json.loads(qa_path.read_text(encoding="utf-8"))
assert qa["qa_pass"] is True
assert qa["assertion_count"] >= 60
assert validation["validation_pass"] is True
assert platform["decision"]["product_or_personal_pilot"] == "stop"
assert qa["maximum_absolute_count_error_vs_platform"] > 0.50
print(
    f"QA passed {qa['assertion_count']} assertions; "
    f"validation_sha256={qa['validation_output_sha256']}"
)
"""
        ),
        markdown(
            """
## Interpretation

1. Fixed-time causal normalization solves the measured source-rate sensitivity on two frozen validation sequences.
2. It does not establish correct gait events: platform disagreement is heterogeneous and severe on development.
3. Distance remains around the Narrow/Stop boundary and body-heading error remains catastrophic.
4. The next experiment must address walking-state/step semantics and body heading separately; another stride coefficient sweep would confound them.
5. No result here authorizes native capture work or a personal walking pilot.

Sources: [Android SensorEvent](https://developer.android.com/reference/android/hardware/SensorEvent), [Android SensorManager](https://developer.android.com/reference/android/hardware/SensorManager), [Lee et al. 2015](https://doi.org/10.3390/s151127230), and the [official RoNIN data description](https://ronin.cs.sfu.ca/README.txt).
"""
        ),
    ]
    return notebook


def main() -> None:
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    notebook = build()
    client = NotebookClient(
        notebook,
        timeout=300,
        kernel_name="python3",
        resources={"metadata": {"path": str(REPOSITORY_ROOT)}},
    )
    client.execute()
    nbformat.validate(notebook)
    nbformat.write(notebook, OUTPUT)
    print(f"Wrote and executed {OUTPUT}")


if __name__ == "__main__":
    main()
