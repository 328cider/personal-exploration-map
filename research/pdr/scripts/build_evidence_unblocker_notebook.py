"""Build and execute the aggregate-only PDR evidence-unblocker v2 notebook."""

from __future__ import annotations

from pathlib import Path

from nbclient import NotebookClient
import nbformat


REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
OUTPUT = REPOSITORY_ROOT / "research" / "pdr" / "notebooks" / "11_evidence_unblocker_v2.ipynb"


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
            "phase": "evidence-unblocker-v2",
            "audit_date": "2026-08-09",
            "candidate_count": 7,
            "official_source_count": 8,
            "raw_sensor_rows_loaded": 0,
            "full_archives_loaded": 0,
            "model_weights_loaded": 0,
            "claim_boundary": "metadata/schema/rights compatibility and authorized classical-benchmark scope only",
        },
    }
    notebook["cells"] = [
        markdown(
            """
# PDR evidence unblocker v2

## Answer first

**No newly audited source reopens product-oriented learned PDR training.** Seven
preregistered candidates resolve to 0 full-PDR training compatible, 0
stride-component training compatible, 2 Android-input benchmark-only, and 5
reject-unresolved. IPIN 2022 and the single duplicated IPIN 2023/2024 lineage
may proceed only to a separately preregistered classical replay after row-level
rate/schema preflight.

No sensor row, full archive, model weight, or personal trace is loaded here.
"""
        ),
        markdown(
            """
## Frozen method

Each candidate is checked independently for Android input availability, raw
semantics, target supervision, 50/100 Hz operation, grouped splits,
provenance, artifact rights, and deployable preprocessing. Ground-truth pose,
heading, stride, foot IMU, LiDAR, platform AHRS, and camera/VIO remain outside
the inference feature allowlist.
"""
        ),
        code(
            """
from collections import Counter
from pathlib import Path
import json
import sys

cwd = Path.cwd().resolve()
roots = (cwd / "research" / "pdr", cwd, cwd.parent)
research_root = next(path for path in roots if (path / "pdr_research").is_dir())
sys.path.insert(0, str(research_root))

from pdr_research.evidence_unblocker import validate_manifest

manifest_path = research_root / "datasets" / "manifests" / "evidence-unblocker-v2.json"
manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
errors = validate_manifest(manifest)
assert errors == [], errors

{
    "candidates": len(manifest["candidates"]),
    "official_sources": len(manifest["source_snapshots"]),
    "metadata_bytes": manifest["metadata_bytes_transferred"],
    "raw_sensor_rows": manifest["raw_sensor_rows_downloaded"],
    "full_archives": manifest["full_dataset_archives_downloaded"],
    "model_weights": manifest["model_weights_downloaded"],
}
"""
        ),
        markdown("## Candidate decision matrix"),
        code(
            """
print(f"{'candidate':<26} {'scope':<19} {'input':<8} {'target':<8} {'split':<8} {'rights':<8} {'classification'}")
print("-" * 114)
for candidate in manifest["candidates"]:
    gate = candidate["gate"]
    print(
        f"{candidate['id']:<26} {candidate['target_scope']:<19} "
        f"{gate['android_inputs']['state']:<8} {gate['target_supervision']['state']:<8} "
        f"{gate['group_split']['state']:<8} {gate['rights']['state']:<8} "
        f"{candidate['classification']}"
    )
"""
        ),
        code(
            """
counts = Counter(candidate["classification"] for candidate in manifest["candidates"])
unknown_rights = [
    candidate["id"]
    for candidate in manifest["candidates"]
    if candidate["gate"]["rights"]["state"] == "unknown"
]
{
    "classification_counts": manifest["classification_counts"],
    "training_compatible": manifest["training_compatible_candidates"],
    "benchmark_only": manifest["benchmark_only_candidates"],
    "unknown_artifact_rights": unknown_rights,
    "training_decision": manifest["training_decision"],
    "next_action": manifest["next_action"],
}
"""
        ),
        markdown("## Duplicate-lineage and source-accounting checks"),
        code(
            """
cross = manifest["cross_source_checks"]
assert cross["ipin_2023_2024_training_members_byte_identical"] is True
assert cross["ipin_2023_training_count"] == cross["ipin_2024_training_count"] == 54
assert cross["duplicate_lineage_counted_as_one_candidate"] is True
assert sum(source["metadata_bytes_transferred"] for source in manifest["source_snapshots"]) == manifest["metadata_bytes_transferred"]

{
    "ipin_2023_2024_identical_training_members": True,
    "members_each": 54,
    "candidate_lineages_counted": 1,
    "metadata_bytes_transferred": manifest["metadata_bytes_transferred"],
}
"""
        ),
        markdown("## Android mapping and label-isolation checks"),
        code(
            """
eligible = []
isolated = []
for candidate in manifest["candidates"]:
    fields = {field["name"]: field for field in candidate["fields"]}
    for feature in candidate["inference_features"]:
        assert fields[feature]["role"] in {"live-input", "post-session-input"}
        assert fields[feature]["android_api"]
        eligible.append((candidate["id"], feature))
    for field in candidate["fields"]:
        if field["role"] in {"training-label", "evaluation-only", "forbidden"}:
            assert field["name"] not in candidate["inference_features"]
            assert field["android_api"] is None
            isolated.append((candidate["id"], field["name"], field["role"]))

{
    "android_mapped_inference_features": len(eligible),
    "isolated_non_input_fields": len(isolated),
    "label_leakage_violations": 0,
}
"""
        ),
        markdown("## Acceptance assertions"),
        code(
            """
assert manifest["classification_counts"] == {
    "component-training-compatible": 0,
    "product-input-benchmark-only": 2,
    "product-training-compatible": 0,
    "reject-incompatible": 0,
    "reject-unresolved": 5,
}
assert manifest["training_compatible_candidates"] == []
assert manifest["benchmark_only_candidates"] == ["ipin-2022-t3", "ipin-2023-2024-t3"]
assert manifest["training_decision"] == "stop-product-oriented-training"
assert manifest["next_action"] == "preregister-classical-benchmark-only"
assert manifest["raw_sensor_rows_downloaded"] == 0
assert manifest["full_dataset_archives_downloaded"] == 0
assert manifest["model_weights_downloaded"] == 0
print("PASS: learned training and personal pilot remain stopped; classical IPIN preflight is the only new path.")
"""
        ),
        markdown(
            """
## Decision meaning

- **IPIN is a capture/benchmark source, not continuous heading truth.** Its
  parser gives strong Android raw-sensor semantics and CC BY 4.0 rights, while
  sparse checkpoints cannot supervise learned body heading or velocity.
- **IPIN 2023 and 2024 are not independent replications.** All 54 normalized
  training members have the same sizes and CRCs.
- **xDR 2023 is the closest technical full-PDR source, but remains blocked.**
  Public material does not settle artifact rights, immutable provenance,
  columns, or grouped split keys.
- **Wang SLE/WDE are promising distance artifacts, but not training inputs.**
  Stable subject keys and artifact licenses are absent at the pinned commits.
- **A paper claim is not an auditable dataset.** ForestBack lacks its claimed
  notebook/README/license, and EL-SLE exposes no public data artifact.

The full narrative is `EVIDENCE_UNBLOCKER_V2_RESULT.md`; clarification requests
are bounded in `DATA_RIGHTS_CLARIFICATION_PACK.md`.
"""
        ),
    ]
    for index, cell in enumerate(notebook["cells"]):
        cell["id"] = f"evidence-unblocker-v2-{index:02d}"
    return notebook


def main() -> None:
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    notebook = build()
    client = NotebookClient(
        notebook,
        timeout=120,
        kernel_name="python3",
        record_timing=False,
        resources={"metadata": {"path": str(REPOSITORY_ROOT)}},
    )
    client.execute()
    nbformat.validate(notebook)
    nbformat.write(notebook, OUTPUT)
    print(f"Wrote and executed {OUTPUT}")


if __name__ == "__main__":
    main()
