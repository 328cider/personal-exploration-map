"""Build and execute the aggregate-only learned training-data gate notebook."""

from __future__ import annotations

from pathlib import Path

from nbclient import NotebookClient
import nbformat


REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
OUTPUT = (
    REPOSITORY_ROOT
    / "research"
    / "pdr"
    / "notebooks"
    / "08_learned_training_data_gate.ipynb"
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
            "phase": "learned-training-data-gate-v1",
            "audit_date": "2026-08-09",
            "candidate_count": 8,
            "raw_sensor_rows_loaded": 0,
            "model_weights_loaded": 0,
            "claim_boundary": (
                "metadata/schema/rights compatibility only; no learned-model accuracy "
                "or Android lifecycle claim"
            ),
        },
    }
    notebook["cells"] = [
        markdown(
            """
# Learned PDR training-data compatibility gate

## Answer first

**No audited public source passes the product-training gate.** Across eight
preregistered candidates, the result is 0 product-training-compatible, 3
benchmark-only, 1 auxiliary-only, and 4 reject-unresolved. Product-oriented
training therefore stops before any sensor rows or model weights are loaded.

The result separates three questions that must not be conflated: whether Android
can capture the inference inputs, whether the dataset supplies the correct
continuous label, and whether the artifact explicitly permits product training
and derived-weight use.
"""
        ),
        markdown(
            """
## Context and method

The machine-readable manifest records eight gate states per source: inference
inputs, raw semantics, target fitness, 50/100 Hz support, leakage controls,
provenance, rights, and deployment. Unknown artifact rights conservatively yield
`reject-unresolved`; a known missing heading/trajectory target with explicit
rights may be retained as `auxiliary-only`.

All pose, ground-truth heading/velocity, foot-IMU truth, pressure-walkway truth,
and corrected/platform-only orientation fields remain outside the inference
feature allowlist.
"""
        ),
        code(
            """
from collections import Counter
from pathlib import Path
import json
import sys

cwd = Path.cwd().resolve()
candidates = (cwd / "research" / "pdr", cwd, cwd.parent)
research_root = next(path for path in candidates if (path / "pdr_research").is_dir())
sys.path.insert(0, str(research_root))

from pdr_research.training_data_gate import validate_manifest

manifest_path = research_root / "datasets" / "manifests" / "learned-training-data-v1.json"
manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
errors = validate_manifest(manifest)
assert errors == [], errors

{
    "candidates": len(manifest["candidates"]),
    "raw_sensor_rows_loaded": 0,
    "model_weights_loaded": 0,
    "decision": manifest["decision"],
}
"""
        ),
        markdown("## Results\n\n### Candidate matrix"),
        code(
            """
print(f"{'source':<18} {'inputs':<8} {'target':<8} {'rights':<8} {'classification':<28}")
print("-" * 76)
for candidate in manifest["candidates"]:
    gate = candidate["gate"]
    print(
        f"{candidate['id']:<18} "
        f"{gate['inference_inputs']['state']:<8} "
        f"{gate['target_fitness']['state']:<8} "
        f"{gate['rights']['state']:<8} "
        f"{candidate['classification']:<28}"
    )
"""
        ),
        markdown("### Classification counts and blockers"),
        code(
            """
counts = Counter(candidate["classification"] for candidate in manifest["candidates"])
unknown_rights = [
    candidate["id"]
    for candidate in manifest["candidates"]
    if candidate["gate"]["rights"]["state"] == "unknown"
]
known_noncommercial = [
    candidate["id"]
    for candidate in manifest["candidates"]
    if candidate["gate"]["rights"]["state"] == "fail"
]
wrong_or_incomplete_target = [
    candidate["id"]
    for candidate in manifest["candidates"]
    if candidate["gate"]["target_fitness"]["state"] == "fail"
]
{
    "classification_counts": manifest["classification_counts"],
    "unknown_product_or_weight_rights": unknown_rights,
    "known_noncommercial": known_noncommercial,
    "no_continuous_heading_or_2d_target": wrong_or_incomplete_target,
}
"""
        ),
        markdown("### Android input and label-isolation checks"),
        code(
            """
live_fields = []
blocked_fields = []
for candidate in manifest["candidates"]:
    fields = {field["name"]: field for field in candidate["fields"]}
    for feature in candidate["inference_features"]:
        assert fields[feature]["role"] in {"live-input", "post-session-input"}
        assert fields[feature]["android_api"]
        live_fields.append((candidate["id"], feature))
    for field in candidate["fields"]:
        if field["role"] in {"training-label", "evaluation-only", "forbidden"}:
            assert field["name"] not in candidate["inference_features"]
            assert field["android_api"] is None
            blocked_fields.append((candidate["id"], field["name"], field["role"]))

{
    "android_mapped_inference_fields": len(live_fields),
    "isolated_label_evaluation_forbidden_fields": len(blocked_fields),
    "leakage_violations": 0,
}
"""
        ),
        markdown("### Acceptance assertions"),
        code(
            """
assert manifest["classification_counts"] == {
    "auxiliary-only": 1,
    "benchmark-only": 3,
    "product-training-compatible": 0,
    "reject-unresolved": 4,
}
assert manifest["product_training_compatible_candidates"] == []
assert manifest["decision"] == "stop-product-oriented-training"
assert manifest["raw_sensor_rows_downloaded"] == 0
assert set(unknown_rights) == {"ridi", "oxiod", "fda-wearables", "rudacop"}
assert set(known_noncommercial) == {"ronin", "advio"}
assert counts["auxiliary-only"] == 1
assert next(item for item in manifest["candidates"] if item["id"] == "dryad-walking")["classification"] == "auxiliary-only"
print("PASS: zero product-training sources; training and personal pilot remain stopped.")
"""
        ),
        markdown(
            """
## Takeaways

1. **RuDaCoP is the technical priority, not an authorized training corpus.** Its
   Android raw streams and natural placements are attractive, but an access link
   is not a commercial-training or derived-weight license.
2. **IDOL is rights-clear but platform-incompatible.** CC BY 4.0 cannot turn an
   iPhone fixed-rig stream into Android passive-use evidence.
3. **Dryad and FDA answer narrower questions.** Distance/gap or step/contact
   supervision cannot be promoted to continuous body-heading/2D truth.
4. **The next learned experiment needs a new preregistration.** Any benchmark-only
   model must keep non-shippable weights outside Git and preserve the untouched
   RoNIN validation subjects. No personal walking pilot follows from this gate.

The full evidence narrative is `LEARNED_TRAINING_DATA_RESULT.md`; byte and
canonical evidence hashes are in the machine-readable manifest.
"""
        ),
    ]
    return notebook


def main() -> None:
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    notebook = build()
    client = NotebookClient(
        notebook,
        timeout=120,
        kernel_name="python3",
        resources={"metadata": {"path": str(REPOSITORY_ROOT)}},
    )
    client.execute()
    nbformat.validate(notebook)
    nbformat.write(notebook, OUTPUT)
    print(f"Wrote and executed {OUTPUT}")


if __name__ == "__main__":
    main()
