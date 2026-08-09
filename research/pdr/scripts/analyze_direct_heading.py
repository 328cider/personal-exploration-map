"""Run the preregistered benchmark-only direct circular heading experiment."""

from __future__ import annotations

import argparse
from bisect import bisect_right
from dataclasses import asdict
import hashlib
import json
import math
from pathlib import Path
import statistics
import sys

import numpy as np


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from pdr_research.body_heading_evaluation import (  # noqa: E402
    compare_heading_rates,
    evaluate_body_heading,
)
from pdr_research.direct_heading import (  # noqa: E402
    CANDIDATE_CONFIGS,
    DirectHeadingConfig,
    build_direct_inputs,
    fit_direct_circular_readout,
    model_sha256,
    predict_direct_heading,
    read_model,
    write_model,
)
from pdr_research.learned_heading import (  # noqa: E402
    CANDIDATE_CONFIGS as LEARNED_CONFIGS,
    extract_learned_features,
    predict_device_heading_series,
)
from pdr_research.ronin import load_ronin_raw_fixture  # noqa: E402


SPLIT_PATH = ROOT / "datasets" / "splits" / "ronin-direct-heading-v1.json"
PROTOCOL_PATH = ROOT / "DIRECT_HEADING_PROTOCOL.md"
IMPLEMENTATION_PATHS = (
    ROOT / "pdr_research" / "direct_heading.py",
    ROOT / "pdr_research" / "learned_heading.py",
    ROOT / "pdr_research" / "body_heading_evaluation.py",
    ROOT / "pdr_research" / "ronin.py",
    ROOT / "scripts" / "analyze_direct_heading.py",
)
SOURCE_ADAPTER_ID = "ronin-raw-hdf5-v2"


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def wrap_angle(angle: float) -> float:
    return (angle + math.pi) % (2.0 * math.pi) - math.pi


def artifact_hash(sequence_root: Path) -> tuple[str, dict[str, object]]:
    manifest = json.loads(
        (sequence_root / "artifact_manifest.json").read_text(encoding="utf-8")
    )
    member = next(
        item for item in manifest["members"] if item["output_name"] == "data.hdf5"
    )
    actual = file_sha256(sequence_root / "data.hdf5")
    if actual != member["sha256"]:
        raise ValueError(f"{sequence_root.name}: HDF5 hash mismatch")
    return actual, manifest


def session_start_ns(session) -> int:
    relevant = [
        sample.sensor_timestamp_ns
        for sample in session.samples
        if sample.sensor_type
        in {
            "TYPE_ACCELEROMETER",
            "TYPE_GYROSCOPE",
            "TYPE_GAME_ROTATION_VECTOR",
        }
    ]
    if not relevant:
        raise ValueError("Direct-heading session has no required samples")
    return min(relevant)


def interpolate_heading(truth, timestamp_ns: int, timestamps: tuple[int, ...]) -> float:
    right = bisect_right(timestamps, timestamp_ns)
    if right <= 0:
        return float(truth[0].body_heading_rad)
    if right >= len(truth):
        return float(truth[-1].body_heading_rad)
    left_point = truth[right - 1]
    right_point = truth[right]
    interval = right_point.timestamp_ns - left_point.timestamp_ns
    fraction = (timestamp_ns - left_point.timestamp_ns) / interval if interval else 0.0
    delta = wrap_angle(right_point.body_heading_rad - left_point.body_heading_rad)
    return wrap_angle(left_point.body_heading_rad + delta * fraction)


