"""Run the preregistered aggregate-only IPIN classical replay analysis."""

from __future__ import annotations

import argparse
from dataclasses import asdict
import hashlib
import json
import math
from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from pdr_research.compatibility import (  # noqa: E402
    validate_estimator_output,
    validate_session,
)
from pdr_research.estimators import run_b1  # noqa: E402
from pdr_research.ipin import (  # noqa: E402
    ADAPTER_VERSION,
    build_normalized_session,
    parse_ipin_log,
    preflight_summary,
    stream_gap_count,
    with_callback_batches,
    with_gap,
    without_sensor,
)
from pdr_research.step_detection import (  # noqa: E402
    detect_rate_stable_steps,
    get_step_detector_config,
    summarize_step_detection,
)


PREREGISTRATION = (
    ROOT / "datasets" / "manifests" / "ipin-classical-preregistration-v1.json"
)
STEP_CONFIG_ID = "rs25-a010-p025-r025"
WEINBERG_GAIN = 0.64
FALLBACK_STRIDE_M = 0.66


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def relative_difference(left: float, right: float) -> float:
    return abs(left - right) / max(abs(left), abs(right), 1e-12)


def travelled_distance(points) -> float:
    return sum(
        math.hypot(right.x_m - left.x_m, right.y_m - left.y_m)
        for left, right in zip(points, points[1:])
    )


def output_findings(output) -> dict[str, int]:
    return {
        "future_sample_violations": sum(
            point.source_end_ns > point.timestamp_ns for point in output.points
        ),
        "nonfinite_value_count": sum(
            not math.isfinite(value)
            for point in output.points
            for value in (
                point.x_m,
                point.y_m,
                point.heading_rad,
                point.uncertainty_m,
            )
        ),
    }


def run_estimator(session):
    run = run_b1(
        session,
        capability_profile="imu6",
        fallback_stride_m=FALLBACK_STRIDE_M,
        weinberg_gain=WEINBERG_GAIN,
        step_detector_config_id=STEP_CONFIG_ID,
    )
    if not run.supported or run.output is None:
        raise ValueError(f"Frozen B1 is unsupported: {run.missing_requirements}")
    validate_estimator_output(run.output)
    return run


def raw_gate(summary: dict[str, object]) -> dict[str, bool]:
    accelerometer = summary["streams"]["TYPE_ACCELEROMETER"]
    gyroscope = summary["streams"]["TYPE_GYROSCOPE"]

    def between(value: object, lower: float, upper: float) -> bool:
        return isinstance(value, (int, float)) and lower <= value <= upper

    return {
        "eligible_rows_well_formed": summary["malformed_eligible_rows"] == 0
        and summary["nonfinite_eligible_rows"] == 0,
        "required_streams_nonempty": accelerometer["event_count"] > 0
        and gyroscope["event_count"] > 0,
        "common_coverage_at_least_30_s": summary["common_imu_coverage_s"] >= 30.0,
        "accelerometer_sensor_time_strict": math.isclose(
            accelerometer["positive_sensor_delta_fraction"], 1.0
        ),
        "gyroscope_sensor_time_strict": math.isclose(
            gyroscope["positive_sensor_delta_fraction"], 1.0
        ),
        "accelerometer_rate_40_120_hz": between(
            accelerometer["median_rate_hz"], 40.0, 120.0
        ),
        "gyroscope_rate_40_120_hz": between(
            gyroscope["median_rate_hz"], 40.0, 120.0
        ),
        "accelerometer_norm_5_15_mps2": between(
            accelerometer["vector_norm_p50"], 5.0, 15.0
        ),
        "truth_and_platform_records_excluded": set(
            summary["admitted_record_types"]
        )
        <= {"ACCE", "GYRO", "MAGN"},
    }


