"""Build and execute the aggregate residual-ridge Stop notebook."""

from __future__ import annotations

from pathlib import Path

from nbclient import NotebookClient
import nbformat


REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
OUTPUT = REPOSITORY_ROOT / "research" / "pdr" / "notebooks" / "09_learned_heading_headroom.ipynb"


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
            "experiment": "ronin-learned-heading-v1",
            "phase": "development-stop",
            "raw_sensor_rows_embedded": 0,
            "model_coefficients_embedded": 0,
            "claim_boundary": "non-commercial public benchmark development only; validation remains sealed",
        },
    }
    notebook["cells"] = [
        markdown(
            """
# Learned body-heading residual-ridge benchmark

## Answer first

All **36** causal candidates failed development. The best diagnostic result was
91.388° subject-balanced heading MAE and 168.610° worst p95 50/100 Hz
disagreement. It was 2.23% worse than direct device heading. Therefore no model
was frozen and all three validation subjects remain unfetched.
"""
        ),
        code(
            """
from collections import Counter
from pathlib import Path
import json
import statistics

cwd = Path.cwd().resolve()
candidates = (cwd / "research" / "pdr", cwd, cwd.parent)
research_root = next(path for path in candidates if (path / "pdr_research").is_dir())
manifest_path = research_root / "datasets" / "manifests" / "ronin-learned-heading-development-v1.json"
report = json.loads(manifest_path.read_text(encoding="utf-8"))

{
    "candidate_count": report["candidate_count"],
    "fold_count": sum(len(candidate["folds"]) for candidate in report["candidates"]),
    "eligible_candidate_count": report["eligible_candidate_count"],
    "selected_config_id": report["selected_config_id"],
    "development_decision": report["development_decision"],
    "sensor_rows_embedded": 0,
    "model_coefficients_embedded": 0,
}
"""
        ),
        markdown("## Best diagnostic candidate"),
        code(
            """
diagnostic = next(
    candidate
    for candidate in report["candidates"]
    if candidate["config"]["config_id"] == report["best_diagnostic_config_id"]
)
headings = [
    fold["rates"][rate]["metrics"]["heading_mae_deg"]
    for fold in diagnostic["folds"]
    for rate in ("50", "100")
]
baselines = [
    fold["device_baselines"][rate]["metrics"]["heading_mae_deg"]
    for fold in diagnostic["folds"]
    for rate in ("50", "100")
]
improvement = (statistics.fmean(baselines) - statistics.fmean(headings)) / statistics.fmean(baselines)
{
    "config_id": diagnostic["config"]["config_id"],
    **diagnostic["ranking_score"],
    "device_heading_mean_mae_deg": statistics.fmean(baselines),
    "device_heading_improvement_fraction": improvement,
    "rejection_count": len(diagnostic["rejection_reasons"]),
}
"""
        ),
        markdown("### Held-out groups"),
        code(
            """
print(f"{'group':<8} {'MAE 50':>9} {'MAE 100':>9} {'device':>9} {'rate med':>10} {'rate p95':>10}")
print("-" * 61)
for fold in diagnostic["folds"]:
    print(
        f"{fold['held_out_subject_key']:<8} "
        f"{fold['rates']['50']['metrics']['heading_mae_deg']:>9.3f} "
        f"{fold['rates']['100']['metrics']['heading_mae_deg']:>9.3f} "
        f"{fold['device_baselines']['50']['metrics']['heading_mae_deg']:>9.3f} "
        f"{fold['rate_comparison']['median_disagreement_deg']:>10.3f} "
        f"{fold['rate_comparison']['p95_disagreement_deg']:>10.3f}"
    )
"""
        ),
        markdown("## Failure anatomy"),
        code(
            """
reason_counts = Counter()
for candidate in report["candidates"]:
    for reason in candidate["rejection_reasons"]:
        key = reason if reason.startswith("aggregate:") else reason.split(":", 1)[1]
        reason_counts[key] += 1

dict(sorted(reason_counts.items()))
"""
        ),
        code(
            """
assert report["candidate_count"] == 36
assert report["eligible_candidate_count"] == 0
assert report["selected_config_id"] is None
assert report["selected_model"] is None
assert report["development_decision"] == "stop-no-learned-candidate-survived-development"
assert set(report["validation_state"].values()) == {"not-fetched"}
assert reason_counts["aggregate:worst-heading-mae"] == 36
assert reason_counts["aggregate:turn-mae"] == 36
assert reason_counts["aggregate:device-heading-improvement"] == 36
assert reason_counts["median-rate-disagreement"] == 142
assert reason_counts["p95-rate-disagreement"] == 143
print("PASS: residual-ridge family stopped; validation remains sealed.")
"""
        ),
        markdown(
            """
## Takeaway

The pipeline produced causal, covered outputs, but integrating a learned residual
rate amplified small cross-rate and cross-subject biases over multi-minute
sequences. More ridge regularization and clipping did not solve this within the
locked grid. A direct circular-state recurrent model would be a genuinely new
family; it must be preregistered before touching the same sealed validation set.

This benchmark cannot authorize product use because RoNIN remains
non-commercial research data.
"""
        ),
    ]
    return notebook


def main() -> None:
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    notebook = build()
    NotebookClient(
        notebook,
        timeout=120,
        kernel_name="python3",
        resources={"metadata": {"path": str(REPOSITORY_ROOT)}},
    ).execute()
    nbformat.validate(notebook)
    nbformat.write(notebook, OUTPUT)
    print(f"Wrote and executed {OUTPUT}")


if __name__ == "__main__":
    main()