def circular_supervision(series, truth) -> tuple[np.ndarray, np.ndarray]:
    timestamps = tuple(point.timestamp_ns for point in truth)
    targets = []
    rates = []
    anchor = None
    previous_heading = None
    previous_timestamp = None
    for row in series.rows:
        heading = interpolate_heading(truth, row.timestamp_ns, timestamps)
        if row.segment_start or anchor is None:
            anchor = heading
            relative = 0.0
            rate = 0.0
        else:
            elapsed_s = (row.timestamp_ns - previous_timestamp) / 1_000_000_000
            if elapsed_s <= 0.0:
                raise AssertionError("Non-positive circular-supervision interval")
            relative = wrap_angle(heading - anchor)
            rate = wrap_angle(heading - previous_heading) / elapsed_s
        targets.append((math.sin(relative), math.cos(relative)))
        rates.append(rate)
        previous_heading = heading
        previous_timestamp = row.timestamp_ns
    if not targets:
        raise ValueError(f"{series.session_id}: no circular-supervision rows")
    return np.asarray(targets, dtype=float), np.asarray(rates, dtype=float)


def learned_config(window_s: float):
    return next(config for config in LEARNED_CONFIGS if config.window_s == window_s)


def prepare_sequence(sequence_root: Path) -> dict[str, object]:
    member_hash, artifact_manifest = artifact_hash(sequence_root)
    info = json.loads((sequence_root / "info.json").read_text(encoding="utf-8"))
    result: dict[str, object] = {
        "sequence": sequence_root.name,
        "subject_key": sequence_root.name.split("_", 1)[0],
        "device": info.get("device", "unknown"),
        "artifact_sha256": member_hash,
        "http_range_bytes": artifact_manifest["archive"]["http_bytes_transferred"],
        "direct": {},
        "learned": {},
        "targets": {},
        "body_rates": {},
        "session_start_ns": {},
        "truth": None,
    }
    for rate in (50, 100):
        fixture = load_ronin_raw_fixture(
            data_path=sequence_root / "data.hdf5",
            info_path=sequence_root / "info.json",
            member_sha256=member_hash,
            target_rate_hz=rate,
        )
        if result["truth"] is None:
            result["truth"] = fixture.ground_truth
        result["session_start_ns"][rate] = session_start_ns(fixture.session)
        for window_s in (0.5, 1.0):
            motion = extract_learned_features(
                fixture.session, config=learned_config(window_s)
            )
            if not motion.supported:
                raise ValueError(
                    f"{sequence_root.name}/{rate}/{window_s}: "
                    f"unsupported {motion.missing_requirements}"
                )
            direct = build_direct_inputs(motion)
            if not direct.supported:
                raise ValueError(
                    f"{sequence_root.name}/{rate}/{window_s}: "
                    f"unsupported {direct.missing_requirements}"
                )
            result["learned"][(window_s, rate)] = motion
            result["direct"][(window_s, rate)] = direct
            if rate == 50:
                target, body_rate = circular_supervision(
                    direct, fixture.ground_truth
                )
                result["targets"][window_s] = target
                result["body_rates"][window_s] = body_rate
    return result


def evaluate_run(*, sequence_data, rate: int, run) -> dict[str, object]:
    evaluation = evaluate_body_heading(
        session_id=f"{sequence_data['sequence']}-{rate}",
        truth=sequence_data["truth"],
        run=run,
        session_start_ns=sequence_data["session_start_ns"][rate],
    )
    return {
        "estimator": evaluation.estimator,
        "version": evaluation.version,
        "metrics": evaluation.metrics,
        "failure_flags": list(evaluation.failure_flags),
    }


def candidate_score(candidate: dict[str, object]) -> tuple[float, float, float, float, str]:
    sequence_heading = []
    sequence_turn = []
    rate_p95 = []
    for fold in candidate["folds"]:
        sequence_heading.append(
            statistics.fmean(
                fold["rates"][str(rate)]["metrics"]["heading_mae_deg"]
                for rate in (50, 100)
            )
        )
        sequence_turn.append(
            statistics.fmean(
                fold["rates"][str(rate)]["metrics"]["turn_angle_mae_deg"]
                for rate in (50, 100)
            )
        )
        rate_p95.append(fold["rate_comparison"]["p95_disagreement_deg"])
    return (
        max(sequence_heading),
        statistics.fmean(sequence_heading),
        statistics.fmean(sequence_turn),
        max(rate_p95),
        candidate["config"]["config_id"],
    )