def analyze_sequence(
    *, sequence: dict[str, object], input_root: Path
) -> dict[str, object]:
    directory = input_root / str(sequence["id"])
    artifact_manifest_path = directory / "artifact_manifest.json"
    artifact = json.loads(artifact_manifest_path.read_text(encoding="utf-8"))
    member = artifact["member"]
    if member["id"] != sequence["id"] or member["role"] != sequence["role"]:
        raise ValueError(f"Artifact role mismatch: {sequence['id']}")
    for key in ("uncompressed_bytes", "compressed_bytes", "crc32"):
        if member[key] != sequence[key]:
            raise ValueError(f"Artifact metadata mismatch: {sequence['id']}/{key}")
    data_path = directory / str(member["output_name"])
    if sha256_file(data_path) != member["sha256"]:
        raise ValueError(f"Raw member hash mismatch: {sequence['id']}")

    raw = parse_ipin_log(data_path)
    if raw.source_sha256 != member["sha256"]:
        raise ValueError(f"Parser member hash mismatch: {sequence['id']}")
    preflight = preflight_summary(raw)
    raw_checks = raw_gate(preflight)
    if not all(raw_checks.values()):
        return {
            "id": sequence["id"],
            "role": sequence["role"],
            "user": sequence["user"],
            "trial": sequence["trial"],
            "artifact": member,
            "preflight": preflight,
            "raw_gate": raw_checks,
            "replay": None,
            "decision": "stop-source",
        }

    sessions = {
        rate: build_normalized_session(
            raw, session_id=str(sequence["id"]), target_rate_hz=rate
        )
        for rate in (50, 100)
    }
    rate_results: dict[int, dict[str, object]] = {}
    original_runs = {}
    step_summaries = {}
    for rate, session in sessions.items():
        validate_session(session)
        step_config = get_step_detector_config(STEP_CONFIG_ID)
        steps = detect_rate_stable_steps(session, config=step_config)
        step_summary = summarize_step_detection(steps, config_id=STEP_CONFIG_ID)
        run = run_estimator(session)
        original_runs[rate] = run
        step_summaries[rate] = step_summary

        batched = with_callback_batches(session)
        validate_session(batched)
        batched_run = run_estimator(batched)
        no_magnet = without_sensor(session, "TYPE_MAGNETIC_FIELD")
        validate_session(no_magnet)
        no_magnet_run = run_estimator(no_magnet)

        accelerometer_times = [
            sample.sensor_timestamp_ns
            for sample in session.samples
            if sample.sensor_type == "TYPE_ACCELEROMETER"
        ]
        gyroscope_times = [
            sample.sensor_timestamp_ns
            for sample in session.samples
            if sample.sensor_type == "TYPE_GYROSCOPE"
        ]
        common_start = max(min(accelerometer_times), min(gyroscope_times))
        common_end = min(max(accelerometer_times), max(gyroscope_times))
        midpoint = (common_start + common_end) // 2
        gapped = with_gap(
            session,
            start_ns=midpoint - 300_000_000,
            end_ns=midpoint + 300_000_000,
        )
        validate_session(gapped)
        gapped_run = run_estimator(gapped)
        baseline_gap_count = stream_gap_count(session, "TYPE_ACCELEROMETER")
        stressed_gap_count = stream_gap_count(gapped, "TYPE_ACCELEROMETER")

        output = run.output
        gapped_output = gapped_run.output
        assert output is not None and gapped_output is not None
        rate_results[rate] = {
            "normalized_sample_counts": dict(
                sorted(
                    {
                        sensor_type: sum(
                            sample.sensor_type == sensor_type
                            for sample in session.samples
                        )
                        for sensor_type in {
                            sample.sensor_type for sample in session.samples
                        }
                    }.items()
                )
            ),
            "step_detection": asdict(step_summary),
            "estimator": {
                "supported": run.supported,
                "version": run.requirement.version,
                "used_sensor_types": sorted(run.used_sensor_types),
                "fallback_flags": list(run.fallback_flags),
                "point_count": len(output.points),
                "travelled_distance_m": travelled_distance(output.points),
                "endpoint_x_m": output.points[-1].x_m,
                "endpoint_y_m": output.points[-1].y_m,
                "terminal_uncertainty_m": output.points[-1].uncertainty_m,
                **output_findings(output),
            },
            "callback_batch_output_exact": batched_run.output.points == output.points,
            "magnetometer_removal_output_exact": no_magnet_run.output.points
            == output.points,
            "gap_stress": {
                "removed_interval_ns": [
                    midpoint - 300_000_000,
                    midpoint + 300_000_000,
                ],
                "baseline_accelerometer_gap_count": baseline_gap_count,
                "stressed_accelerometer_gap_count": stressed_gap_count,
                "additional_gap_registered": stressed_gap_count
                > baseline_gap_count,
                "terminal_uncertainty_m": gapped_output.points[-1].uncertainty_m,
                "uncertainty_not_lower": gapped_output.points[-1].uncertainty_m
                >= output.points[-1].uncertainty_m,
                **output_findings(gapped_output),
            },
        }

    left_steps = step_summaries[50]
    right_steps = step_summaries[100]
    left_output = original_runs[50].output
    right_output = original_runs[100].output
    assert left_output is not None and right_output is not None
    left_distance = travelled_distance(left_output.points)
    right_distance = travelled_distance(right_output.points)
    endpoint_separation = math.hypot(
        left_output.points[-1].x_m - right_output.points[-1].x_m,
        left_output.points[-1].y_m - right_output.points[-1].y_m,
    )
    comparisons = {
        "step_count_relative_difference": relative_difference(
            left_steps.event_count, right_steps.event_count
        ),
        "amplitude_score_relative_difference": relative_difference(
            left_steps.amplitude_quarter_power_sum,
            right_steps.amplitude_quarter_power_sum,
        ),
        "travelled_distance_relative_difference": relative_difference(
            left_distance, right_distance
        ),
        "endpoint_separation_m": endpoint_separation,
        "endpoint_separation_over_longer_distance": endpoint_separation
        / max(left_distance, right_distance, 1e-12),
    }
    replay_checks = {
        "future_sample_violations_zero": all(
            rate_results[rate]["estimator"]["future_sample_violations"] == 0
            for rate in (50, 100)
        ),
        "nonfinite_estimator_values_zero": all(
            rate_results[rate]["estimator"]["nonfinite_value_count"] == 0
            for rate in (50, 100)
        ),
        "step_count_rate_difference_at_most_2pct": comparisons[
            "step_count_relative_difference"
        ]
        <= 0.02,
        "amplitude_rate_difference_at_most_3pct": comparisons[
            "amplitude_score_relative_difference"
        ]
        <= 0.03,
        "distance_rate_difference_at_most_3pct": comparisons[
            "travelled_distance_relative_difference"
        ]
        <= 0.03,
        "endpoint_rate_separation_at_most_5pct": comparisons[
            "endpoint_separation_over_longer_distance"
        ]
        <= 0.05,
        "callback_batch_invariant": all(
            rate_results[rate]["callback_batch_output_exact"] for rate in (50, 100)
        ),
        "magnetometer_not_used": all(
            rate_results[rate]["magnetometer_removal_output_exact"]
            for rate in (50, 100)
        ),
        "gap_registered": all(
            rate_results[rate]["gap_stress"]["additional_gap_registered"]
            for rate in (50, 100)
        ),
        "gap_uncertainty_not_lower": all(
            rate_results[rate]["gap_stress"]["uncertainty_not_lower"]
            for rate in (50, 100)
        ),
        "gap_output_finite_and_causal": all(
            rate_results[rate]["gap_stress"]["nonfinite_value_count"] == 0
            and rate_results[rate]["gap_stress"]["future_sample_violations"] == 0
            for rate in (50, 100)
        ),
    }
    return {
        "id": sequence["id"],
        "role": sequence["role"],
        "user": sequence["user"],
        "trial": sequence["trial"],
        "artifact": member,
        "preflight": preflight,
        "raw_gate": raw_checks,
        "replay": {
            "rates": {str(rate): rate_results[rate] for rate in (50, 100)},
            "rate_comparison": comparisons,
            "gate": replay_checks,
        },
        "decision": (
            "pipeline-compatible"
            if all(replay_checks.values())
            else "narrow-pipeline-only"
        ),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--phase", choices=("development", "validation"), required=True)
    parser.add_argument("--input-root", type=Path, default=Path("/data/ipin2022"))
    parser.add_argument("--preregistration", type=Path, default=PREREGISTRATION)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    preregistration = json.loads(args.preregistration.read_text(encoding="utf-8"))
    protocol_path = ROOT / str(preregistration["protocol"])
    if sha256_file(protocol_path) != preregistration["protocol_sha256"]:
        raise ValueError("Protocol changed after preregistration")
    expected_estimator = preregistration["estimator"]
    if expected_estimator != {
        "family": "B1 imu6",
        "step_detector_config": STEP_CONFIG_ID,
        "weinberg_gain": WEINBERG_GAIN,
        "fallback_stride_m": FALLBACK_STRIDE_M,
        "rates_hz": [50, 100],
        "parameter_search_allowed": False,
    }:
        raise ValueError("Frozen estimator contract changed")

    role = "development" if args.phase == "development" else "untouched-validation"
    selected = [item for item in preregistration["sequences"] if item["role"] == role]
    if len(selected) != 2:
        raise ValueError("Expected exactly two sequences in the selected phase")
    validation_ids = [
        str(item["id"])
        for item in preregistration["sequences"]
        if item["role"] == "untouched-validation"
    ]
    validation_present_before_development = any(
        (args.input_root / sequence_id).exists() for sequence_id in validation_ids
    )
    if args.phase == "development" and validation_present_before_development:
        raise ValueError("Validation data was present before development freeze")

    results = [
        analyze_sequence(sequence=sequence, input_root=args.input_root)
        for sequence in selected
    ]
    decisions = [result["decision"] for result in results]
    if any(decision == "stop-source" for decision in decisions):
        decision = "stop-source"
    elif all(decision == "pipeline-compatible" for decision in decisions):
        decision = "pipeline-compatible"
    else:
        decision = "narrow-pipeline-only"
    payload = {
        "schema_version": 1,
        "experiment": "ipin-2022-classical-replay-v1",
        "phase": args.phase,
        "protocol_sha256": preregistration["protocol_sha256"],
        "adapter_version": ADAPTER_VERSION,
        "estimator": expected_estimator,
        "parameter_search_performed": False,
        "validation_present_before_development": validation_present_before_development,
        "source_sequence_count": len(results),
        "source_uncompressed_bytes": sum(
            result["artifact"]["uncompressed_bytes"] for result in results
        ),
        "eligible_sensor_rows_loaded": sum(
            result["preflight"]["eligible_event_count"] for result in results
        ),
        "ground_truth_rows_loaded": 0,
        "platform_ahrs_rows_used": 0,
        "model_weights_loaded": 0,
        "sequences": results,
        "decision": decision,
        "claim_boundary": (
            "Android-shaped parser/rate/batch/gap self-consistency only; no "
            "heading, distance, endpoint, lifecycle, or product accuracy claim"
        ),
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(payload, indent=2, ensure_ascii=False, allow_nan=False) + "\n",
        encoding="utf-8",
    )
    print(
        json.dumps(
            {
                "phase": args.phase,
                "sequence_count": len(results),
                "eligible_sensor_rows_loaded": payload["eligible_sensor_rows_loaded"],
                "ground_truth_rows_loaded": 0,
                "decision": decision,
                "sequence_decisions": {
                    result["id"]: result["decision"] for result in results
                },
                "output": str(args.output),
            },
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
