"""Rank or validate the preregistered causal body-heading candidate family."""

from __future__ import annotations

import argparse
from dataclasses import asdict
import hashlib
import json
import math
from pathlib import Path
import statistics
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from pdr_research.body_heading import (  # noqa: E402
    ACCELEROMETER,
    GAME_ROTATION_VECTOR,
    CANDIDATE_CONFIGS,
    BodyHeadingConfig,
    estimate_body_heading,
    estimate_device_heading_baseline,
    estimate_prepared_body_heading,
    get_body_heading_config,
    prepare_heading_signal,
)
from pdr_research.body_heading_evaluation import (  # noqa: E402
    compare_heading_rates,
    evaluate_body_heading,
)
from pdr_research.ronin import load_ronin_raw_fixture  # noqa: E402
from pdr_research.synthetic import rebatch_session  # noqa: E402


SPLIT_PATH = ROOT / "datasets" / "splits" / "ronin-body-heading-v1.json"
IMPLEMENTATION_PATHS = (
    ROOT / "pdr_research" / "body_heading.py",
    ROOT / "pdr_research" / "body_heading_evaluation.py",
    ROOT / "pdr_research" / "ronin.py",
    ROOT / "scripts" / "analyze_body_heading.py",
)
SOURCE_ADAPTER_ID = "ronin-raw-hdf5-v2"


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def _artifact_hash(sequence_root: Path) -> tuple[str, dict[str, object]]:
    manifest = json.loads(
        (sequence_root / "artifact_manifest.json").read_text(encoding="utf-8")
    )
    hdf_member = next(
        member
        for member in manifest["members"]
        if member["output_name"] == "data.hdf5"
    )
    actual_hash = file_sha256(sequence_root / "data.hdf5")
    if actual_hash != hdf_member["sha256"]:
        raise ValueError(f"{sequence_root.name}: HDF5 hash no longer matches manifest")
    return actual_hash, manifest


def _session_start_ns(session) -> int:
    relevant = [
        sample.sensor_timestamp_ns
        for sample in session.samples
        if sample.sensor_type in {ACCELEROMETER, GAME_ROTATION_VECTOR}
    ]
    if not relevant:
        raise ValueError("Body-heading session has no relevant samples")
    return min(relevant)


def _prepared_signal_diagnostics(signal) -> dict[str, float | int]:
    if not signal.samples:
        return {"sample_count": 0}
    orientation_lag_ms = sorted(
        (sample.timestamp_ns - sample.orientation_timestamp_ns) / 1_000_000
        for sample in signal.samples
    )
    p95_index = max(0, math.ceil(0.95 * len(orientation_lag_ms)) - 1)
    mean_x = statistics.fmean(sample.x_mps2 for sample in signal.samples)
    mean_y = statistics.fmean(sample.y_mps2 for sample in signal.samples)
    return {
        "sample_count": len(signal.samples),
        "reference_mean_x_mps2": mean_x,
        "reference_mean_y_mps2": mean_y,
        "reference_mean_z_mps2": statistics.fmean(
            sample.z_mps2 for sample in signal.samples
        ),
        "horizontal_mean_magnitude_mps2": math.hypot(mean_x, mean_y),
        "orientation_lag_median_ms": statistics.median(orientation_lag_ms),
        "orientation_lag_p95_ms": orientation_lag_ms[p95_index],
    }


def _evaluate_run(fixture, run) -> dict[str, object]:
    evaluation = evaluate_body_heading(
        session_id=fixture.session.session_id,
        truth=fixture.ground_truth,
        run=run,
        session_start_ns=_session_start_ns(fixture.session),
    )
    return {
        "estimator": evaluation.estimator,
        "version": evaluation.version,
        "metrics": evaluation.metrics,
        "failure_flags": list(evaluation.failure_flags),
    }


def _load_pair(sequence_root: Path, artifact_hash: str):
    return {
        rate: load_ronin_raw_fixture(
            data_path=sequence_root / "data.hdf5",
            info_path=sequence_root / "info.json",
            member_sha256=artifact_hash,
            target_rate_hz=rate,
        )
        for rate in (50, 100)
    }


