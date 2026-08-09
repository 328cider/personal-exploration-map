"""Independent QA for the direct circular heading development experiment."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import statistics


ROOT = Path(__file__).resolve().parents[1]
PROTOCOL_PATH = ROOT / "DIRECT_HEADING_PROTOCOL.md"
SPLIT_PATH = ROOT / "datasets" / "splits" / "ronin-direct-heading-v1.json"
EXPECTED_IMPLEMENTATION_PATHS = {
    "pdr_research/direct_heading.py",
    "pdr_research/learned_heading.py",
    "pdr_research/body_heading_evaluation.py",
    "pdr_research/ronin.py",
    "scripts/analyze_direct_heading.py",
}


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def score(candidate: dict[str, object]) -> tuple[float, float, float, float, str]:
    heading = []
    turn = []
    p95 = []
    for fold in candidate["folds"]:
        heading.append(
            statistics.fmean(
                fold["rates"][rate]["metrics"]["heading_mae_deg"]
                for rate in ("50", "100")
            )
        )
        turn.append(
            statistics.fmean(
                fold["rates"][rate]["metrics"]["turn_angle_mae_deg"]
                for rate in ("50", "100")
            )
        )
        p95.append(fold["rate_comparison"]["p95_disagreement_deg"])
    return (
        max(heading),
        statistics.fmean(heading),
        statistics.fmean(turn),
        max(p95),
        candidate["config"]["config_id"],
    )


def rejections(candidate: dict[str, object]) -> list[str]:
    reasons = []
    config = candidate["config"]
    headings = []
    turns = []
    baselines = []
    for fold in candidate["folds"]:
        sequence = fold["held_out_sequence"]
        for rate in ("50", "100"):
            metrics = fold["rates"][rate]["metrics"]
            baseline = fold["device_baselines"][rate]["metrics"]
            headings.append(metrics["heading_mae_deg"])
            turns.append(metrics["turn_angle_mae_deg"])
            baselines.append(baseline["heading_mae_deg"])
            if metrics["future_sample_violations"]:
                reasons.append(f"{sequence}/{rate}:future-sample")
            if metrics["output_grid_coverage"] < 0.95:
                reasons.append(f"{sequence}/{rate}:coverage")
            if metrics["fresh_output_fraction"] < 0.95:
                reasons.append(f"{sequence}/{rate}:freshness")
            if metrics["initialization_latency_s"] > config["window_s"] + 0.2:
                reasons.append(f"{sequence}/{rate}:initialization")
        comparison = fold["rate_comparison"]
        if comparison["median_disagreement_deg"] > 5.0:
            reasons.append(f"{sequence}:median-rate-disagreement")
        if comparison["p95_disagreement_deg"] > 20.0:
            reasons.append(f"{sequence}:p95-rate-disagreement")
    sequence_means = [
        statistics.fmean(
            fold["rates"][rate]["metrics"]["heading_mae_deg"]
            for rate in ("50", "100")
        )
        for fold in candidate["folds"]
    ]
    improvement = (
        statistics.fmean(baselines) - statistics.fmean(headings)
    ) / statistics.fmean(baselines)
    if max(sequence_means) >= 75.0:
        reasons.append("aggregate:worst-heading-mae")
    if statistics.fmean(turns) >= 45.0:
        reasons.append("aggregate:turn-mae")
    if improvement < 0.15:
        reasons.append("aggregate:device-heading-improvement")
    return reasons


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--development", type=Path, required=True)
    parser.add_argument("--data-root", type=Path, default=Path("/data/ronin"))
    parser.add_argument(
        "--model-path",
        type=Path,
        default=Path("/workspace/research/pdr/models/ronin-direct-heading-v1.json"),
    )
    args = parser.parse_args()

    report = json.loads(args.development.read_text(encoding="utf-8"))
    split = json.loads(SPLIT_PATH.read_text(encoding="utf-8"))
    assertions = 0

    def check(condition: bool, message: str) -> None:
        nonlocal assertions
        assertions += 1
        if not condition:
            raise AssertionError(message)

    check(report["schema_version"] == 1, "unexpected report schema")
    check(report["phase"] == "development", "report is not development")
    check(report["experiment"] == split["experiment"], "experiment mismatch")
    check(report["protocol_sha256"] == sha256_file(PROTOCOL_PATH), "protocol hash mismatch")
    check(report["split_sha256"] == sha256_file(SPLIT_PATH), "split hash mismatch")
    check(report["source_adapter_id"] == "ronin-raw-hdf5-v2", "adapter changed")
    check(
        set(report["implementation_sha256"]) == EXPECTED_IMPLEMENTATION_PATHS,
        "implementation scope changed",
    )
    for relative, expected in report["implementation_sha256"].items():
        check(sha256_file(ROOT / relative) == expected, f"implementation changed: {relative}")

    parent = ROOT / "datasets" / "splits" / split["parent_split"]
    check(sha256_file(parent) == split["parent_split_sha256"], "parent split changed")
    development_ids = [item["sequence"] for item in split["development_assignments"]]
    validation_ids = [item["sequence"] for item in split["validation_assignments"]]
    check(not set(development_ids) & set(validation_ids), "split overlap")
    check(
        len({item["subject_key"] for item in split["development_assignments"]}) == 4,
        "development groups overlap",
    )
    check(
        len({item["subject_key"] for item in split["validation_assignments"]}) == 3,
        "validation groups overlap",
    )
    check(
        {item["sequence"] for item in report["sequence_metadata"]}
        == set(development_ids),
        "development metadata mismatch",
    )
    for sequence in validation_ids:
        check(
            report["validation_state"][sequence] == "not-fetched",
            f"validation state changed: {sequence}",
        )
        check(
            not (args.data_root / sequence).exists(),
            f"validation sequence was fetched: {sequence}",
        )
    check(not args.model_path.exists(), "failed development unexpectedly wrote weights")
    check(
        not (args.development.parent / "ronin-direct-heading-validation-v1.json").exists(),
        "validation output exists after development Stop",
    )

    candidates = report["candidates"]
    check(len(candidates) == report["candidate_count"] == 24, "candidate count changed")
    ids = [candidate["config"]["config_id"] for candidate in candidates]
    check(len(ids) == len(set(ids)), "candidate IDs overlap")
    check(
        {candidate["config"]["window_s"] for candidate in candidates}
        == {0.5, 1.0},
        "window grid changed",
    )
    check(
        {candidate["config"]["reservoir_leak"] for candidate in candidates}
        == {0.25, 0.75},
        "leak grid changed",
    )
    check(
        {candidate["config"]["recurrent_gain"] for candidate in candidates}
        == {0.5, 0.9},
        "gain grid changed",
    )
    check(
        {candidate["config"]["readout_ridge_alpha"] for candidate in candidates}
        == {1.0, 100.0, 10000.0},
        "alpha grid changed",
    )
    check(
        {candidate["config"]["reservoir_size"] for candidate in candidates} == {64},
        "reservoir size changed",
    )
    check(
        {candidate["config"]["reservoir_seed"] for candidate in candidates}
        == {20260809},
        "reservoir seed changed",
    )

    metadata = {item["sequence"]: item for item in report["sequence_metadata"]}
    baseline_by_key: dict[tuple[str, float, str], dict[str, object]] = {}
    for candidate in candidates:
        config = candidate["config"]
        config_id = config["config_id"]
        check(config["input_scale"] == 0.25, f"input scale changed: {config_id}")
        check(config["bias_scale"] == 0.1, f"bias scale changed: {config_id}")
        check(config["turn_weight"] == 4.0, f"turn weight changed: {config_id}")
        check(config["output_rate_hz"] == 10, f"output rate changed: {config_id}")
        check(len(candidate["folds"]) == 4, f"fold count changed: {config_id}")
        held_out = {fold["held_out_sequence"] for fold in candidate["folds"]}
        check(held_out == set(development_ids), f"fold coverage changed: {config_id}")
        for fold in candidate["folds"]:
            sequence = fold["held_out_sequence"]
            check(sequence not in fold["training_sequences"], f"held-out leakage: {config_id}")
            check(len(fold["training_sequences"]) == 3, f"training group count: {config_id}")
            check(len(fold["fold_model_sha256"]) == 64, f"model hash missing: {config_id}")
            check(fold["training_row_count"] > 0, f"no training rows: {config_id}")
            for rate in ("50", "100"):
                metrics = fold["rates"][rate]["metrics"]
                expected_rows = metadata[sequence]["feature_row_counts"][
                    f"{config['window_s']:g}s/{rate}hz"
                ]
                check(metrics["output_count"] == expected_rows, f"output rows changed: {config_id}")
                check(metrics["future_sample_violations"] == 0, f"future sample: {config_id}")
                check(metrics["fresh_output_fraction"] > 0.0, f"no fresh output: {config_id}")
                key = (sequence, config["window_s"], rate)
                baseline = fold["device_baselines"][rate]
                if key in baseline_by_key:
                    check(baseline == baseline_by_key[key], f"baseline changed: {config_id}")
                else:
                    baseline_by_key[key] = baseline
        independent_rejections = rejections(candidate)
        check(
            independent_rejections == candidate["rejection_reasons"],
            f"rejection mismatch: {config_id}",
        )
        check(
            candidate["eligible"] == (not independent_rejections),
            f"eligibility mismatch: {config_id}",
        )
        independent_score = score(candidate)
        for key, value in zip(
            (
                "worst_sequence_mean_heading_mae_deg",
                "subject_balanced_mean_heading_mae_deg",
                "subject_balanced_mean_turn_mae_deg",
                "worst_p95_rate_disagreement_deg",
            ),
            independent_score[:4],
        ):
            check(
                abs(candidate["ranking_score"][key] - value) <= 1e-12,
                f"score mismatch: {config_id}/{key}",
            )

    eligible = [candidate for candidate in candidates if candidate["eligible"]]
    check(not eligible, "a candidate unexpectedly survived")
    check(report["eligible_candidate_count"] == 0, "eligible count changed")
    check(report["selected_config_id"] is None, "failed candidate selected")
    check(report["selected_config"] is None, "failed config frozen")
    check(report["selected_model"] is None, "failed model frozen")
    check(
        report["development_decision"]
        == "stop-no-direct-heading-candidate-survived-development",
        "Stop decision weakened",
    )
    diagnostic = min(
        candidates,
        key=lambda candidate: (len(candidate["rejection_reasons"]), score(candidate)),
    )
    check(
        diagnostic["config"]["config_id"] == report["best_diagnostic_config_id"],
        "diagnostic ranking mismatch",
    )
    check(
        diagnostic["ranking_score"] == report["best_diagnostic_score"],
        "diagnostic score mismatch",
    )

    for sequence in report["sequence_metadata"]:
        check(len(sequence["data_hdf5_sha256"]) == 64, "missing dataset hash")
        check(
            sequence["subject_key"] == sequence["sequence"].split("_", 1)[0],
            "subject key mismatch",
        )
        check(len(sequence["feature_row_counts"]) == 4, "rate/window coverage changed")
        check(
            all(count > 0 for count in sequence["feature_row_counts"].values()),
            "empty feature rows",
        )

    print(
        json.dumps(
            {
                "assertions": assertions,
                "candidate_count": len(candidates),
                "fold_count": sum(len(candidate["folds"]) for candidate in candidates),
                "eligible_candidate_count": 0,
                "validation_sequences_fetched": 0,
                "model_written": False,
                "development_decision": report["development_decision"],
                "status": "pass",
            },
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
