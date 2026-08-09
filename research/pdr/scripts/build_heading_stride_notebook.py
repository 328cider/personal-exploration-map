"""Build and execute the Android heading/stride diagnostic notebook."""

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
    / "05_heading_stride_diagnostic.ipynb"
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
            "phase": "heading-stride-diagnostic",
            "dataset": "RoNIN",
            "sequence": "a054_1",
            "evidence_kind": "public-sequence-diagnostic-only",
            "claim_boundary": (
                "does not select a stride gain, prove body heading, or authorize a pilot"
            ),
        },
    }
    notebook["cells"] = [
        markdown(
            """
# Android heading convention and stride-gain diagnostic

## tl;dr

- B1 v1.1.0 now follows Android `SensorManager.getOrientation()` azimuth semantics.
- Adapter v2 fixes RoNIN raw Game Rotation Vector order to Android `x,y,z,w`; the earlier 66.5–66.8° figures are invalid.
- Corrected platform heading MAE is 90.7–93.7°, with 75.7–82.6° turn MAE and mirrored paths.
- A predeclared stride-gain sweep shows that distance is calibration-sensitive; no gain is selected from this test sequence.
- The current step detector is also rate-sensitive because identical data produces materially different distance at 50 and 100 Hz.
- Decision: keep Stop, do not start a personal pilot, and fix body-heading and rate stability before calibration.
"""
        ),
        markdown(
            """
## Method and claim boundary

The estimator receives only raw accelerometer, gyroscope, Game Rotation Vector, and sensor timestamps. Android azimuth is computed as `atan2(R[1], R[4])`, then converted to mathematical heading using `pi/2 - azimuth`.

Stride uses `K * amplitude ** 0.25` for predeclared `K = 0.364, 0.400, 0.450, 0.640`. Ground truth is evaluated only after every output exists. These records are a sensitivity analysis, not hyperparameter selection.
"""
        ),
        code(
            """
from pathlib import Path
import json
import subprocess
import sys

report_path = Path("/outputs/ronin-a054_1-heading-stride-v2.json")
sequence_root = Path("/data/ronin/a054_1")
if not report_path.exists():
    subprocess.run(
        [
            sys.executable,
            "research/pdr/scripts/analyze_heading_stride.py",
            "--sequence-root", str(sequence_root),
            "--output", str(report_path),
        ],
        check=True,
    )
report = json.loads(report_path.read_text(encoding="utf-8"))
print(
    f"records={report['record_count']} "
    f"future_violations={report['future_sample_violations']}"
)
print(report["decision"])
"""
        ),
        markdown("## Results"),
        code(
            """
print(f"{'rate':>4} {'profile':<16} {'K':>6} {'distance':>10} {'scale':>8} {'heading':>9} {'turn':>7} {'mirror':>7}")
print("-" * 82)
for record in report["records"]:
    metrics = record["metrics"]
    print(
        f"{record['target_rate_hz']:>4} {record['capability_profile']:<16} "
        f"{record['weinberg_gain']:>6.3f} {metrics['estimated_distance_m']:>10.1f} "
        f"{metrics['distance_scale_error']:>8.3f} {metrics['heading_mae_deg']:>9.1f} "
        f"{metrics['turn_angle_mae_deg']:>7.1f} {str(metrics['mirrored']):>7}"
    )
"""
        ),
        markdown("## Reproducibility and leakage assertions"),
        code(
            """
assert report["record_count"] == 16
assert report["future_sample_violations"] == 0
assert report["source_adapter_id"] == "ronin-raw-hdf5-v2"
assert report["stride_sensitivity"]["gains"] == [0.364, 0.4, 0.45, 0.64]
assert "do not select" in report["stride_sensitivity"]["selection_rule"]
assert report["decision"]["heading"] == "stop-device-orientation-as-body-heading"
assert report["decision"]["personal_pilot"] == "not-authorized-by-this-evidence"

for rate in (50, 100):
    for profile in ("imu6", "platform-fused"):
        group = [
            record for record in report["records"]
            if record["target_rate_hz"] == rate
            and record["capability_profile"] == profile
        ]
        distances = [record["metrics"]["estimated_distance_m"] for record in group]
        headings = {round(record["metrics"]["heading_mae_deg"], 12) for record in group}
        assert distances == sorted(distances)
        assert len(headings) == 1
        assert all(
            record["metrics"]["future_sample_violations"] == 0 for record in group
        )

print("All causality, predeclared-sweep, monotonic-distance, and no-selection assertions passed.")
"""
        ),
        markdown(
            """
## Takeaways

1. Android coordinate and raw quaternion semantics are now explicit and tested; the corrected device heading remains distinct from body heading.
2. The low distance error at one fixed coefficient is not a valid selection result because this is the test sequence and the coefficient is placement/person dependent.
3. Distance disagreement between 50 and 100 Hz must be addressed before calibration.
4. Public-sequence performance and Android lifecycle feasibility remain separate decisions.
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