def _sequence_result(
    *,
    sequence: str,
    fixtures,
    prepared,
    config: BodyHeadingConfig,
) -> tuple[dict[str, object], dict[int, object]]:
    runs = {
        rate: estimate_prepared_body_heading(prepared[rate], config=config)
        for rate in (50, 100)
    }
    if not all(run.supported for run in runs.values()):
        missing = {
            str(rate): list(run.missing_requirements)
            for rate, run in runs.items()
            if not run.supported
        }
        raise AssertionError(f"{sequence}/{config.config_id} unsupported: {missing}")
    evaluations = {
        str(rate): _evaluate_run(fixtures[rate], runs[rate]) for rate in (50, 100)
    }
    rate_comparison = compare_heading_rates(runs[50], runs[100])
    record = {
        "sequence": sequence,
        "rates": evaluations,
        "rate_comparison": asdict(rate_comparison),
    }
    return record, runs


def _development_rejection_reasons(record: dict[str, object]) -> list[str]:
    reasons = []
    for sequence in record["sequences"]:
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


def _development_score(record: dict[str, object]) -> tuple[float, float, float, float, str]:
    sequence_mae = []
    sequence_turn_mae = []
    rate_p95 = []
    for sequence in record["sequences"]:
        sequence_mae.append(
            statistics.fmean(
                sequence["rates"][rate]["metrics"]["heading_mae_deg"]
                for rate in ("50", "100")
            )
        )
        sequence_turn_mae.append(
            statistics.fmean(
                sequence["rates"][rate]["metrics"]["turn_angle_mae_deg"]
                for rate in ("50", "100")
            )
        )
        rate_p95.append(sequence["rate_comparison"]["p95_disagreement_deg"])
    return (
        max(sequence_mae),
        statistics.fmean(sequence_mae),
        statistics.fmean(sequence_turn_mae),
        max(rate_p95),
        record["config"]["config_id"],
    )


def _validation_checks(
    *, sequence_record: dict[str, object], baseline_record: dict[str, object]
) -> dict[str, bool]:
    checks: dict[str, bool] = {}
    for rate in ("50", "100"):
        metrics = sequence_record["rates"][rate]["metrics"]
        baseline = baseline_record["rates"][rate]["metrics"]
        improvement = (
            (baseline["heading_mae_deg"] - metrics["heading_mae_deg"])
            / baseline["heading_mae_deg"]
            if baseline["heading_mae_deg"]
            else -math.inf
        )
        checks[f"{rate}hz_zero_future_sample_violations"] = (
            metrics["future_sample_violations"] == 0
        )
        checks[f"{rate}hz_initialization_within_5s"] = (
            metrics["initialization_latency_s"] <= 5.0
        )
        checks[f"{rate}hz_fresh_output_at_least_25pct"] = (
            metrics["fresh_output_fraction"] >= 0.25
        )
        checks[f"{rate}hz_heading_mae_below_45deg"] = (
            metrics["heading_mae_deg"] < 45.0
        )
        checks[f"{rate}hz_turn_mae_at_most_30deg"] = (
            metrics["turn_angle_mae_deg"] <= 30.0
        )
        checks[f"{rate}hz_device_yaw_improvement_at_least_20pct"] = (
            improvement >= 0.20
        )
    comparison = sequence_record["rate_comparison"]
    checks["median_rate_disagreement_at_most_3deg"] = (
        comparison["median_disagreement_deg"] <= 3.0
    )
    checks["p95_rate_disagreement_at_most_10deg"] = (
        comparison["p95_disagreement_deg"] <= 10.0
    )
    return checks