def candidate_rejections(candidate: dict[str, object]) -> list[str]:
    reasons = []
    config = candidate["config"]
    heading_values = []
    turn_values = []
    baseline_values = []
    for fold in candidate["folds"]:
        sequence = fold["held_out_sequence"]
        for rate in (50, 100):
            metrics = fold["rates"][str(rate)]["metrics"]
            baseline = fold["device_baselines"][str(rate)]["metrics"]
            heading_values.append(metrics["heading_mae_deg"])
            turn_values.append(metrics["turn_angle_mae_deg"])
            baseline_values.append(baseline["heading_mae_deg"])
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
    sequence_averages = [
        statistics.fmean(
            fold["rates"][str(rate)]["metrics"]["heading_mae_deg"]
            for rate in (50, 100)
        )
        for fold in candidate["folds"]
    ]
    improvement = (
        statistics.fmean(baseline_values) - statistics.fmean(heading_values)
    ) / statistics.fmean(baseline_values)
    if max(sequence_averages) >= 75.0:
        reasons.append("aggregate:worst-heading-mae")
    if statistics.fmean(turn_values) >= 45.0:
        reasons.append("aggregate:turn-mae")
    if improvement < 0.15:
        reasons.append("aggregate:device-heading-improvement")
    return reasons


def base_payload(*, phase: str, split: dict[str, object]) -> dict[str, object]:
    return {
        "schema_version": 1,
        "experiment": split["experiment"],
        "phase": phase,
        "evidence_kind": "non-commercial-public-sequence-benchmark-only",
        "protocol_sha256": file_sha256(PROTOCOL_PATH),
        "split_sha256": file_sha256(SPLIT_PATH),
        "source_adapter_id": SOURCE_ADAPTER_ID,
        "implementation_sha256": {
            str(path.relative_to(ROOT)): file_sha256(path)
            for path in IMPLEMENTATION_PATHS
        },
        "input_contract": {
            "live_inputs": [
                "TYPE_ACCELEROMETER values/timestamp",
                "TYPE_GYROSCOPE values/timestamp",
                "TYPE_GAME_ROTATION_VECTOR values/timestamp",
                "causal relative device yaw and clipped yaw rate",
            ],
            "training_labels": ["Tango-derived relative body-heading sin/cos"],
            "evaluation_only": [
                "Tango pose/orientation",
                "start_frame",
                "imu_time_offset",
                "align_tango_to_body",
            ],
            "forbidden": [
                "EKF/corrected orientation",
                "future sample",
                "completed trajectory",
                "subject/device ID as model feature",
            ],
        },
        "license_boundary": (
            "RoNIN non-commercial scientific-research benchmark; fitted weights "
            "are non-shippable and ignored by Git"
        ),
    }


def fit_model(training_sequences, config: DirectHeadingConfig):
    return fit_direct_circular_readout(
        series=tuple(
            sequence["direct"][(config.window_s, 50)]
            for sequence in training_sequences
        ),
        circular_targets=tuple(
            sequence["targets"][config.window_s]
            for sequence in training_sequences
        ),
        body_rates_rad_s=tuple(
            sequence["body_rates"][config.window_s]
            for sequence in training_sequences
        ),
        config=config,
        trained_sequence_ids=tuple(
            sequence["sequence"] for sequence in training_sequences
        ),
    )


