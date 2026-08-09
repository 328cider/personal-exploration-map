"""Build and execute the aggregate direct circular heading Stop notebook."""

from __future__ import annotations

from pathlib import Path

from nbclient import NotebookClient
import nbformat


REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
OUTPUT = REPOSITORY_ROOT / "research" / "pdr" / "notebooks" / "10_direct_heading_headroom.ipynb"


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
            "experiment": "ronin-direct-heading-v1",
            "phase": "development-stop",
            "raw_sensor_rows_embedded": 0,
            "model_coefficients_embedded": 0,
            "claim_boundary": (
                "non-commercial iterative development only; validation remains sealed"
            ),
        },
    }
    notebook["cells"] = [
        markdown(
            """
# Direct circular body-heading benchmark

## Answer first

All **24** causal recurrent candidates failed development. Direct circular
prediction reduced 50/100 Hz instability drastically, but the best diagnostic
result still had 84.303° mean heading MAE and 65.941° turn MAE. No model was
frozen and all three validation groups remain unfetched.
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
manifest_path = research_root / "datasets" / "manifests" / "ronin-direct-heading-development-v1.json"
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
improvement = (
    statistics.fmean(baselines) - statistics.fmean(headings)
) / statistics.fmean(baselines)
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
        markdown("## Failure anatomy and structural rate comparison"),
        code(
            """
reason_counts = Counter()
for candidate in report["candidates"]:
    for reason in candidate["rejection_reasons"]:
        key = reason if reason.startswith("aggregate:") else reason.split(":", 1)[1]
        reason_counts[key] += 1

residual_path = research_root / "datasets" / "manifests" / "ronin-learned-heading-development-v1.json"
residual = json.loads(residual_path.read_text(encoding="utf-8"))
residual_reasons = Counter(
    reason.split(":", 1)[1]
    for candidate in residual["candidates"]
    for reason in candidate["rejection_reasons"]
    if not reason.startswith("aggregate:")
)

{
    "direct": dict(sorted(reason_counts.items())),
    "residual_rate_violations": {
        "median": residual_reasons["median-rate-disagreement"],
        "p95": residual_reasons["p95-rate-disagreement"],
    },
}
"""
        ),
        code(
            """
assert report["candidate_count"] == 24
assert report["eligible_candidate_count"] == 0
assert report["selected_config_id"] is None
assert report["selected_model"] is None
assert report["development_decision"] == "stop-no-direct-heading-candidate-survived-development"
assert set(report["validation_state"].values()) == {"not-fetched"}
assert reason_counts["aggregate:worst-heading-mae"] == 24
assert reason_counts["aggregate:turn-mae"] == 24
assert reason_counts["aggregate:device-heading-improvement"] == 24
assert reason_counts["median-rate-disagreement"] == 0
assert reason_counts["p95-rate-disagreement"] == 2
print("PASS: direct circular family stopped; validation remains sealed.")
"""
        ),
        markdown(
            """
## Takeaway

Predicting circular state directly removed the catastrophic cross-rate drift of
residual integration: median rate violations fell from 142/144 to 0/96 and p95
violations from 143/144 to 2/96. Accuracy and turn generalization still failed
all registered gates. Further reservoir tuning on these reused development
groups is not justified.

The next accuracy experiment needs a new, rights-compatible multi-user,
multi-device, multi-placement Android evidence source. This benchmark cannot
authorize product use, a capture specification, or a personal pilot.
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
