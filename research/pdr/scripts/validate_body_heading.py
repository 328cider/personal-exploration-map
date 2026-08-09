"""Independent standard-library QA for the body-heading development gate.

This validator does not import estimator or evaluator code.  It recomputes the
locked gate decisions from aggregate JSON and verifies current source hashes,
split preservation, physical sanity checks, and model-audit provenance.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
import statistics


ROOT = Path(__file__).resolve().parents[1]
SPLIT_PATH = ROOT / "datasets" / "splits" / "ronin-body-heading-v1.json"
MODEL_MANIFEST_PATH = (
    ROOT / "datasets" / "manifests" / "ronin-body-heading-model.json"
)
RESULT_MANIFEST_PATH = (
    ROOT / "datasets" / "manifests" / "ronin-body-heading-v1.json"
)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def development_rejections(candidate: dict[str, object]) -> list[str]:
    reasons: list[str] = []
    for sequence in candidate["sequences"]:
        name = sequence["sequence"]
        for rate in ("50", "100"):
            metrics = sequence["rates"][rate]["metrics"]
            if metrics["future_sample_violations"]:
                reasons.append(f"{name}/{rate}:future-sample")
            if metrics["initialization_latency_s"] > 5.0:
                reasons.append(f"{name}/{rate}:late-initialization")
            if metrics["fresh_output_fraction"] < 0.25:
                reasons.append(f"{name}/{rate}:low-fresh-output")
        comparison = sequence["rate_comparison"]
        if comparison["median_disagreement_deg"] > 3.0:
            reasons.append(f"{name}:median-rate-disagreement")
        if comparison["p95_disagreement_deg"] > 10.0:
            reasons.append(f"{name}:p95-rate-disagreement")
    return reasons


def development_score(candidate: dict[str, object]) -> tuple[float, float, float, float, str]:
    per_sequence_heading = []
    per_sequence_turn = []
    rate_p95 = []
    for sequence in candidate["sequences"]:
        per_sequence_heading.append(
            statistics.fmean(
                sequence["rates"][rate]["metrics"]["heading_mae_deg"]
                for rate in ("50", "100")
            )
        )
        per_sequence_turn.append(
            statistics.fmean(
                sequence["rates"][rate]["metrics"]["turn_angle_mae_deg"]
                for rate in ("50", "100")
            )
        )
        rate_p95.append(sequence["rate_comparison"]["p95_disagreement_deg"])
    return (
        max(per_sequence_heading),
        statistics.fmean(per_sequence_heading),
        statistics.fmean(per_sequence_turn),
        max(rate_p95),
        candidate["config"]["config_id"],
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--development", type=Path, required=True)
    parser.add_argument("--model-audit", type=Path, required=True)
    parser.add_argument("--data-root", type=Path, default=Path("/data/ronin"))
    args = parser.parse_args()

    report = json.loads(args.development.read_text(encoding="utf-8"))
    audit = json.loads(args.model_audit.read_text(encoding="utf-8"))
    split = json.loads(SPLIT_PATH.read_text(encoding="utf-8"))
    model_manifest = json.loads(MODEL_MANIFEST_PATH.read_text(encoding="utf-8"))
    result_manifest = json.loads(RESULT_MANIFEST_PATH.read_text(encoding="utf-8"))
    assertion_count = 0

    def check(condition: bool, message: str) -> None:
        nonlocal assertion_count
        assertion_count += 1
        if not condition:
            raise AssertionError(message)

    check(report["schema_version"] == 1, "unexpected report schema")
    check(report["experiment"] == split["experiment"], "experiment mismatch")
    check(report["phase"] == "development", "report is not development")
    check(report["source_adapter_id"] == "ronin-raw-hdf5-v2", "wrong adapter")
    check(report["split_sha256"] == sha256_file(SPLIT_PATH), "split hash mismatch")
    check(result_manifest["split_sha256"] == report["split_sha256"], "result split hash mismatch")
    check(result_manifest["source_adapter_id"] == report["source_adapter_id"], "result adapter mismatch")
    check(result_manifest["implementation_sha256"] == report["implementation_sha256"], "result source hashes mismatch")
    for relative, expected in report["implementation_sha256"].items():
        check(sha256_file(ROOT / relative) == expected, f"source hash mismatch: {relative}")

    development_names = {
        item["sequence"] for item in split["development_assignments"]
    }
    validation_names = {
        item["sequence"] for item in split["validation_assignments"]
    }
    check(not development_names & validation_names, "sequence split overlaps")
    check(
        len({item["subject_key"] for item in split["development_assignments"]})
        == len(split["development_assignments"]),
        "development subject keys overlap",
    )
    check(
        len({item["subject_key"] for item in split["validation_assignments"]})
        == len(split["validation_assignments"]),
        "validation subject keys overlap",
    )
    check(
        set(report["validation_state"]) == validation_names,
        "validation state does not match split",
    )
    for name in sorted(validation_names):
        check(report["validation_state"][name] == "not-fetched", f"{name} state changed")
        check(not (args.data_root / name).exists(), f"{name} was fetched")
    check(
        not (args.development.parent / "ronin-body-heading-validation.json").exists(),
        "validation output exists without a frozen development candidate",
    )

    candidates = report["candidates"]
    check(report["candidate_count"] == 90 == len(candidates), "grid cardinality changed")
    ids = [candidate["config"]["config_id"] for candidate in candidates]
    check(len(ids) == len(set(ids)), "candidate IDs are not unique")
    check(
        {candidate["config"]["window_s"] for candidate in candidates}
        == {1.0, 1.5, 2.0, 3.0, 5.0},
        "window grid changed",
    )
    check(
        {candidate["config"]["weighting"] for candidate in candidates}
        == {"uniform", "horizontal-energy"},
        "weighting grid changed",
    )
    check(
        {candidate["config"]["smoothing_tau_s"] for candidate in candidates}
        == {0.0, 0.25, 0.5},
        "smoothing grid changed",
    )
    check(
        {candidate["config"]["minimum_anisotropy"] for candidate in candidates}
        == {1.0, 1.5, 2.0},
        "anisotropy grid changed",
    )
    for candidate in candidates:
        recomputed = development_rejections(candidate)
        check(recomputed == candidate["rejection_reasons"], f"rejection mismatch: {candidate['config']['config_id']}")
        check(candidate["eligible"] == (not recomputed), f"eligibility mismatch: {candidate['config']['config_id']}")

    eligible = [candidate for candidate in candidates if candidate["eligible"]]
    check(not eligible, "a candidate unexpectedly survived")
    check(report["eligible_candidate_count"] == 0, "eligible count is not zero")
    check(result_manifest["candidate_grid"]["eligible_count"] == 0, "manifest eligible count changed")
    check(report["selected_config_id"] is None, "a failed candidate was selected")
    check(report["selected_config"] is None, "a failed config was frozen")
    check(
        report["development_decision"]
        == "stop-no-candidate-survived-preregistered-gates",
        "development decision changed",
    )

    diagnostic = min(
        candidates,
        key=lambda candidate: (
            len(candidate["rejection_reasons"]),
            development_score(candidate),
        ),
    )
    check(
        diagnostic["config"]["config_id"] == report["best_diagnostic_config_id"],
        "diagnostic candidate ranking mismatch",
    )
    check(
        result_manifest["best_diagnostic_only"]["config_id"]
        == report["best_diagnostic_config_id"],
        "manifest diagnostic candidate mismatch",
    )
    recorded_score = diagnostic["ranking_score"]
    recomputed_score = development_score(diagnostic)
    for key, value in zip(
        (
            "worst_sequence_mean_heading_mae_deg",
            "subject_balanced_mean_heading_mae_deg",
            "subject_balanced_mean_turn_mae_deg",
            "worst_p95_rate_disagreement_deg",
        ),
        recomputed_score[:4],
    ):
        check(math.isclose(recorded_score[key], value, abs_tol=1e-12), f"score mismatch: {key}")
        check(
            math.isclose(
                result_manifest["best_diagnostic_only"][key],
                value,
                abs_tol=1e-12,
            ),
            f"manifest score mismatch: {key}",
        )

    check(
        {item["sequence"] for item in report["sequence_metadata"]}
        == development_names,
        "development sequence metadata mismatch",
    )
    for sequence in report["sequence_metadata"]:
        check(len(sequence["data_hdf5_sha256"]) == 64, "missing artifact hash")
        for rate in ("50", "100"):
            diagnostics = sequence["prepared_signal_diagnostics"][rate]
            check(9.0 <= diagnostics["reference_mean_z_mps2"] <= 10.5, "gravity Z sanity failed")
            check(diagnostics["horizontal_mean_magnitude_mps2"] <= 0.1, "horizontal gravity sanity failed")
            check(0.0 <= diagnostics["orientation_lag_p95_ms"] <= 50.0, "orientation lag sanity failed")
    for sequence in report["best_diagnostic_callback_batch_invariance"]:
        check(all(sequence["rates"].values()), f"batch invariance failed: {sequence['sequence']}")

    check(audit["schema_version"] == 1, "unexpected model-audit schema")
    check(audit["evidence_kind"] == "metadata-only-benchmark-audit", "wrong audit kind")
    check(audit["artifact"]["checkpoint_deserialized"] is False, "checkpoint was loaded")
    check(audit["artifact"]["download_bytes"] <= 5 * 1024 * 1024, "download bound exceeded")
    check(
        audit["artifact"]["sha256"] == model_manifest["artifact"]["sha256"],
        "model archive hash mismatch",
    )
    members = {member["name"]: member for member in audit["artifact"]["members"]}
    checkpoint_name = model_manifest["artifact"]["checkpoint_member"]
    config_name = model_manifest["artifact"]["config_member"]
    check(members[checkpoint_name]["sha256"] == model_manifest["artifact"]["checkpoint_sha256"], "checkpoint member hash mismatch")
    check(members[checkpoint_name]["deserialized"] is False, "checkpoint member was deserialized")
    check(members[config_name]["sha256"] == model_manifest["artifact"]["config_sha256"], "config hash mismatch")
    config = next(item["content"] for item in audit["configuration"] if item["member"] == config_name)
    check(config["window_size"] == 1000, "official window changed")
    check(audit["input_contract"]["required_rate_hz"] == 200, "official rate changed")
    check(audit["input_contract"]["unroll_seconds"] == 5.0, "official unroll changed")
    check(all(audit["official_text_evidence"]["claim_checks"].values()), "official text claims not verified")
    check(audit["code"]["revision"] == model_manifest["provenance"]["code_revision"], "code revision mismatch")
    check(audit["decision"] == model_manifest["decision"], "model decision mismatch")
    check(audit["decision"] == "benchmark-demo-only-do-not-run-or-ship", "model claim weakened")
    check(result_manifest["decision"] == report["development_decision"], "result decision mismatch")

    print(
        json.dumps(
            {
                "assertions": assertion_count,
                "candidate_count": len(candidates),
                "eligible_candidate_count": len(eligible),
                "development_decision": report["development_decision"],
                "validation_sequences_fetched": 0,
                "checkpoint_deserialized": False,
                "model_decision": audit["decision"],
                "status": "pass",
            },
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
