"""Independent QA for the preregistered IPIN classical replay.

The validator intentionally uses only the Python standard library and does not
import the IPIN adapter, step detector, or estimator.  It verifies the frozen
development boundary and independently recomputes every aggregate replay gate
from the persisted output.  Final validation checks are added only after the
untouched validation run has been opened.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
from typing import Callable


ROOT = Path(__file__).resolve().parents[1]
PREREGISTRATION = (
    ROOT / "datasets" / "manifests" / "ipin-classical-preregistration-v1.json"
)
DEVELOPMENT_FREEZE = (
    ROOT / "datasets" / "manifests" / "ipin-classical-development-v1.json"
)
PROTOCOL = ROOT / "IPIN_CLASSICAL_PROTOCOL.md"
EXPECTED_EXPERIMENT = "ipin-2022-classical-replay-v1"
EXPECTED_ADAPTER = "ipin-2022-android-raw-v1"
EXPECTED_ESTIMATOR = {
    "family": "B1 imu6",
    "step_detector_config": "rs25-a010-p025-r025",
    "weinberg_gain": 0.64,
    "fallback_stride_m": 0.66,
    "rates_hz": [50, 100],
    "parameter_search_allowed": False,
}
EXPECTED_CLAIM_BOUNDARY = (
    "Android-shaped parser/rate/batch/gap self-consistency only; no heading, "
    "distance, endpoint, lifecycle, or product accuracy claim"
)
ADMITTED_RECORD_TYPES = {"ACCE", "GYRO", "MAGN"}
ESTIMATOR_SENSOR_TYPES = {"TYPE_ACCELEROMETER", "TYPE_GYROSCOPE"}


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def relative_difference(left: float, right: float) -> float:
    return abs(left - right) / max(abs(left), abs(right), 1e-12)


def close(left: float, right: float) -> bool:
    return math.isclose(left, right, rel_tol=0.0, abs_tol=1e-12)


def validate_output(
    *,
    payload: dict[str, object],
    preregistration: dict[str, object],
    phase: str,
    require: Callable[[bool, str], None],
) -> list[dict[str, object]]:
    expected_role = "development" if phase == "development" else "untouched-validation"
    expected_sequences = [
        sequence
        for sequence in preregistration["sequences"]
        if sequence["role"] == expected_role
    ]
    require(payload["schema_version"] == 1, f"unexpected {phase} schema")
    require(payload["experiment"] == EXPECTED_EXPERIMENT, f"wrong {phase} experiment")
    require(payload["phase"] == phase, f"wrong {phase} phase")
    require(
        payload["protocol_sha256"] == preregistration["protocol_sha256"],
        f"{phase} protocol mismatch",
    )
    require(payload["adapter_version"] == EXPECTED_ADAPTER, f"wrong {phase} adapter")
    require(payload["estimator"] == EXPECTED_ESTIMATOR, f"wrong {phase} estimator")
    require(payload["parameter_search_performed"] is False, f"{phase} tuned parameters")
    require(payload["ground_truth_rows_loaded"] == 0, f"{phase} loaded ground truth")
    require(payload["platform_ahrs_rows_used"] == 0, f"{phase} used platform AHRS")
    require(payload["model_weights_loaded"] == 0, f"{phase} loaded model weights")
    require(
        payload["claim_boundary"] == EXPECTED_CLAIM_BOUNDARY,
        f"{phase} claim boundary changed",
    )
    require(len(expected_sequences) == 2, f"wrong preregistered {phase} cardinality")
    require(payload["source_sequence_count"] == 2, f"wrong {phase} source count")
    require(
        [sequence["id"] for sequence in payload["sequences"]]
        == [sequence["id"] for sequence in expected_sequences],
        f"{phase} sequence order or membership changed",
    )
    require(
        payload["source_uncompressed_bytes"]
        == sum(sequence["uncompressed_bytes"] for sequence in expected_sequences),
        f"{phase} source-byte total mismatch",
    )

    summaries: list[dict[str, object]] = []
    expected_by_id = {sequence["id"]: sequence for sequence in expected_sequences}
    total_eligible_rows = 0
    for sequence in payload["sequences"]:
        sequence_id = sequence["id"]
        expected = expected_by_id[sequence_id]
        require(sequence["role"] == expected_role, f"wrong role: {sequence_id}")
        require(sequence["user"] == expected["user"], f"wrong user: {sequence_id}")
        require(sequence["trial"] == expected["trial"], f"wrong trial: {sequence_id}")
        artifact = sequence["artifact"]
        require(artifact["id"] == sequence_id, f"artifact ID mismatch: {sequence_id}")
        require(artifact["role"] == expected_role, f"artifact role mismatch: {sequence_id}")
        require(artifact["archive_path"] == expected["member"], f"member changed: {sequence_id}")
        for key in ("uncompressed_bytes", "compressed_bytes", "crc32"):
            require(artifact[key] == expected[key], f"artifact {key} changed: {sequence_id}")
        require(len(artifact["sha256"]) == 64, f"missing source hash: {sequence_id}")

        preflight = sequence["preflight"]
        require(
            preflight["source_sha256"] == artifact["sha256"],
            f"parser source hash mismatch: {sequence_id}",
        )
        require(
            preflight["source_size_bytes"] == artifact["uncompressed_bytes"],
            f"parser source size mismatch: {sequence_id}",
        )
        require(
            set(preflight["admitted_record_types"]) == ADMITTED_RECORD_TYPES,
            f"input allowlist changed: {sequence_id}",
        )
        require(
            preflight["eligible_event_count"]
            == sum(preflight["record_counts"].get(name, 0) for name in ADMITTED_RECORD_TYPES),
            f"eligible-row accounting mismatch: {sequence_id}",
        )
        total_eligible_rows += preflight["eligible_event_count"]
        streams = preflight["streams"]
        accelerometer = streams["TYPE_ACCELEROMETER"]
        gyroscope = streams["TYPE_GYROSCOPE"]
        recomputed_raw_gate = {
            "eligible_rows_well_formed": preflight["malformed_eligible_rows"] == 0
            and preflight["nonfinite_eligible_rows"] == 0,
            "required_streams_nonempty": accelerometer["event_count"] > 0
            and gyroscope["event_count"] > 0,
            "common_coverage_at_least_30_s": preflight["common_imu_coverage_s"] >= 30.0,
            "accelerometer_sensor_time_strict": close(
                accelerometer["positive_sensor_delta_fraction"], 1.0
            ),
            "gyroscope_sensor_time_strict": close(
                gyroscope["positive_sensor_delta_fraction"], 1.0
            ),
            "accelerometer_rate_40_120_hz": 40.0
            <= accelerometer["median_rate_hz"]
            <= 120.0,
            "gyroscope_rate_40_120_hz": 40.0
            <= gyroscope["median_rate_hz"]
            <= 120.0,
            "accelerometer_norm_5_15_mps2": 5.0
            <= accelerometer["vector_norm_p50"]
            <= 15.0,
            "truth_and_platform_records_excluded": set(
                preflight["admitted_record_types"]
            )
            <= ADMITTED_RECORD_TYPES,
        }
        require(sequence["raw_gate"] == recomputed_raw_gate, f"raw gate mismatch: {sequence_id}")
        require(all(recomputed_raw_gate.values()), f"raw gate failed: {sequence_id}")

        replay = sequence["replay"]
        require(set(replay["rates"]) == {"50", "100"}, f"wrong rates: {sequence_id}")
        for rate in ("50", "100"):
            result = replay["rates"][rate]
            require(
                result["step_detection"]["config_id"]
                == EXPECTED_ESTIMATOR["step_detector_config"],
                f"step config changed: {sequence_id}/{rate}",
            )
            require(
                result["step_detection"]["future_sample_violations"] == 0,
                f"step look-ahead: {sequence_id}/{rate}",
            )
            estimator = result["estimator"]
            require(estimator["supported"] is True, f"unsupported estimator: {sequence_id}/{rate}")
            require(
                set(estimator["used_sensor_types"]) == ESTIMATOR_SENSOR_TYPES,
                f"estimator input leakage: {sequence_id}/{rate}",
            )
            require("TYPE_MAGNETIC_FIELD" not in estimator["used_sensor_types"], f"magnet used: {sequence_id}/{rate}")
            require(estimator["future_sample_violations"] == 0, f"estimator look-ahead: {sequence_id}/{rate}")
            require(estimator["nonfinite_value_count"] == 0, f"nonfinite output: {sequence_id}/{rate}")
            require(math.isfinite(estimator["travelled_distance_m"]), f"nonfinite distance: {sequence_id}/{rate}")
            require(result["callback_batch_output_exact"] is True, f"batch changed output: {sequence_id}/{rate}")
            require(result["magnetometer_removal_output_exact"] is True, f"magnet removal changed output: {sequence_id}/{rate}")
            gap = result["gap_stress"]
            require(gap["removed_interval_ns"][1] - gap["removed_interval_ns"][0] == 600_000_000, f"wrong gap stress: {sequence_id}/{rate}")
            require(
                gap["stressed_accelerometer_gap_count"]
                > gap["baseline_accelerometer_gap_count"],
                f"gap not registered: {sequence_id}/{rate}",
            )
            require(gap["uncertainty_not_lower"] is True, f"gap lowered uncertainty: {sequence_id}/{rate}")
            require(gap["future_sample_violations"] == 0, f"gap look-ahead: {sequence_id}/{rate}")
            require(gap["nonfinite_value_count"] == 0, f"nonfinite gap output: {sequence_id}/{rate}")

        at_50 = replay["rates"]["50"]
        at_100 = replay["rates"]["100"]
        endpoint_separation = math.hypot(
            at_50["estimator"]["endpoint_x_m"] - at_100["estimator"]["endpoint_x_m"],
            at_50["estimator"]["endpoint_y_m"] - at_100["estimator"]["endpoint_y_m"],
        )
        recomputed_comparison = {
            "step_count_relative_difference": relative_difference(
                at_50["step_detection"]["event_count"],
                at_100["step_detection"]["event_count"],
            ),
            "amplitude_score_relative_difference": relative_difference(
                at_50["step_detection"]["amplitude_quarter_power_sum"],
                at_100["step_detection"]["amplitude_quarter_power_sum"],
            ),
            "travelled_distance_relative_difference": relative_difference(
                at_50["estimator"]["travelled_distance_m"],
                at_100["estimator"]["travelled_distance_m"],
            ),
            "endpoint_separation_m": endpoint_separation,
            "endpoint_separation_over_longer_distance": endpoint_separation
            / max(
                at_50["estimator"]["travelled_distance_m"],
                at_100["estimator"]["travelled_distance_m"],
                1e-12,
            ),
        }
        for key, value in recomputed_comparison.items():
            require(close(value, replay["rate_comparison"][key]), f"comparison mismatch: {sequence_id}/{key}")
        recomputed_replay_gate = {
            "future_sample_violations_zero": all(
                replay["rates"][rate]["estimator"]["future_sample_violations"] == 0
                for rate in ("50", "100")
            ),
            "nonfinite_estimator_values_zero": all(
                replay["rates"][rate]["estimator"]["nonfinite_value_count"] == 0
                for rate in ("50", "100")
            ),
            "step_count_rate_difference_at_most_2pct": recomputed_comparison["step_count_relative_difference"] <= 0.02,
            "amplitude_rate_difference_at_most_3pct": recomputed_comparison["amplitude_score_relative_difference"] <= 0.03,
            "distance_rate_difference_at_most_3pct": recomputed_comparison["travelled_distance_relative_difference"] <= 0.03,
            "endpoint_rate_separation_at_most_5pct": recomputed_comparison["endpoint_separation_over_longer_distance"] <= 0.05,
            "callback_batch_invariant": all(
                replay["rates"][rate]["callback_batch_output_exact"]
                for rate in ("50", "100")
            ),
            "magnetometer_not_used": all(
                replay["rates"][rate]["magnetometer_removal_output_exact"]
                for rate in ("50", "100")
            ),
            "gap_registered": all(
                replay["rates"][rate]["gap_stress"]["additional_gap_registered"]
                for rate in ("50", "100")
            ),
            "gap_uncertainty_not_lower": all(
                replay["rates"][rate]["gap_stress"]["uncertainty_not_lower"]
                for rate in ("50", "100")
            ),
            "gap_output_finite_and_causal": all(
                replay["rates"][rate]["gap_stress"]["nonfinite_value_count"] == 0
                and replay["rates"][rate]["gap_stress"]["future_sample_violations"] == 0
                for rate in ("50", "100")
            ),
        }
        require(replay["gate"] == recomputed_replay_gate, f"replay gate mismatch: {sequence_id}")
        require(all(recomputed_replay_gate.values()), f"replay gate failed: {sequence_id}")
        require(sequence["decision"] == "pipeline-compatible", f"wrong decision: {sequence_id}")
        summaries.append(
            {
                "id": sequence_id,
                "eligible_rows": preflight["eligible_event_count"],
                "steps_50_hz": at_50["step_detection"]["event_count"],
                "steps_100_hz": at_100["step_detection"]["event_count"],
                **recomputed_comparison,
            }
        )

    require(payload["eligible_sensor_rows_loaded"] == total_eligible_rows, f"{phase} row total mismatch")
    require(payload["decision"] == "pipeline-compatible", f"wrong {phase} aggregate decision")
    return summaries


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--development",
        type=Path,
        default=Path("/outputs/ipin-classical-development-v1.json"),
    )
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()

    preregistration = json.loads(PREREGISTRATION.read_text(encoding="utf-8"))
    freeze = json.loads(DEVELOPMENT_FREEZE.read_text(encoding="utf-8"))
    development = json.loads(args.development.read_text(encoding="utf-8"))
    assertion_count = 0

    def require(condition: bool, message: str) -> None:
        nonlocal assertion_count
        assertion_count += 1
        if not condition:
            raise AssertionError(message)

    require(preregistration["schema_version"] == 1, "unexpected preregistration schema")
    require(preregistration["experiment"] == EXPECTED_EXPERIMENT, "wrong preregistration experiment")
    require(preregistration["status"] == "preregistered-before-raw-member-access", "preregistration status weakened")
    require(preregistration["protocol_sha256"] == sha256_file(PROTOCOL), "protocol changed after preregistration")
    require(preregistration["estimator"] == EXPECTED_ESTIMATOR, "preregistered estimator changed")
    require(preregistration["validation_opened"] is False, "preregistration retroactively opened validation")
    require(preregistration["accuracy_claim_allowed"] is False, "accuracy claim enabled")
    require(preregistration["product_adoption_allowed"] is False, "product adoption enabled")
    require(preregistration["personal_pilot_allowed"] is False, "personal pilot enabled")

    require(freeze["schema_version"] == 1, "unexpected development-freeze schema")
    require(freeze["experiment"] == EXPECTED_EXPERIMENT, "wrong development-freeze experiment")
    require(freeze["status"] == "development-frozen", "development not frozen")
    require(freeze["protocol_sha256"] == preregistration["protocol_sha256"], "freeze protocol mismatch")
    require(freeze["validation_authorized"] is True, "validation was not authorized")
    require(freeze["validation_opened"] is False, "freeze says validation was already opened")
    require(freeze["parameter_search_performed"] is False, "freeze records parameter search")
    require(sha256_file(args.development) == freeze["development_output_sha256"], "development output changed after freeze")
    for relative_path, expected_hash in freeze["code_sha256"].items():
        require(
            sha256_file(ROOT / relative_path) == expected_hash,
            f"frozen implementation changed: {relative_path}",
        )

    summaries = validate_output(
        payload=development,
        preregistration=preregistration,
        phase="development",
        require=require,
    )
    require(development["validation_present_before_development"] is False, "validation leaked into development")
    require(freeze["development_summary"]["eligible_sensor_rows_loaded"] == development["eligible_sensor_rows_loaded"], "freeze row total mismatch")
    require(freeze["development_summary"]["ground_truth_rows_loaded"] == 0, "freeze ground-truth boundary weakened")
    require(freeze["development_summary"]["platform_ahrs_rows_used"] == 0, "freeze platform-AHRS boundary weakened")
    require(freeze["development_summary"]["model_weights_loaded"] == 0, "freeze model boundary weakened")
    require(freeze["development_summary"]["validation_present_before_development"] is False, "freeze records validation leakage")
    require(freeze["development_summary"]["decision"] == development["decision"], "freeze decision mismatch")
    require(freeze["accuracy_claim_allowed"] is False, "freeze enabled accuracy claim")
    require(freeze["product_adoption_allowed"] is False, "freeze enabled product adoption")
    require(freeze["personal_pilot_allowed"] is False, "freeze enabled personal pilot")

    frozen_by_id = {sequence["id"]: sequence for sequence in freeze["sequences"]}
    require(set(frozen_by_id) == {summary["id"] for summary in summaries}, "freeze sequence set mismatch")
    for summary in summaries:
        frozen = frozen_by_id[summary["id"]]
        require(frozen["eligible_rows"] == summary["eligible_rows"], f"freeze row mismatch: {summary['id']}")
        require(frozen["step_count"]["50_hz"] == summary["steps_50_hz"], f"freeze 50 Hz step mismatch: {summary['id']}")
        require(frozen["step_count"]["100_hz"] == summary["steps_100_hz"], f"freeze 100 Hz step mismatch: {summary['id']}")
        for key, value in summary.items():
            if key in {"id", "eligible_rows", "steps_50_hz", "steps_100_hz"}:
                continue
            require(close(frozen["rate_comparison"][key], value), f"freeze comparison mismatch: {summary['id']}/{key}")
        require(frozen["raw_gate_passed"] is True, f"freeze raw gate weakened: {summary['id']}")
        require(frozen["replay_gate_passed"] is True, f"freeze replay gate weakened: {summary['id']}")
        require(frozen["decision"] == "pipeline-compatible", f"freeze decision changed: {summary['id']}")

    qa = {
        "schema_version": 1,
        "experiment": EXPECTED_EXPERIMENT,
        "phase": "development-freeze",
        "qa_pass": True,
        "assertion_count": assertion_count,
        "development_output_sha256": sha256_file(args.development),
        "sequence_summaries": summaries,
        "decision": "validation-authorized-once-without-parameter-change",
        "accuracy_claim_allowed": False,
        "product_adoption_allowed": False,
        "personal_pilot_allowed": False,
    }
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(
            json.dumps(qa, indent=2, ensure_ascii=False, allow_nan=False) + "\n",
            encoding="utf-8",
        )
    print(json.dumps(qa, sort_keys=True))


if __name__ == "__main__":
    main()
