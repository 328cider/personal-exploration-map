"""Independent QA for the PDR evidence-unblocker v2 decision.

This script deliberately does not import ``pdr_research.evidence_unblocker``.
It recomputes classifications, label-isolation checks, frozen-scope checks, and
fresh official-source evidence hashes using only the standard library.
"""

from __future__ import annotations

import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MANIFEST_PATH = ROOT / "datasets" / "manifests" / "evidence-unblocker-v2.json"
CANDIDATE_PATH = ROOT / "datasets" / "evidence_unblocker_candidates_v2.json"
PROTOCOL_PATH = ROOT / "EVIDENCE_UNBLOCKER_V2_PROTOCOL.md"
NOTEBOOK_PATH = ROOT / "notebooks" / "11_evidence_unblocker_v2.ipynb"
REQUIREMENTS = {
    "android_inputs",
    "raw_semantics",
    "target_supervision",
    "rate_50_100_hz",
    "group_split",
    "provenance",
    "rights",
    "deployment",
}
CLASSIFICATIONS = {
    "product-training-compatible",
    "component-training-compatible",
    "product-input-benchmark-only",
    "reject-incompatible",
    "reject-unresolved",
}
INFERENCE_ROLES = {"live-input", "post-session-input"}
NON_INFERENCE_ROLES = {"training-label", "evaluation-only", "forbidden"}


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def independent_classification(candidate: dict[str, object]) -> str:
    gate = candidate["gate"]
    if gate["rights"]["state"] == "unknown":
        return "reject-unresolved"
    if gate["android_inputs"]["state"] == "fail" or gate["raw_semantics"]["state"] == "fail":
        return "reject-incompatible"
    if all(gate[name]["state"] == "pass" for name in REQUIREMENTS):
        if candidate["target_scope"] == "full-pdr":
            return "product-training-compatible"
        return "component-training-compatible"
    return "product-input-benchmark-only"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-snapshot", type=Path, required=True)
    args = parser.parse_args()

    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    registry = json.loads(CANDIDATE_PATH.read_text(encoding="utf-8"))
    snapshot = json.loads(args.source_snapshot.read_text(encoding="utf-8"))
    assertion_count = 0

    def check(condition: bool, message: str) -> None:
        nonlocal assertion_count
        assertion_count += 1
        if not condition:
            raise AssertionError(message)

    check(manifest["schema_version"] == 1, "unexpected manifest schema")
    check(registry["schema_version"] == 1, "unexpected candidate registry schema")
    check(snapshot["schema_version"] == 1, "unexpected source snapshot schema")
    check(manifest["protocol_sha256"] == sha256_file(PROTOCOL_PATH), "protocol changed after execution")
    check(manifest["notebook_sha256"] == sha256_file(NOTEBOOK_PATH), "executed notebook changed")
    for key in (
        "raw_sensor_rows_downloaded",
        "full_dataset_archives_downloaded",
        "model_weights_downloaded",
    ):
        check(manifest[key] == 0, f"manifest policy violated: {key}")
        check(snapshot[key] == 0, f"source audit policy violated: {key}")
    check(snapshot["source_count"] == 8, "source scope changed")
    check(
        snapshot["metadata_bytes_transferred"]
        == sum(source["metadata_bytes_transferred"] for source in snapshot["sources"]),
        "source byte accounting mismatch",
    )

    candidates = manifest["candidates"]
    registered = registry["candidates"]
    candidate_ids = [candidate["id"] for candidate in candidates]
    registered_ids = [candidate["id"] for candidate in registered]
    check(len(candidates) == 7, "candidate scope changed")
    check(candidate_ids == registered_ids, "executed candidate order differs from preregistration")
    check(len(candidate_ids) == len(set(candidate_ids)), "duplicate candidate ID")
    for registered_candidate, candidate in zip(registered, candidates, strict=True):
        check(registered_candidate["audit_state"] == "complete", f"audit incomplete: {candidate['id']}")
        check(
            registered_candidate["classification"] == candidate["classification"],
            f"registry classification differs: {candidate['id']}",
        )

    for candidate in candidates:
        candidate_id = candidate["id"]
        check(candidate["target_scope"] in {"full-pdr", "distance-component"}, f"bad target: {candidate_id}")
        check(set(candidate["gate"]) == REQUIREMENTS, f"gate changed: {candidate_id}")
        for requirement in sorted(REQUIREMENTS):
            entry = candidate["gate"][requirement]
            check(entry["state"] in {"pass", "fail", "unknown"}, f"bad state: {candidate_id}/{requirement}")
            check(bool(entry["evidence"]), f"missing evidence: {candidate_id}/{requirement}")
        check(candidate["classification"] in CLASSIFICATIONS, f"bad classification: {candidate_id}")
        check(
            candidate["classification"] == independent_classification(candidate),
            f"classification mismatch: {candidate_id}",
        )

        fields = {field["name"]: field for field in candidate["fields"]}
        check(bool(fields), f"empty field contract: {candidate_id}")
        check(len(fields) == len(candidate["fields"]), f"duplicate field: {candidate_id}")
        for field in candidate["fields"]:
            role = field["role"]
            check(role in INFERENCE_ROLES | NON_INFERENCE_ROLES, f"bad role: {candidate_id}/{field['name']}")
            if role in INFERENCE_ROLES:
                check(bool(field["android_api"]), f"missing Android API: {candidate_id}/{field['name']}")
            else:
                check(field["android_api"] is None, f"non-input mapped to Android: {candidate_id}/{field['name']}")
        for feature in candidate["inference_features"]:
            check(feature in fields, f"unknown feature: {candidate_id}/{feature}")
            check(fields[feature]["role"] in INFERENCE_ROLES, f"label leakage: {candidate_id}/{feature}")
        check(bool(candidate["group_split_keys"]), f"split evidence absent: {candidate_id}")
        check(bool(candidate["primary_evidence"]), f"primary evidence absent: {candidate_id}")
        check(bool(candidate["allowed_next_use"]), f"allowed use absent: {candidate_id}")
        check(bool(candidate["blocked_actions"]), f"blocked action absent: {candidate_id}")

    expected_counts = {
        "component-training-compatible": 0,
        "product-input-benchmark-only": 2,
        "product-training-compatible": 0,
        "reject-incompatible": 0,
        "reject-unresolved": 5,
    }
    counts = Counter(candidate["classification"] for candidate in candidates)
    expanded_counts = {name: counts.get(name, 0) for name in sorted(CLASSIFICATIONS)}
    check(expanded_counts == expected_counts, "classification totals changed")
    check(manifest["classification_counts"] == expected_counts, "recorded totals changed")
    check(manifest["training_compatible_candidates"] == [], "training source unexpectedly passed")
    check(
        manifest["benchmark_only_candidates"] == ["ipin-2022-t3", "ipin-2023-2024-t3"],
        "benchmark boundary changed",
    )
    check(manifest["training_decision"] == "stop-product-oriented-training", "stop decision weakened")
    check(manifest["next_action"] == "preregister-classical-benchmark-only", "next action widened")

    recorded_sources = {source["id"]: source for source in manifest["source_snapshots"]}
    current_sources = {source["id"]: source for source in snapshot["sources"]}
    expected_source_ids = {
        "ipin-2022-t3",
        "ipin-2023-t3",
        "ipin-2024-t3",
        "xdr-2023",
        "wang-sle",
        "wang-wde",
        "forestback",
        "el-sle",
    }
    check(set(recorded_sources) == expected_source_ids, "recorded source set changed")
    check(set(current_sources) == expected_source_ids, "fresh source set changed")
    for source_id in sorted(expected_source_ids):
        recorded_source = recorded_sources[source_id]
        current_source = current_sources[source_id]
        check(len(recorded_source["evidence_sha256"]) == 64, f"missing evidence hash: {source_id}")
        check(current_source["metadata_bytes_transferred"] > 0, f"empty source: {source_id}")
        check(
            current_source["evidence_sha256"] == recorded_source["evidence_sha256"],
            f"official evidence changed: {source_id}",
        )

    check(
        snapshot["cross_source_checks"]["ipin_2023_2024_training_members_byte_identical"] is True,
        "IPIN duplicate lineage check failed",
    )
    check(snapshot["cross_source_checks"]["ipin_2023_training_count"] == 54, "IPIN 2023 count changed")
    check(snapshot["cross_source_checks"]["ipin_2024_training_count"] == 54, "IPIN 2024 count changed")

    for source_id in ("ipin-2022-t3", "ipin-2023-t3", "ipin-2024-t3"):
        claims = current_sources[source_id]["analysis"]["claim_checks"]
        for claim in (
            "license_is_cc_by_4",
            "access_is_open",
            "android_app_parser",
            "raw_accelerometer_schema",
            "raw_gyroscope_schema",
            "raw_magnetometer_schema",
            "sensor_timestamp_preferred",
            "platform_ahrs_present",
            "position_reference_present",
            "ground_truth_is_sparse",
        ):
            check(claims[claim] is True, f"IPIN claim failed: {source_id}/{claim}")
        check(claims["raw_sensor_member_opened"] is False, f"IPIN raw row opened: {source_id}")

    xdr = current_sources["xdr-2023"]["analysis"]["claim_checks"]
    for claim in (
        "android_collection",
        "raw_accelerometer",
        "raw_gyroscope",
        "raw_magnetometer",
        "lidar_position_truth_100_hz",
        "lidar_orientation_truth_100_hz",
        "registration_required",
    ):
        check(xdr[claim] is True, f"xDR claim failed: {claim}")
    for claim in ("dataset_license_present", "commercial_ml_training_explicit", "derived_weight_rights_explicit"):
        check(xdr[claim] is False, f"xDR right inferred: {claim}")

    for source_id in ("wang-sle", "wang-wde"):
        claims = current_sources[source_id]["analysis"]["claim_checks"]
        check(claims["rate_100_hz"] is True, f"100 Hz claim failed: {source_id}")
        check(claims["per_stride_truth"] is True, f"stride truth claim failed: {source_id}")
        check(claims["foot_imu_label_source"] is True, f"foot truth claim failed: {source_id}")
        check(claims["subject_ids_explicit_in_readme"] is False, f"subject IDs unexpectedly inferred: {source_id}")
        check(claims["artifact_license_present"] is False, f"artifact license unexpectedly inferred: {source_id}")
    check(current_sources["wang-sle"]["analysis"]["claim_checks"]["android_dataset"] is True, "SLE Android claim failed")
    check(current_sources["wang-wde"]["analysis"]["claim_checks"]["huawei_mate_9_phone"] is True, "WDE phone claim failed")

    forest = current_sources["forestback"]["analysis"]["claim_checks"]
    for claim in ("paper_claims_36_trials", "paper_claims_42474_samples", "paper_claims_dataset_and_notebook", "archive_has_raw_and_summary_csv"):
        check(forest[claim] is True, f"ForestBack paper/archive claim failed: {claim}")
    for claim in ("repository_has_readme", "repository_has_license", "archive_has_notebook", "raw_sensor_member_opened"):
        check(forest[claim] is False, f"ForestBack missing-artifact guard failed: {claim}")

    el_sle = current_sources["el-sle"]["analysis"]["claim_checks"]
    for claim in ("five_android_smartphones", "distance_31_5_km", "duration_8_1_h", "vio_label_collection"):
        check(el_sle[claim] is True, f"EL-SLE paper claim failed: {claim}")
    for claim in ("data_availability_section_present", "supplementary_material_present", "public_dataset_link_present"):
        check(el_sle[claim] is False, f"EL-SLE artifact inferred: {claim}")

    by_id = {candidate["id"]: candidate for candidate in candidates}
    check(by_id["ipin-2022-t3"]["gate"]["target_supervision"]["state"] == "fail", "sparse IPIN truth promoted")
    check(by_id["ipin-2023-2024-t3"]["gate"]["group_split"]["state"] == "fail", "missing IPIN user IDs ignored")
    check(by_id["xdr-2023"]["gate"]["rights"]["state"] == "unknown", "xDR rights inferred")
    check(by_id["wang-sle"]["gate"]["group_split"]["state"] == "fail", "SLE split overstated")
    check(by_id["wang-wde"]["gate"]["group_split"]["state"] == "fail", "WDE split overstated")
    check(by_id["forestback"]["gate"]["provenance"]["state"] == "fail", "ForestBack provenance overstated")
    check(by_id["el-sle"]["gate"]["provenance"]["state"] == "fail", "EL-SLE paper promoted to artifact")

    print(
        json.dumps(
            {
                "assertions": assertion_count,
                "candidate_count": len(candidates),
                "source_count": len(current_sources),
                "classification_counts": expected_counts,
                "metadata_bytes_transferred": snapshot["metadata_bytes_transferred"],
                "raw_sensor_rows_downloaded": 0,
                "training_compatible": 0,
                "benchmark_only": 2,
                "decision": manifest["training_decision"],
                "next_action": manifest["next_action"],
                "status": "pass",
            },
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
