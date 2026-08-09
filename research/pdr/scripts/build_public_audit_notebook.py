"""Build and execute the metadata-only Phase 2 public dataset audit notebook."""

from __future__ import annotations

from pathlib import Path

import nbformat
from nbclient import NotebookClient


REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
OUTPUT = REPOSITORY_ROOT / "research" / "pdr" / "notebooks" / "02_public_dataset_audit.ipynb"


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
            "phase": 2,
            "audit_date": "2026-08-09",
            "raw_rows_loaded": 0,
            "claim_boundary": "official metadata/code audit; no benchmark accuracy or Android feasibility claim",
        },
    }
    notebook["cells"] = [
        markdown(
            """
# Phase 2 — Public dataset and pretrained-model compatibility audit

## tl;dr

- Audited datasets: 3; audited model/reference paths: 4.
- Product-compatible public datasets/models: **0**.
- RoNIN and RIDI expose useful Android-like signals, but their official reference paths assume 200 Hz and optional platform orientation/derived signals.
- OxIOD's documented synchronized header mixes Apple/Android platform semantics and does not establish a directly equivalent Android raw accelerometer input.
- No raw rows or weights were downloaded. All decisions remain `benchmark-only` until artifact license and sequence preflight pass.
"""
        ),
        markdown(
            """
## Context & Methods

This notebook is a metadata-quality audit for the main PDR decision, not a model-performance comparison. It executes the allowlist, leakage, rate, source-provenance, and model-license gates against revision-pinned metadata.

### Key assumptions

1. Product inference fields must map to ordinary Android `SensorEvent`/`Location` semantics.
2. Tango/Vicon trajectory, body alignment, corrected pose, and dataset EKF orientation are labels/evaluation only.
3. A source rate above 100 Hz requires downsample evidence; above 200 Hz is rejected.
4. Code license does not automatically license dataset archives or pretrained weights.
5. Public continuous streams cannot establish screen-off, OEM power, battery, thermal, or pocket-UX feasibility.
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

from pdr_research.compatibility import computed_decision
from pdr_research.contracts import CompatibilityDecision, FieldRole
from pdr_research.model_registry import audit_model_registry, load_model_registry
from pdr_research.preflight import adapter_roles_by_dataset, load_adapter_specs, validate_adapter_specs
from pdr_research.registry import load_registry
"""
        ),
        markdown("## Data\n\nLoad only committed metadata, adapter allowlists, model audits, and revision-pinned source evidence."),
        code(
            """
dataset_reports = load_registry(research_root / "datasets" / "registry.json")
adapter_specs = load_adapter_specs(research_root / "datasets" / "adapter_specs.json")
model_reports = load_model_registry(research_root / "models" / "registry.json")
source_evidence = json.loads((research_root / "datasets" / "source_evidence.json").read_text(encoding="utf-8"))
roles_by_dataset = adapter_roles_by_dataset(adapter_specs)

assert validate_adapter_specs(adapter_specs) == ()
assert audit_model_registry(model_reports, roles_by_dataset) == ()

{
    "datasets": len(dataset_reports),
    "adapters": len(adapter_specs),
    "model_paths": len(model_reports),
    "source_evidence_records": len(source_evidence["sources"]),
    "raw_rows_loaded": 0,
}
"""
        ),
        markdown("## Results\n\n### Dataset and adapter gate"),
        code(
            """
print(f"{'dataset':<8} {'decision':<18} {'adapter':<26} {'source Hz':>9} {'allowed inputs':>15} {'excluded fields':>16}")
print("-" * 99)
for report in dataset_reports:
    dataset_specs = [spec for spec in adapter_specs.values() if spec["dataset"] == report.dataset]
    for spec in dataset_specs:
        excluded = sum(
            metadata["role"] in {"training-label", "evaluation-only", "forbidden"}
            for metadata in spec["fields"].values()
        )
        print(
            f"{report.dataset:<8} {computed_decision(report).value:<18} {spec['id']:<26} "
            f"{spec['source_rate_hz']:>9} {len(spec['inference_fields']):>15} {excluded:>16}"
        )
"""
        ),
        markdown("### Model gate\n\nEvery published path is evaluated separately from the dataset's raw candidate subset."),
        code(
            """
print(f"{'model':<40} {'dataset':<8} {'Hz':>5} {'live':>6} {'decision':<16}")
print("-" * 82)
for model in model_reports:
    print(
        f"{model.model:<40} {model.dataset:<8} {model.required_rate_hz:>5.0f} "
        f"{str(model.live_output):>6} {model.declared_decision.value:<16}"
    )

summary = {
    "product_compatible_datasets": sum(
        computed_decision(report) is CompatibilityDecision.PRODUCT_COMPATIBLE
        for report in dataset_reports
    ),
    "product_compatible_models": sum(
        model.declared_decision is CompatibilityDecision.PRODUCT_COMPATIBLE
        for model in model_reports
    ),
    "models_above_100_hz": sum(model.required_rate_hz > 100 for model in model_reports),
    "models_with_unresolved_weight_terms": sum(
        any(marker in model.weight_license.lower() for marker in ("unknown", "unclear", "research-only"))
        for model in model_reports
    ),
}
summary
"""
        ),
        markdown("### Acceptance assertions"),
        code(
            """
assert summary == {
    "product_compatible_datasets": 0,
    "product_compatible_models": 0,
    "models_above_100_hz": 3,
    "models_with_unresolved_weight_terms": 4,
}
assert all(computed_decision(report) is CompatibilityDecision.BENCHMARK_ONLY for report in dataset_reports)
assert all(model.declared_decision is CompatibilityDecision.BENCHMARK_ONLY for model in model_reports)
assert "pose/tango_pos" not in adapter_specs["ronin-hdf5-v1"]["inference_fields"]
assert not any(field.startswith("pos_") or field.startswith("ori_") for field in adapter_specs["ridi-processed-csv-v1"]["inference_fields"])
assert not any("attitude" in field or "user_acc" in field for field in adapter_specs["oxiod-synced-csv-v1"]["inference_fields"])
print("All public-data metadata gates passed; all candidates remain benchmark-only.")
"""
        ),
        markdown(
            """
## Takeaways

1. Dataset availability is not equivalent to product-input compatibility. No public model passes the complete gate.
2. RoNIN raw Android streams are the best next sequence-level target, but official pretrained features depend on optional orientation and a problematic truth-informed training selection path.
3. RIDI is useful to exercise mixed input/truth-table defenses and 200→100/50 Hz robustness, not as a product implementation.
4. OxIOD can provide cross-platform benchmark evidence, but the accessible synchronized schema cannot reproduce the required Android raw-accelerometer contract.
5. The next step is one legally retrievable sequence per dataset, mounted read-only in Docker, with content hash and artifact terms recorded before any B0/B1 result is reported.

Primary sources are recorded in `datasets/source_evidence.json`; the narrative review is `PUBLIC_DATASET_AUDIT.md`.
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
