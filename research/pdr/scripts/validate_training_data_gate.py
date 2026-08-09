"""Independent standard-library QA for the learned training-data gate.

The validator deliberately does not import ``pdr_research.training_data_gate``.
It recomputes classifications, verifies source snapshots from fresh bounded
metadata fetches, and checks that labels cannot enter the product feature list.
"""

from __future__ import annotations

import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MANIFEST_PATH = ROOT / "datasets" / "manifests" / "learned-training-data-v1.json"
CANDIDATE_PATH = ROOT / "datasets" / "training_data_candidates.json"
PROTOCOL_PATH = ROOT / "LEARNED_TRAINING_DATA_PROTOCOL.md"
REQUIREMENTS = {
    "inference_inputs",
    "raw_semantics",
    "target_fitness",
    "rate_50_100_hz",
    "leakage_controls",
    "provenance",
    "rights",
    "deployment",
}
INFERENCE_ROLES = {"live-input", "post-session-input"}
LABEL_ROLES = {"training-label", "evaluation-only", "forbidden"}


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def independent_classification(candidate: dict[str, object]) -> str:
    gate = candidate["gate"]
    if all(gate[name]["state"] == "pass" for name in REQUIREMENTS):
        return "product-training-compatible"
    if gate["rights"]["state"] == "unknown":
        return "reject-unresolved"
    if gate["target_fitness"]["state"] == "fail":
        return "auxiliary-only"
    return "benchmark-only"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-snapshot", type=Path, required=True)
    args = parser.parse_args()

    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    registered = json.loads(CANDIDATE_PATH.read_text(encoding="utf-8"))
    snapshot = json.loads(args.source_snapshot.read_text(encoding="utf-8"))
    assertion_count = 0

    def check(condition: bool, message: str) -> None:
        nonlocal assertion_count
        assertion_count += 1
        if not condition:
            raise AssertionError(message)

    check(manifest["schema_version"] == 1, "unexpected manifest schema")
    check(manifest["raw_sensor_rows_downloaded"] == 0, "sensor rows were downloaded")
    check(snapshot["raw_sensor_rows_downloaded"] == 0, "source audit loaded sensor rows")
    check(snapshot["source_count"] == 8, "source snapshot scope changed")
    check(
        manifest["protocol_sha256"] == sha256_file(PROTOCOL_PATH),
        "protocol changed after execution",
    )

    candidates = manifest["candidates"]
    candidate_ids = [candidate["id"] for candidate in candidates]
    check(len(candidates) == 8, "candidate scope changed")
    check(len(candidate_ids) == len(set(candidate_ids)), "duplicate candidate ID")
    check(
        candidate_ids == [candidate["id"] for candidate in registered["candidates"]],
        "executed candidates differ from preregistered order",
    )
    for registered_candidate in registered["candidates"]:
        check(registered_candidate["audit_state"] == "complete", "audit is incomplete")

    for candidate in candidates:
        candidate_id = candidate["id"]
        check(set(candidate["gate"]) == REQUIREMENTS, f"gate changed: {candidate_id}")
        for requirement in sorted(REQUIREMENTS):
            entry = candidate["gate"][requirement]
            check(entry["state"] in {"pass", "fail", "unknown"}, f"bad state: {candidate_id}/{requirement}")
            check(bool(entry["evidence"]), f"missing evidence: {candidate_id}/{requirement}")
        check(
            candidate["classification"] == independent_classification(candidate),
            f"classification mismatch: {candidate_id}",
        )
        registered_candidate = next(
            item for item in registered["candidates"] if item["id"] == candidate_id
        )
        check(
            registered_candidate["classification"] == candidate["classification"],
            f"candidate registry mismatch: {candidate_id}",
        )

        fields = {field["name"]: field for field in candidate["fields"]}
        check(len(fields) == len(candidate["fields"]), f"duplicate fields: {candidate_id}")
        for field in candidate["fields"]:
            role = field["role"]
            check(role in INFERENCE_ROLES | LABEL_ROLES, f"bad role: {candidate_id}/{field['name']}")
            if role in INFERENCE_ROLES:
                check(bool(field["android_api"]), f"missing Android API: {candidate_id}/{field['name']}")
            else:
                check(field["android_api"] is None, f"label mapped as Android input: {candidate_id}/{field['name']}")
        for feature in candidate["inference_features"]:
            check(feature in fields, f"unknown feature: {candidate_id}/{feature}")
            check(fields[feature]["role"] in INFERENCE_ROLES, f"label leakage: {candidate_id}/{feature}")
        check(bool(candidate["group_split_keys"]), f"no group split: {candidate_id}")
        check(bool(candidate["primary_evidence"]), f"no primary evidence: {candidate_id}")

    counts = Counter(candidate["classification"] for candidate in candidates)
    expected_counts = {
        "auxiliary-only": 1,
        "benchmark-only": 3,
        "product-training-compatible": 0,
        "reject-unresolved": 4,
    }
    check(dict(sorted(counts.items())) == {key: value for key, value in expected_counts.items() if value}, "candidate counts changed")
    check(manifest["classification_counts"] == expected_counts, "recorded counts changed")
    check(manifest["product_training_compatible_candidates"] == [], "a source unexpectedly passed")
    check(manifest["decision"] == "stop-product-oriented-training", "stop decision weakened")

    by_id = {candidate["id"]: candidate for candidate in candidates}
    check(by_id["ronin"]["gate"]["rights"]["state"] == "fail", "RoNIN rights weakened")
    check(by_id["advio"]["gate"]["rights"]["state"] == "fail", "ADVIO rights weakened")
    check(by_id["idol"]["gate"]["rights"]["state"] == "pass", "IDOL license lost")
    check(by_id["idol"]["gate"]["inference_inputs"]["state"] == "fail", "iPhone treated as Android")
    check(by_id["dryad-walking"]["classification"] == "auxiliary-only", "Dryad scope widened")
    check(by_id["fda-wearables"]["gate"]["target_fitness"]["state"] == "fail", "FDA gait truth overstated")
    check(by_id["rudacop"]["gate"]["rights"]["state"] == "unknown", "RuDaCoP rights inferred")

    recorded_sources = {item["id"]: item for item in manifest["source_snapshots"]}
    current_sources = {item["id"]: item for item in snapshot["sources"]}
    check(set(recorded_sources) == set(current_sources), "source snapshot IDs changed")
    for source_id, recorded_source in recorded_sources.items():
        current_source = current_sources[source_id]
        check(len(recorded_source["sha256"]) == 64, f"missing raw source hash: {source_id}")
        check(recorded_source["download_bytes"] > 0, f"empty source snapshot: {source_id}")
        check(len(current_source["sha256"]) == 64, f"missing current source hash: {source_id}")
        check(current_source["download_bytes"] > 0, f"empty current source: {source_id}")
        check(
            current_source["evidence_sha256"] == recorded_source["evidence_sha256"],
            f"extracted evidence changed: {source_id}",
        )

    idol_checks = current_sources["idol-zenodo-api"]["analysis"]["claim_checks"]
    check(all(idol_checks.values()), "IDOL official metadata claims failed")
    advio_checks = current_sources["advio-zenodo-api"]["analysis"]["claim_checks"]
    check(all(advio_checks.values()), "ADVIO official metadata claims failed")
    dryad_checks = current_sources["dryad-walking-api"]["analysis"]["claim_checks"]
    check(all(dryad_checks.values()), "Dryad official metadata claims failed")
    fda_checks = current_sources["fda-wearables-page"]["analysis"]["claim_checks"]
    for claim in (
        "android_samsung_s22",
        "uncalibrated_phone_imu",
        "rate_100_hz",
        "participants_20",
        "placements_limited",
        "straight_and_curved",
    ):
        check(fda_checks[claim] is True, f"FDA claim failed: {claim}")
    check(fda_checks["continuous_2d_truth_claimed"] is False, "FDA truth was overstated")

    synapse_checks = current_sources["fda-synapse-access-wiki"]["analysis"]["claim_checks"]
    check(synapse_checks["research_development_or_education_scope"] is True, "Synapse scope missing")
    check(synapse_checks["redistribution_prohibited"] is True, "Synapse redistribution term missing")
    check(synapse_checks["commercial_ml_training_explicit"] is False, "unexpected commercial grant")
    check(synapse_checks["derived_weight_rights_explicit"] is False, "unexpected weight grant")

    for source_id in ("rudacop-official-page", "ridi-official-page", "oxiod-official-page"):
        claims = current_sources[source_id]["analysis"]["claim_checks"]
        check(claims["dataset_license_present"] is False, f"unreviewed license appeared: {source_id}")
        check(claims["commercial_ml_training_explicit"] is False, f"commercial grant appeared: {source_id}")
        check(claims["derived_weight_rights_explicit"] is False, f"weight grant appeared: {source_id}")

    print(
        json.dumps(
            {
                "assertions": assertion_count,
                "candidate_count": len(candidates),
                "source_count": len(current_sources),
                "classification_counts": expected_counts,
                "product_training_compatible": 0,
                "raw_sensor_rows_downloaded": 0,
                "decision": manifest["decision"],
                "status": "pass",
            },
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