def analyze_development(
    *, sequence_roots: list[Path], output: Path, model_output: Path, split: dict[str, object]
) -> None:
    expected = [item["sequence"] for item in split["development_assignments"]]
    actual = sorted(root.name for root in sequence_roots)
    if actual != sorted(expected):
        raise ValueError(f"Development roots {actual} != split {sorted(expected)}")
    data_parent = sequence_roots[0].parent
    accidentally_opened = [
        item["sequence"]
        for item in split["validation_assignments"]
        if (data_parent / item["sequence"]).exists()
    ]
    if accidentally_opened:
        raise ValueError(f"Validation was opened before freeze: {accidentally_opened}")
    if model_output.exists():
        raise FileExistsError(f"Refusing stale direct-heading model: {model_output}")

    sequence_data = [prepare_sequence(root) for root in sorted(sequence_roots)]
    candidates = []
    for config in CANDIDATE_CONFIGS:
        folds = []
        for held_out in sequence_data:
            training_sequences = [
                sequence for sequence in sequence_data if sequence is not held_out
            ]
            model = fit_model(training_sequences, config)
            rates = {}
            baselines = {}
            runs = {}
            for rate in (50, 100):
                direct = held_out["direct"][(config.window_s, rate)]
                motion = held_out["learned"][(config.window_s, rate)]
                run = predict_direct_heading(direct, model=model)
                baseline = predict_device_heading_series(
                    motion, config=learned_config(config.window_s)
                )
                runs[rate] = run
                rates[str(rate)] = evaluate_run(
                    sequence_data=held_out, rate=rate, run=run
                )
                baselines[str(rate)] = evaluate_run(
                    sequence_data=held_out, rate=rate, run=baseline
                )
            folds.append(
                {
                    "held_out_sequence": held_out["sequence"],
                    "held_out_subject_key": held_out["subject_key"],
                    "training_sequences": list(model.trained_sequence_ids),
                    "training_row_count": model.training_row_count,
                    "fold_model_sha256": model_sha256(model),
                    "rates": rates,
                    "device_baselines": baselines,
                    "rate_comparison": asdict(
                        compare_heading_rates(runs[50], runs[100])
                    ),
                }
            )
        candidate = {"config": asdict(config), "folds": folds}
        score = candidate_score(candidate)
        candidate["ranking_score"] = {
            "worst_sequence_mean_heading_mae_deg": score[0],
            "subject_balanced_mean_heading_mae_deg": score[1],
            "subject_balanced_mean_turn_mae_deg": score[2],
            "worst_p95_rate_disagreement_deg": score[3],
            "config_id": score[4],
        }
        candidate["rejection_reasons"] = candidate_rejections(candidate)
        candidate["eligible"] = not candidate["rejection_reasons"]
        candidates.append(candidate)

    eligible = sorted(
        (candidate for candidate in candidates if candidate["eligible"]),
        key=candidate_score,
    )
    diagnostic = min(
        candidates,
        key=lambda candidate: (
            len(candidate["rejection_reasons"]),
            candidate_score(candidate),
        ),
    )
    selected = eligible[0] if eligible else None
    selected_model = None
    selected_model_hash = None
    if selected is not None:
        selected_config = next(
            config
            for config in CANDIDATE_CONFIGS
            if config.config_id == selected["config"]["config_id"]
        )
        selected_model = fit_model(sequence_data, selected_config)
        selected_model_hash = write_model(model_output, selected_model)

    payload = base_payload(phase="development", split=split)
    payload.update(
        {
            "sequence_metadata": [
                {
                    "sequence": sequence["sequence"],
                    "subject_key": sequence["subject_key"],
                    "device": sequence["device"],
                    "data_hdf5_sha256": sequence["artifact_sha256"],
                    "http_range_bytes": sequence["http_range_bytes"],
                    "feature_row_counts": {
                        f"{window:g}s/{rate}hz": len(
                            sequence["direct"][(window, rate)].rows
                        )
                        for window in (0.5, 1.0)
                        for rate in (50, 100)
                    },
                }
                for sequence in sequence_data
            ],
            "training_rate_hz": 50,
            "evaluation_rates_hz": [50, 100],
            "cross_validation": "leave-one-subject-prefix-out before windowing/state",
            "candidate_count": len(candidates),
            "eligible_candidate_count": len(eligible),
            "selected_config_id": (
                selected["config"]["config_id"] if selected is not None else None
            ),
            "selected_config": selected["config"] if selected is not None else None,
            "selected_model": (
                {
                    "sha256": selected_model_hash,
                    "training_row_count": selected_model.training_row_count,
                    "trained_sequence_ids": list(selected_model.trained_sequence_ids),
                    "fit_rate_hz": selected_model.fit_rate_hz,
                    "seed": selected_model.seed,
                    "committed": False,
                    "path_policy": "ignored research/pdr/models only",
                }
                if selected_model is not None
                else None
            ),
            "development_decision": (
                "freeze-selected-benchmark-model"
                if selected is not None
                else "stop-no-direct-heading-candidate-survived-development"
            ),
            "best_diagnostic_config_id": diagnostic["config"]["config_id"],
            "best_diagnostic_score": diagnostic["ranking_score"],
            "best_diagnostic_rejection_reasons": diagnostic["rejection_reasons"],
            "validation_state": {
                item["sequence"]: item["raw_state_at_registration"]
                for item in split["validation_assignments"]
            },
            "candidates": sorted(
                candidates, key=lambda candidate: candidate["config"]["config_id"]
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
                "phase": "development",
                "candidate_count": len(candidates),
                "eligible_candidate_count": len(eligible),
                "selected_config_id": payload["selected_config_id"],
                "selected_model_sha256": selected_model_hash,
                "development_decision": payload["development_decision"],
                "best_diagnostic_config_id": payload["best_diagnostic_config_id"],
                "best_diagnostic_score": payload["best_diagnostic_score"],
                "output": str(output),
            },
            sort_keys=True,
        )
    )


