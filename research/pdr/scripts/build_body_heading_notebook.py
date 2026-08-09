"""Build and execute the reader-facing body-heading gate notebook."""

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
    / "07_body_heading_gate.ipynb"
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
            "experiment": "ronin-body-heading-v1",
            "phase": "development-stop",
            "evidence_kind": "public-sequence-benchmark-only",
            "claim_boundary": (
                "stops the preregistered PCA family; does not consume validation, "
                "authorize product integration, or establish Android lifecycle feasibility"
            ),
        },
    }
    notebook["cells"] = [
        markdown(
            """
# Android-compatible body-heading gate

## tl;dr

- RoNIN raw `game_rv` is Android `x,y,z,w`; adapter v2 corrects the earlier reversed-order assumption.
- All 90 preregistered causal horizontal-acceleration PCA candidates fail the development gate.
- The best diagnostic candidate has 84.5° subject-balanced heading MAE and a 179.7° worst p95 50/100 Hz disagreement.
- No candidate was frozen, so all three validation sequences remain unfetched.
- The official RoNIN heading checkpoint is metadata-audited only: 200 Hz, five-second input, unreproducible private training data, and non-commercial terms make it benchmark/demo-only.
- Decision: stop this PCA family; no product integration and no personal pilot.
"""
        ),
        markdown(
            """
## Load aggregate evidence

The notebook reads aggregate JSON only. It neither opens raw rows nor downloads a validation sequence. Inference code never imports ground truth; the separate evaluator produced the metrics after each causal run.
"""
        ),
        code(
            """
from pathlib import Path
import json

development_path = Path("/outputs/ronin-body-heading-development.json")
model_audit_path = Path("/outputs/ronin-body-heading-model-audit.json")
assert development_path.exists(), "Run the locked development analysis first"
assert model_audit_path.exists(), "Run the metadata-only model audit first"

development = json.loads(development_path.read_text(encoding="utf-8"))
model_audit = json.loads(model_audit_path.read_text(encoding="utf-8"))
print(
    f"candidates={development['candidate_count']} "
    f"eligible={development['eligible_candidate_count']} "
    f"selected={development['selected_config_id']}"
)
print(development["development_decision"])
"""
        ),
        markdown("## Development result"),
        code(
            """
best = next(
    candidate
    for candidate in development["candidates"]
    if candidate["config"]["config_id"] == development["best_diagnostic_config_id"]
)
score = best["ranking_score"]
print(f"diagnostic candidate: {best['config']['config_id']} (not eligible)")
print(f"worst sequence heading MAE: {score['worst_sequence_mean_heading_mae_deg']:.1f}°")
print(f"subject-balanced heading MAE: {score['subject_balanced_mean_heading_mae_deg']:.1f}°")
print(f"subject-balanced turn MAE: {score['subject_balanced_mean_turn_mae_deg']:.1f}°")
print(f"worst p95 rate disagreement: {score['worst_p95_rate_disagreement_deg']:.1f}°")
print("\\nsequence   heading50 heading100 turn50 turn100 rate-p95")
for sequence in best["sequences"]:
    at_50 = sequence["rates"]["50"]["metrics"]
    at_100 = sequence["rates"]["100"]["metrics"]
    print(
        f"{sequence['sequence']:<10} {at_50['heading_mae_deg']:>9.1f}° "
        f"{at_100['heading_mae_deg']:>9.1f}° {at_50['turn_angle_mae_deg']:>6.1f}° "
        f"{at_100['turn_angle_mae_deg']:>6.1f}° "
        f"{sequence['rate_comparison']['p95_disagreement_deg']:>7.1f}°"
    )
"""
        ),
        markdown("## Adapter-v2 physical sanity and untouched validation"),
        code(
            """
print("sequence rate gravity-z horizontal-mean orientation-lag-p95")
for sequence in development["sequence_metadata"]:
    for rate in ("50", "100"):
        diagnostic = sequence["prepared_signal_diagnostics"][rate]
        print(
            f"{sequence['sequence']:<10} {rate:>4} "
            f"{diagnostic['reference_mean_z_mps2']:>8.3f} "
            f"{diagnostic['horizontal_mean_magnitude_mps2']:>15.3f} "
            f"{diagnostic['orientation_lag_p95_ms']:>19.2f} ms"
        )

assert development["source_adapter_id"] == "ronin-raw-hdf5-v2"
assert all(value == "not-fetched" for value in development["validation_state"].values())
assert development["selected_config_id"] is None
print("validation preserved:", ", ".join(sorted(development["validation_state"])))
"""
        ),
        markdown("## Official model metadata audit"),
        code(
            """
config = model_audit["configuration"][0]["content"]
print("archive sha256:", model_audit["artifact"]["sha256"])
print("download bytes:", model_audit["artifact"]["download_bytes"])
print("window frames:", config["window_size"])
print("required rate:", model_audit["input_contract"]["required_rate_hz"], "Hz")
print("checkpoint deserialized:", model_audit["artifact"]["checkpoint_deserialized"])
print("decision:", model_audit["decision"])

assert config["window_size"] == 1000
assert model_audit["input_contract"]["required_rate_hz"] == 200
assert model_audit["artifact"]["checkpoint_deserialized"] is False
assert all(model_audit["official_text_evidence"]["claim_checks"].values())
assert model_audit["decision"] == "benchmark-demo-only-do-not-run-or-ship"
"""
        ),
        markdown("## Independent aggregate validator"),
        code(
            """
import subprocess
import sys

completed = subprocess.run(
    [
        sys.executable,
        "research/pdr/scripts/validate_body_heading.py",
        "--development", str(development_path),
        "--model-audit", str(model_audit_path),
        "--data-root", "/data/ronin",
    ],
    check=True,
    capture_output=True,
    text=True,
)
validation = json.loads(completed.stdout)
assert validation["status"] == "pass"
print(json.dumps(validation, indent=2, sort_keys=True))
"""
        ),
        markdown(
            """
## Takeaways

1. The input contract protected the product decision: correcting a dataset semantic error made the platform result worse, and the report records the supersession rather than preserving a favorable number.
2. Median rate agreement is insufficient for an axial PCA estimator; near-180° tail flips invalidate the route even when most matched samples agree.
3. A development Stop preserves scarce untouched validation evidence.
4. The official learned checkpoint is useful architecture evidence, not product evidence or a distributable dependency.
5. The next family needs a new preregistration and clean training provenance; these validation sequences must not be touched until that family is frozen.
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