def _base_payload(*, phase: str, split: dict[str, object]) -> dict[str, object]:
    return {
        "schema_version": 1,
        "experiment": split["experiment"],
        "phase": phase,
        "evidence_kind": "public-sequence-benchmark-only",
        "split_path": str(SPLIT_PATH.relative_to(ROOT)),
        "split_sha256": file_sha256(SPLIT_PATH),
        "source_adapter_id": SOURCE_ADAPTER_ID,
        "implementation_sha256": {
            str(path.relative_to(ROOT)): file_sha256(path)
            for path in IMPLEMENTATION_PATHS
        },
        "input_contract": {
            "live_inputs": [
                "raw/imu/acce timestamp and x/y/z",
                "raw/imu/game_rv timestamp and x/y/z/w",
            ],
            "android_mapping": [
                "Sensor.TYPE_ACCELEROMETER",
                "Sensor.TYPE_GAME_ROTATION_VECTOR",
                "SensorEvent.timestamp",
                "SensorEvent.values",
            ],
            "evaluation_only": [
                "synced/time",
                "pose/tango_pos",
                "pose/tango_ori",
                "info/start_frame",
                "info/imu_time_offset",
                "info/align_tango_to_body",
            ],
            "forbidden": [
                "pose/ekf_ori",
                "future trajectory",
                "completed route shape",
                "body-heading truth as inference input",
            ],
        },
    }