def validation_checks(*, record: dict[str, object], config: dict[str, object]) -> dict[str, bool]:
    checks = {}
    for rate in (50, 100):
        metrics = record["rates"][str(rate)]["metrics"]
        checks[f"{rate}hz_zero_future_sample_violations"] = metrics["future_sample_violations"] == 0
        checks[f"{rate}hz_output_coverage_at_least_95pct"] = metrics["output_grid_coverage"] >= 0.95
        checks[f"{rate}hz_fresh_output_at_least_95pct"] = metrics["fresh_output_fraction"] >= 0.95
        checks[f"{rate}hz_initialization_within_window_plus_0p2s"] = metrics["initialization_latency_s"] <= config["window_s"] + 0.2
        checks[f"{rate}hz_heading_mae_below_60deg"] = metrics["heading_mae_deg"] < 60.0
        checks[f"{rate}hz_turn_mae_below_45deg"] = metrics["turn_angle_mae_deg"] < 45.0
    comparison = record["rate_comparison"]
    checks["median_rate_disagreement_at_most_5deg"] = comparison["median_disagreement_deg"] <= 5.0
    checks["p95_rate_disagreement_at_most_20deg"] = comparison["p95_disagreement_deg"] <= 20.0
    return checks


def analyze_validation(
    *,
    sequence_roots: list[Path],
    output: Path,
    model_path: Path,
    development_path: Path,
    split: dict[str, object],
) -> None:
    development = json.loads(development_path.read_text(encoding="utf-8"))
    expected = sorted(item["sequence"] for item in split["validation_assignments"])
    actual = sorted(root.name for root in sequence_roots)
    if actual != expected:
        raise ValueError(f"Validation roots {actual} != split {expected}")
    if development["development_decision"] != "freeze-selected-benchmark-model":
        raise ValueError("Development did not authorize validation retrieval")
    if development["split_sha256"] != file_sha256(SPLIT_PATH):
        raise ValueError("Split changed after development")
    current_hashes = {
        str(path.relative_to(ROOT)): file_sha256(path)
        for path in IMPLEMENTATION_PATHS
    }
    if development["implementation_sha256"] != current_hashes:
        raise ValueError("Implementation changed after development freeze")
    model = read_model(model_path)
    actual_model_hash = file_sha256(model_path)
    if actual_model_hash != development["selected_model"]["sha256"]:
        raise ValueError("Fitted direct-heading model hash changed")
    if model.config.config_id != development["selected_config_id"]:
        raise ValueError("Fitted direct-heading config changed")

    sequence_data = [prepare_sequence(root) for root in sorted(sequence_roots)]
    records = []
    learned_heading_values = []
    learned_turn_values = []
    baseline_heading_values = []
    for sequence in sequence_data:
        rates = {}
        baselines = {}
        runs = {}
        for rate in (50, 100):
            direct = sequence["direct"][(model.config.window_s, rate)]
            motion = sequence["learned"][(model.config.window_s, rate)]
            run = predict_direct_heading(direct, model=model)
            baseline = predict_device_heading_series(
                motion, config=learned_config(model.config.window_s)
            )
            runs[rate] = run
            rates[str(rate)] = evaluate_run(sequence_data=sequence, rate=rate, run=run)
            baselines[str(rate)] = evaluate_run(sequence_data=sequence, rate=rate, run=baseline)
            learned_heading_values.append(rates[str(rate)]["metrics"]["heading_mae_deg"])
            learned_turn_values.append(rates[str(rate)]["metrics"]["turn_angle_mae_deg"])
            baseline_heading_values.append(baselines[str(rate)]["metrics"]["heading_mae_deg"])
        record = {
            "sequence": sequence["sequence"],
            "subject_key": sequence["subject_key"],
            "device": sequence["device"],
            "data_hdf5_sha256": sequence["artifact_sha256"],
            "http_range_bytes": sequence["http_range_bytes"],
            "rates": rates,
            "device_baselines": baselines,
            "rate_comparison": asdict(compare_heading_rates(runs[50], runs[100])),
        }
        record["primary_checks"] = validation_checks(
            record=record, config=development["selected_config"]
        )
        record["primary_pass"] = all(record["primary_checks"].values())
        records.append(record)

    learned_mean = statistics.fmean(learned_heading_values)
    baseline_mean = statistics.fmean(baseline_heading_values)
    improvement = (baseline_mean - learned_mean) / baseline_mean
    headroom_pass = all(record["primary_pass"] for record in records) and improvement >= 0.20
    narrow_pass = (
        headroom_pass
        and all(value < 45.0 for value in learned_heading_values)
        and all(value <= 30.0 for value in learned_turn_values)
        and statistics.median(learned_heading_values) <= 30.0
    )
    payload = base_payload(phase="validation", split=split)
    payload.update(
        {
            "development_manifest": str(development_path.relative_to(ROOT)),
            "development_manifest_sha256": file_sha256(development_path),
            "selected_config_id": model.config.config_id,
            "selected_config": asdict(model.config),
            "model_sha256": actual_model_hash,
            "model_committed": False,
            "sequences": records,
            "aggregate": {
                "subject_balanced_heading_mae_deg": learned_mean,
                "median_heading_mae_deg": statistics.median(learned_heading_values),
                "worst_heading_mae_deg": max(learned_heading_values),
                "subject_balanced_turn_mae_deg": statistics.fmean(learned_turn_values),
                "worst_turn_mae_deg": max(learned_turn_values),
                "device_heading_mean_mae_deg": baseline_mean,
                "device_heading_improvement_fraction": improvement,
                "benchmark_headroom_gate_pass": headroom_pass,
                "narrow_quality_gate_pass": narrow_pass,
            },
            "decision": (
                "narrow-direct-heading-headroom-only"
                if narrow_pass
                else "benchmark-direct-heading-headroom-only"
                if headroom_pass
                else "stop-direct-circular-family"
            ),
            "product_decision": "not-authorized-regardless-of-benchmark-result",
            "personal_pilot": "not-authorized",
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
                **payload["aggregate"],
                "decision": payload["decision"],
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
    parser.add_argument("--model-output", type=Path, required=True)
    parser.add_argument("--development-manifest", type=Path)
    args = parser.parse_args()
    split = json.loads(SPLIT_PATH.read_text(encoding="utf-8"))
    if args.phase == "development":
        if args.development_manifest is not None:
            parser.error("--development-manifest is valid only for validation")
        analyze_development(
            sequence_roots=args.sequence_root,
            output=args.output,
            model_output=args.model_output,
            split=split,
        )
    else:
        if args.development_manifest is None:
            parser.error("--development-manifest is required for validation")
        analyze_validation(
            sequence_roots=args.sequence_root,
            output=args.output,
            model_path=args.model_output,
            development_path=args.development_manifest,
            split=split,
        )


if __name__ == "__main__":
    main()
