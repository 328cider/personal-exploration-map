"""Independent QA for the preregistered IPIN classical replay.

The validator intentionally uses only the Python standard library and does not
import the IPIN adapter, step detector, or estimator.  It verifies the frozen
development boundary and independently recomputes every aggregate replay gate
from the persisted development and untouched-validation outputs.
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
RESULT_MANIFEST = (
    ROOT / "datasets" / "manifests" / "ipin-classical-result-v1.json"
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


def result_sequence_summary(
    sequence: dict[str, object], *, phase: str
) -> dict[str, object]:
    preflight = sequence["preflight"]
    at_50 = sequence["replay"]["rates"]["50"]
    at_100 = sequence["replay"]["rates"]["100"]
    comparison = sequence["replay"]["rate_comparison"]
    magnetometer = preflight["streams"]["TYPE_MAGNETIC_FIELD"]
    return {
        "phase": phase,
        "id": sequence["id"],
        "role": sequence["role"],
        "user": sequence["user"],
        "trial": sequence["trial"],
        "source_sha256": sequence["artifact"]["sha256"],
        "source_bytes": sequence["artifact"]["uncompressed_bytes"],
        "eligible_rows": preflight["eligible_event_count"],
        "common_coverage_s": preflight["common_imu_coverage_s"],
        "accelerometer_median_rate_hz": preflight["streams"][
            "TYPE_ACCELEROMETER"
        ]["median_rate_hz"],
        "gyroscope_median_rate_hz": preflight["streams"]["TYPE_GYROSCOPE"][
            "median_rate_hz"
        ],
        "magnetometer_present": magnetometer["event_count"] > 0,
        "magnetometer_median_rate_hz": magnetometer["median_rate_hz"],
        "raw_imu_gaps_over_0_2_s": preflight["streams"]["TYPE_ACCELEROMETER"][
            "gaps_over_0_2_s"
        ]
        + preflight["streams"]["TYPE_GYROSCOPE"]["gaps_over_0_2_s"],
        "steps_50_hz": at_50["step_detection"]["event_count"],
        "steps_100_hz": at_100["step_detection"]["event_count"],
        "derived_distance_50_m": at_50["estimator"]["travelled_distance_m"],
        "derived_distance_100_m": at_100["estimator"]["travelled_distance_m"],
        "step_count_relative_difference": comparison[
            "step_count_relative_difference"
        ],
        "amplitude_score_relative_difference": comparison[
            "amplitude_score_relative_difference"
        ],
        "travelled_distance_relative_difference": comparison[
            "travelled_distance_relative_difference"
        ],
        "endpoint_separation_m": comparison["endpoint_separation_m"],
        "endpoint_separation_over_longer_distance": comparison[
            "endpoint_separation_over_longer_distance"
        ],
        "raw_gate_passed": all(sequence["raw_gate"].values()),
        "replay_gate_passed": all(sequence["replay"]["gate"].values()),
        "decision": sequence["decision"],
    }


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
        admitted_record_types = set(preflight["admitted_record_types"])
        require(
            {"ACCE", "GYRO"} <= admitted_record_types <= ADMITTED_RECORD_TYPES,
            f"required stream missing or input allowlist changed: {sequence_id}",
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
        "--phase", choices=("development", "final"), default="development"
    )
    parser.add_argument(
        "--development",
        type=Path,
        default=Path("/outputs/ipin-classical-development-v1.json"),
    )
    parser.add_argument(
        "--validation",
        type=Path,
        default=Path("/outputs/ipin-classical-validation-v1.json"),
    )
    parser.add_argument("--result-manifest", type=Path, default=RESULT_MANIFEST)
    parser.add_argument("--input-root", type=Path, default=Path("/data/ipin2022"))
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

    qa_phase = "development-freeze"
    qa_decision = "validation-authorized-once-without-parameter-change"
    qa_summaries = summaries
    validation_output_hash: str | None = None
    if args.phase == "final":
        validation = json.loads(args.validation.read_text(encoding="utf-8"))
        result = json.loads(args.result_manifest.read_text(encoding="utf-8"))
        validation_summaries = validate_output(
            payload=validation,
            preregistration=preregistration,
            phase="validation",
            require=require,
        )
        validation_output_hash = sha256_file(args.validation)
        require(
            {sequence["user"] for sequence in development["sequences"]}
            .isdisjoint({sequence["user"] for sequence in validation["sequences"]}),
            "development and validation users overlap",
        )

        require(result["schema_version"] == 1, "unexpected result schema")
        require(result["experiment"] == EXPECTED_EXPERIMENT, "wrong result experiment")
        require(result["status"] == "validation-complete", "validation not complete")
        require(result["protocol_sha256"] == sha256_file(PROTOCOL), "result protocol hash mismatch")
        require(result["preregistration_sha256"] == sha256_file(PREREGISTRATION), "result preregistration hash mismatch")
        require(result["development_freeze_sha256"] == sha256_file(DEVELOPMENT_FREEZE), "result freeze hash mismatch")
        require(result["development_output_sha256"] == sha256_file(args.development), "result development hash mismatch")
        require(result["validation_output_sha256"] == validation_output_hash, "result validation hash mismatch")
        for relative_path, expected_hash in result["implementation_sha256"].items():
            require(expected_hash != "PENDING", f"pending implementation hash: {relative_path}")
            require(
                sha256_file(ROOT / relative_path) == expected_hash,
                f"final implementation changed: {relative_path}",
            )

        control = result["execution_control"]
        require(control["development_committed_before_validation_fetch"] is True, "development commit boundary weakened")
        require(control["development_commit"] == "ab709181b81a343cdf5feb7ad9fbfea1bbb546e5", "development commit changed")
        require(control["development_user"] == "03", "wrong development user")
        require(control["validation_user"] == "05", "wrong validation user")
        require(control["user_split_disjoint"] is True, "user split marked overlapping")
        require(control["validation_run_count"] == 1, "validation run count changed")
        require(control["parameter_search_performed"] is False, "post-validation tuning recorded")
        for key in ("ground_truth_rows_loaded", "platform_ahrs_rows_used", "model_weights_loaded"):
            require(control[key] == 0, f"forbidden final input recorded: {key}")

        acquisition = result["acquisition"]
        require(acquisition["full_archive_size_bytes"] == 444265064, "archive size changed")
        require(acquisition["full_archive_downloaded"] is False, "full archive was downloaded")
        expected_acquisition = {
            "development": {
                "selected_members": 2,
                "http_range_requests": 8,
                "http_bytes_transferred": 4240230,
                "extracted_uncompressed_bytes": development["source_uncompressed_bytes"],
            },
            "validation": {
                "selected_members": 2,
                "http_range_requests": 6,
                "http_bytes_transferred": 2143078,
                "extracted_uncompressed_bytes": validation["source_uncompressed_bytes"],
            },
        }
        require(
            acquisition["development"] == expected_acquisition["development"],
            "development acquisition accounting mismatch",
        )
        require(
            acquisition["validation"] == expected_acquisition["validation"],
            "validation acquisition accounting mismatch",
        )
        require(
            acquisition["development"]["http_bytes_transferred"]
            + acquisition["validation"]["http_bytes_transferred"]
            < acquisition["full_archive_size_bytes"],
            "range transfer accounting is not bounded below full archive size",
        )

        expected_input_contract = {
            "required_records": ["ACCE", "GYRO"],
            "optional_records": ["MAGN"],
            "forbidden_records": [
                "AHRS",
                "POSI",
                "GNSS",
                "IMUL",
                "IMUX",
                "BLE4",
                "WIFI",
                "RFID",
            ],
            "android_mapping": {
                "ACCE": "Sensor.TYPE_ACCELEROMETER",
                "GYRO": "Sensor.TYPE_GYROSCOPE",
                "MAGN": "Sensor.TYPE_MAGNETIC_FIELD",
            },
            "rates_hz": [50, 100],
            "sensor_timestamp_primary": True,
            "app_timestamp_role": (
                "callback timing proxy for pipeline diagnostics only; not a "
                "retained Android callback monotonic clock"
            ),
            "magnetometer_used_by_estimator": False,
            "ground_truth_available_to_estimator": False,
        }
        require(result["input_contract"] == expected_input_contract, "final input contract changed")

        expected_result_sequences = [
            *(
                result_sequence_summary(sequence, phase="development")
                for sequence in development["sequences"]
            ),
            *(
                result_sequence_summary(sequence, phase="validation")
                for sequence in validation["sequences"]
            ),
        ]
        require(result["sequences"] == expected_result_sequences, "result sequence summaries mismatch")
        all_sequences = [*development["sequences"], *validation["sequences"]]
        all_comparisons = [
            sequence["replay"]["rate_comparison"] for sequence in all_sequences
        ]
        validation_comparisons = [
            sequence["replay"]["rate_comparison"]
            for sequence in validation["sequences"]
        ]
        future_sample_violations = sum(
            sequence["replay"]["rates"][rate][section][
                "future_sample_violations"
            ]
            for sequence in all_sequences
            for rate in ("50", "100")
            for section in ("step_detection", "estimator", "gap_stress")
        )
        expected_aggregate = {
            "source_sequence_count": len(all_sequences),
            "development_sequence_count": len(development["sequences"]),
            "validation_sequence_count": len(validation["sequences"]),
            "source_uncompressed_bytes": development["source_uncompressed_bytes"]
            + validation["source_uncompressed_bytes"],
            "eligible_sensor_rows_loaded": development[
                "eligible_sensor_rows_loaded"
            ]
            + validation["eligible_sensor_rows_loaded"],
            "development_eligible_sensor_rows": development[
                "eligible_sensor_rows_loaded"
            ],
            "validation_eligible_sensor_rows": validation[
                "eligible_sensor_rows_loaded"
            ],
            "raw_gate_pass_count": sum(
                all(sequence["raw_gate"].values()) for sequence in all_sequences
            ),
            "replay_gate_pass_count": sum(
                all(sequence["replay"]["gate"].values())
                for sequence in all_sequences
            ),
            "rate_replays_run": len(all_sequences) * 2,
            "callback_batch_invariant_count": sum(
                sequence["replay"]["rates"][rate][
                    "callback_batch_output_exact"
                ]
                for sequence in all_sequences
                for rate in ("50", "100")
            ),
            "magnetometer_removal_invariant_count": sum(
                sequence["replay"]["rates"][rate][
                    "magnetometer_removal_output_exact"
                ]
                for sequence in all_sequences
                for rate in ("50", "100")
            ),
            "gap_stress_pass_count": sum(
                sequence["replay"]["rates"][rate]["gap_stress"][
                    "additional_gap_registered"
                ]
                and sequence["replay"]["rates"][rate]["gap_stress"][
                    "uncertainty_not_lower"
                ]
                and sequence["replay"]["rates"][rate]["gap_stress"][
                    "future_sample_violations"
                ]
                == 0
                and sequence["replay"]["rates"][rate]["gap_stress"][
                    "nonfinite_value_count"
                ]
                == 0
                for sequence in all_sequences
                for rate in ("50", "100")
            ),
            "future_sample_violations": future_sample_violations,
            "validation_sequences_without_magnetometer": sum(
                sequence["preflight"]["streams"]["TYPE_MAGNETIC_FIELD"][
                    "event_count"
                ]
                == 0
                for sequence in validation["sequences"]
            ),
            "maximum_all_sequence_step_count_relative_difference": max(
                item["step_count_relative_difference"] for item in all_comparisons
            ),
            "maximum_all_sequence_amplitude_relative_difference": max(
                item["amplitude_score_relative_difference"]
                for item in all_comparisons
            ),
            "maximum_all_sequence_distance_relative_difference": max(
                item["travelled_distance_relative_difference"]
                for item in all_comparisons
            ),
            "maximum_all_sequence_endpoint_separation_over_longer_distance": max(
                item["endpoint_separation_over_longer_distance"]
                for item in all_comparisons
            ),
            "maximum_validation_step_count_relative_difference": max(
                item["step_count_relative_difference"]
                for item in validation_comparisons
            ),
            "maximum_validation_amplitude_relative_difference": max(
                item["amplitude_score_relative_difference"]
                for item in validation_comparisons
            ),
            "maximum_validation_distance_relative_difference": max(
                item["travelled_distance_relative_difference"]
                for item in validation_comparisons
            ),
            "maximum_validation_endpoint_separation_over_longer_distance": max(
                item["endpoint_separation_over_longer_distance"]
                for item in validation_comparisons
            ),
        }
        require(result["aggregate"] == expected_aggregate, "aggregate summary mismatch")

        result_by_id = {sequence["id"]: sequence for sequence in result["sequences"]}
        for sequence in validation["sequences"]:
            sequence_id = sequence["id"]
            directory = args.input_root / sequence_id
            artifact_manifest = json.loads(
                (directory / "artifact_manifest.json").read_text(encoding="utf-8")
            )
            require(artifact_manifest["phase"] == "validation", f"wrong fetch phase: {sequence_id}")
            require(artifact_manifest["license"] == "CC-BY-4.0", f"wrong artifact license: {sequence_id}")
            require(artifact_manifest["protocol_sha256"] == result["protocol_sha256"], f"artifact protocol mismatch: {sequence_id}")
            require(artifact_manifest["development_freeze_sha256"] == result["development_freeze_sha256"], f"artifact freeze mismatch: {sequence_id}")
            require(artifact_manifest["archive"]["full_archive_downloaded"] is False, f"full archive recorded: {sequence_id}")
            require(artifact_manifest["archive"]["size_bytes"] == acquisition["full_archive_size_bytes"], f"archive size mismatch: {sequence_id}")
            member = artifact_manifest["member"]
            require(member["sha256"] == result_by_id[sequence_id]["source_sha256"], f"artifact source hash mismatch: {sequence_id}")
            raw_path = directory / member["output_name"]
            require(raw_path.stat().st_size == member["uncompressed_bytes"], f"raw source size mismatch: {sequence_id}")
            require(sha256_file(raw_path) == member["sha256"], f"raw source changed: {sequence_id}")

        expected_decision = {
            "pipeline_compatibility": "pass-for-four-preregistered-IPIN-sequences",
            "capture_contract_implication": (
                "raw accelerometer and gyroscope at 50 or 100 Hz with sensor "
                "timestamps; magnetometer remains optional"
            ),
            "heading_distance_accuracy": "not-evaluated-no-continuous-target-truth",
            "android_lifecycle": "not-evaluated-app-timestamp-is-proxy-only",
            "product_adoption": "stop",
            "personal_pilot": "stop",
            "next_action": (
                "wait-for-rights-compatible-continuous-truth-or-approved-"
                "multi-user-capture"
            ),
        }
        require(result["decision"] == expected_decision, "final decision boundary changed")
        require(result["accuracy_claim_allowed"] is False, "final accuracy claim enabled")
        require(result["product_adoption_allowed"] is False, "final product adoption enabled")
        require(result["personal_pilot_allowed"] is False, "final personal pilot enabled")
        notebook = ROOT / result["notebook"]["path"]
        require(result["notebook"]["sha256"] != "PENDING", "notebook hash pending")
        require(sha256_file(notebook) == result["notebook"]["sha256"], "notebook hash mismatch")

        qa_phase = "final-validation"
        qa_decision = "pipeline-compatible-only; accuracy-product-and-pilot-stay-stop"
        qa_summaries = [*summaries, *validation_summaries]

    qa = {
        "schema_version": 1,
        "experiment": EXPECTED_EXPERIMENT,
        "phase": qa_phase,
        "qa_pass": True,
        "assertion_count": assertion_count,
        "development_output_sha256": sha256_file(args.development),
        "validation_output_sha256": validation_output_hash,
        "sequence_summaries": qa_summaries,
        "decision": qa_decision,
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