def analyze_development(
    *, sequence_roots: list[Path], output: Path, split: dict[str, object]
) -> None:
    expected = {
        item["sequence"] for item in split["development_assignments"]
    }
    actual = {root.name for root in sequence_roots}
    if actual != expected:
        raise ValueError(f"Development roots {sorted(actual)} != split {sorted(expected)}")

    candidate_records = {
        config.config_id: {"config": asdict(config), "sequences": []}
        for config in CANDIDATE_CONFIGS
    }
    baselines = []
    sequence_metadata = []
    winner_runs_by_sequence: dict[str, dict[int, object]] = {}

    for sequence_root in sorted(sequence_roots, key=lambda path: path.name):
        artifact_hash, manifest = _artifact_hash(sequence_root)
        info = json.loads((sequence_root / "info.json").read_text(encoding="utf-8"))
        fixtures = _load_pair(sequence_root, artifact_hash)
        prepared = {
            rate: prepare_heading_signal(fixture.session)
            for rate, fixture in fixtures.items()
        }
        baseline_record = {"sequence": sequence_root.name, "rates": {}}
        for rate in (50, 100):
            baseline = estimate_device_heading_baseline(fixtures[rate].session)
            baseline_record["rates"][str(rate)] = _evaluate_run(
                fixtures[rate], baseline
            )
        baselines.append(baseline_record)

        for config in CANDIDATE_CONFIGS:
            sequence_record, _ = _sequence_result(
                sequence=sequence_root.name,
                fixtures=fixtures,
                prepared=prepared,
                config=config,
            )
            candidate_records[config.config_id]["sequences"].append(sequence_record)

        sequence_metadata.append(
            {
                "sequence": sequence_root.name,
                "device": info.get("device", "unknown"),
                "data_hdf5_sha256": artifact_hash,
                "http_range_bytes": manifest["archive"]["http_bytes_transferred"],
                "prepared_signal_diagnostics": {
                    str(rate): _prepared_signal_diagnostics(prepared[rate])
                    for rate in (50, 100)
                },
            }
        )

    ranked = []
    for record in candidate_records.values():
        reasons = _development_rejection_reasons(record)
        score = _development_score(record)
        record["eligible"] = not reasons
        record["rejection_reasons"] = reasons
        record["ranking_score"] = {
            "worst_sequence_mean_heading_mae_deg": score[0],
            "subject_balanced_mean_heading_mae_deg": score[1],
            "subject_balanced_mean_turn_mae_deg": score[2],
            "worst_p95_rate_disagreement_deg": score[3],
            "lexical_config_id": score[4],
        }
        if not reasons:
            ranked.append((score, record))
    ranked.sort(key=lambda item: item[0])
    diagnostic_ranked = sorted(
        candidate_records.values(),
        key=lambda record: (
            len(record["rejection_reasons"]),
            _development_score(record),
        ),
    )
    winner = ranked[0][1] if ranked else None
    diagnostic_candidate = winner or diagnostic_ranked[0]

    # Callback batching is checked only for the selected config; callback time is
    # not an estimator input, so this is an exact equality invariant.
    winner_config = get_body_heading_config(
        diagnostic_candidate["config"]["config_id"]
    )
    winner_batch_checks = []
    for sequence_root in sorted(sequence_roots, key=lambda path: path.name):
        artifact_hash, _ = _artifact_hash(sequence_root)
        fixtures = _load_pair(sequence_root, artifact_hash)
        checks = {}
        winner_runs_by_sequence[sequence_root.name] = {}
        for rate in (50, 100):
            original = estimate_body_heading(
                fixtures[rate].session, config=winner_config
            )
            batched = estimate_body_heading(
                rebatch_session(fixtures[rate].session, batch_latency_ms=250),
                config=winner_config,
            )
            checks[str(rate)] = original == batched
            winner_runs_by_sequence[sequence_root.name][rate] = original
        winner_batch_checks.append(
            {"sequence": sequence_root.name, "rates": checks}
        )

    payload = _base_payload(phase="development", split=split)
    payload.update(
        {
            "sequence_metadata": sequence_metadata,
            "candidate_count": len(candidate_records),
            "eligible_candidate_count": len(ranked),
            "selected_config_id": winner_config.config_id if winner else None,
            "selected_config": asdict(winner_config) if winner else None,
            "selected_rank": 1 if winner else None,
            "development_decision": (
                "freeze-selected-candidate"
                if winner
                else "stop-no-candidate-survived-preregistered-gates"
            ),
            "best_diagnostic_config_id": winner_config.config_id,
            "best_diagnostic_config": asdict(winner_config),
            "best_diagnostic_rejection_reasons": diagnostic_candidate[
                "rejection_reasons"
            ],
            "best_diagnostic_callback_batch_invariance": winner_batch_checks,
            "device_heading_baselines": baselines,
            "candidates": sorted(
                candidate_records.values(),
                key=lambda record: record["config"]["config_id"],
            ),
            "selection_rule": (
                "Reject by preregistered causality/init/fresh/rate gates, then "
                "lexicographically rank the five locked score fields."
            ),
            "validation_state": {
                item["sequence"]: item["raw_state_at_registration"]
                for item in split["validation_assignments"]
            },
        }
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(
        json.dumps(payload, indent=2, ensure_ascii=False, allow_nan=False) + "\n",
        encoding="utf-8",
    )
    print(
        json.dumps(
            {
                "phase": "development",
                "candidate_count": len(candidate_records),
                "eligible_candidate_count": len(ranked),
                "selected_config_id": winner_config.config_id if winner else None,
                "development_decision": (
                    "freeze-selected-candidate"
                    if winner
                    else "stop-no-candidate-survived-preregistered-gates"
                ),
                "best_diagnostic_config_id": winner_config.config_id,
                "best_diagnostic_score": diagnostic_candidate["ranking_score"],
                "best_diagnostic_rejection_reasons": diagnostic_candidate[
                    "rejection_reasons"
                ],
                "output": str(output),
            },
            sort_keys=True,
        )
    )


def analyze_validation(
    *,
    sequence_roots: list[Path],
    output: Path,
    split: dict[str, object],
    frozen_spec_path: Path,
) -> None:
    frozen = json.loads(frozen_spec_path.read_text(encoding="utf-8"))
    expected = {item["sequence"] for item in split["validation_assignments"]}
    actual = {root.name for root in sequence_roots}
    if actual != expected:
        raise ValueError(f"Validation roots {sorted(actual)} != split {sorted(expected)}")
    if frozen["split_sha256"] != file_sha256(SPLIT_PATH):
        raise ValueError("Frozen split hash changed")
    current_hashes = {
        str(path.relative_to(ROOT)): file_sha256(path) for path in IMPLEMENTATION_PATHS
    }
    if frozen["implementation_sha256"] != current_hashes:
        raise ValueError("Frozen body-heading implementation hash changed")
    config = get_body_heading_config(frozen["config_id"])
    if frozen["config"] != asdict(config):
        raise ValueError("Frozen body-heading config no longer matches registry")

    sequence_records = []
    baseline_records = []
    sequence_metadata = []
    for sequence_root in sorted(sequence_roots, key=lambda path: path.name):
        artifact_hash, manifest = _artifact_hash(sequence_root)
        info = json.loads((sequence_root / "info.json").read_text(encoding="utf-8"))
        fixtures = _load_pair(sequence_root, artifact_hash)
        prepared = {
            rate: prepare_heading_signal(fixture.session)
            for rate, fixture in fixtures.items()
        }
        sequence_record, runs = _sequence_result(
            sequence=sequence_root.name,
            fixtures=fixtures,
            prepared=prepared,
            config=config,
        )
        baseline_record = {"sequence": sequence_root.name, "rates": {}}
        for rate in (50, 100):
            baseline = estimate_device_heading_baseline(fixtures[rate].session)
            baseline_record["rates"][str(rate)] = _evaluate_run(
                fixtures[rate], baseline
            )
        batch_invariance = {
            str(rate): runs[rate]
            == estimate_body_heading(
                rebatch_session(fixtures[rate].session, batch_latency_ms=250),
                config=config,
            )
            for rate in (50, 100)
        }
        checks = _validation_checks(
            sequence_record=sequence_record, baseline_record=baseline_record
        )
        checks["callback_batch_invariant"] = all(batch_invariance.values())
        sequence_record["callback_batch_invariance"] = batch_invariance
        sequence_record["primary_checks"] = checks
        sequence_record["primary_pass"] = all(checks.values())
        sequence_records.append(sequence_record)
        baseline_records.append(baseline_record)
        sequence_metadata.append(
            {
                "sequence": sequence_root.name,
                "device": info.get("device", "unknown"),
                "data_hdf5_sha256": artifact_hash,
                "http_range_bytes": manifest["archive"]["http_bytes_transferred"],
                "prepared_signal_diagnostics": {
                    str(rate): _prepared_signal_diagnostics(prepared[rate])
                    for rate in (50, 100)
                },
            }
        )

    all_heading_mae = [
        record["rates"][rate]["metrics"]["heading_mae_deg"]
        for record in sequence_records
        for rate in ("50", "100")
    ]
    all_turn_mae = [
        record["rates"][rate]["metrics"]["turn_angle_mae_deg"]
        for record in sequence_records
        for rate in ("50", "100")
    ]
    research_pass = all(record["primary_pass"] for record in sequence_records)
    narrow_quality = (
        research_pass
        and statistics.median(all_heading_mae) <= 20.0
        and max(all_turn_mae) <= 20.0
    )
    payload = _base_payload(phase="validation", split=split)
    payload.update(
        {
            "frozen_spec_path": str(frozen_spec_path.relative_to(ROOT)),
            "frozen_spec_sha256": file_sha256(frozen_spec_path),
            "config_id": config.config_id,
            "config": asdict(config),
            "sequence_metadata": sequence_metadata,
            "device_heading_baselines": baseline_records,
            "sequences": sequence_records,
            "aggregate": {
                "heading_mae_median_deg": statistics.median(all_heading_mae),
                "heading_mae_max_deg": max(all_heading_mae),
                "turn_mae_median_deg": statistics.median(all_turn_mae),
                "turn_mae_max_deg": max(all_turn_mae),
                "research_gate_pass": research_pass,
                "narrow_quality_gate_pass": narrow_quality,
            },
            "decision": (
                "retain-platform-fused-research-candidate"
                if research_pass
                else "stop-frozen-classical-pca-family"
            ),
        }
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(
        json.dumps(payload, indent=2, ensure_ascii=False, allow_nan=False) + "\n",
        encoding="utf-8",
    )
    print(
        json.dumps(
            {
                "phase": "validation",
                "config_id": config.config_id,
                **payload["aggregate"],
                "output": str(output),
            },
            sort_keys=True,
        )
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--phase", choices=("development", "validation"), required=True)
    parser.add_argument("--sequence-root", type=Path, action="append", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--frozen-spec", type=Path)
    args = parser.parse_args()
    split = json.loads(SPLIT_PATH.read_text(encoding="utf-8"))
    if args.phase == "development":
        if args.frozen_spec is not None:
            parser.error("--frozen-spec is valid only for validation")
        analyze_development(
            sequence_roots=args.sequence_root, output=args.output, split=split
        )
    else:
        if args.frozen_spec is None:
            parser.error("--frozen-spec is required for validation")
        analyze_validation(
            sequence_roots=args.sequence_root,
            output=args.output,
            split=split,
            frozen_spec_path=args.frozen_spec,
        )


if __name__ == "__main__":
    main()
