"""Develop or validate a causal rate-stable detector without row disclosure."""

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

from pdr_research.compatibility import validate_estimator_output  # noqa: E402
from pdr_research.estimators import (  # noqa: E402
    _acceleration_step_candidates,
    run_b1,
)
from pdr_research.metrics import evaluate_estimator_output  # noqa: E402
from pdr_research.rate_stability import (  # noqa: E402
    RatePairResult,
    passes_validation_gate,
    rank_development_pairs,
    relative_disagreement,
)
from pdr_research.ronin import RoNINFixture, load_ronin_raw_fixture  # noqa: E402
from pdr_research.step_detection import (  # noqa: E402
    CANDIDATE_CONFIGS,
    DetectedStep,
    StepDetectionSummary,
    detect_rate_stable_steps,
    get_step_detector_config,
    summarize_step_detection,
)
from pdr_research.synthetic import drop_time_ranges, rebatch_session  # noqa: E402


FIXED_WEINBERG_GAIN = 0.364


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def truth_distance_m(fixture: RoNINFixture) -> float:
    return sum(
        math.hypot(right.x_m - left.x_m, right.y_m - left.y_m)
        for left, right in zip(fixture.ground_truth, fixture.ground_truth[1:])
    )


def truth_moving_duration_s(
    fixture: RoNINFixture, *, speed_threshold_mps: float = 0.30
) -> float:
    moving_s = 0.0
    for left, right in zip(fixture.ground_truth, fixture.ground_truth[1:]):
        delta_s = (right.timestamp_ns - left.timestamp_ns) / 1_000_000_000
        if delta_s <= 0.0:
            continue
        distance_m = math.hypot(right.x_m - left.x_m, right.y_m - left.y_m)
        if distance_m / delta_s >= speed_threshold_mps:
            moving_s += delta_s
    return moving_s


def _step_payload(
    *,
    fixture: RoNINFixture,
    steps: tuple[DetectedStep, ...],
    config_id: str,
) -> dict[str, object]:
    summary = summarize_step_detection(steps, config_id=config_id)
    fixed_distance_m = (
        FIXED_WEINBERG_GAIN * summary.amplitude_quarter_power_sum
    )
    truth_distance = truth_distance_m(fixture)
    moving_duration = truth_moving_duration_s(fixture)
    run = run_b1(
        fixture.session,
        capability_profile="imu6",
        weinberg_gain=FIXED_WEINBERG_GAIN,
        step_detector_config_id=config_id,
    )
    if not run.supported or run.output is None:
        raise AssertionError("Registered rate-stable B1 configuration became unsupported")
    validate_estimator_output(run.output)
    evaluation = evaluate_estimator_output(
        session_id=fixture.session.session_id,
        truth=fixture.ground_truth,
        output=run.output,
        seed=0,
        dataset_hash=fixture.dataset_hash,
    )
    return {
        **asdict(summary),
        "fixed_unclamped_weinberg_distance_m": fixed_distance_m,
        "fixed_unclamped_distance_scale_error": (
            abs(fixed_distance_m / truth_distance - 1.0)
            if truth_distance
            else 0.0
        ),
        "truth_distance_m": truth_distance,
        "truth_moving_duration_s": moving_duration,
        "events_per_truth_moving_second": (
            summary.event_count / moving_duration if moving_duration else None
        ),
        "b1_metrics": dict(evaluation.metrics),
        "b1_failure_flags": list(evaluation.failure_flags),
    }


def _legacy_payload(fixture: RoNINFixture) -> dict[str, object]:
    steps = _acceleration_step_candidates(fixture.session)
    amplitudes = [amplitude for _, amplitude in steps]
    intervals = [
        (right[0] - left[0]) / 1_000_000_000
        for left, right in zip(steps, steps[1:])
    ]
    run = run_b1(
        fixture.session,
        capability_profile="imu6",
        weinberg_gain=FIXED_WEINBERG_GAIN,
    )
    if not run.supported or run.output is None:
        raise AssertionError("Legacy B1 unexpectedly became unsupported")
    evaluation = evaluate_estimator_output(
        session_id=fixture.session.session_id,
        truth=fixture.ground_truth,
        output=run.output,
        seed=0,
        dataset_hash=fixture.dataset_hash,
    )
    return {
        "event_count": len(steps),
        "median_interval_s": (
            sorted(intervals)[len(intervals) // 2] if intervals else None
        ),
        "amplitude_quarter_power_sum": sum(
            amplitude ** 0.25 for amplitude in amplitudes
        ),
        "future_sample_violations": int(
            evaluation.metrics["future_sample_violations"]
        ),
        "b1_metrics": dict(evaluation.metrics),
        "b1_failure_flags": list(evaluation.failure_flags),
    }


def _load_fixture(sequence_root: Path, rate_hz: int) -> RoNINFixture:
    manifest = json.loads(
        (sequence_root / "artifact_manifest.json").read_text(encoding="utf-8")
    )
    member = next(
        item for item in manifest["members"] if item["output_name"] == "data.hdf5"
    )
    actual_hash = file_sha256(sequence_root / "data.hdf5")
    if actual_hash != member["sha256"]:
        raise ValueError(f"HDF5 hash mismatch for {sequence_root.name}")
    return load_ronin_raw_fixture(
        data_path=sequence_root / "data.hdf5",
        info_path=sequence_root / "info.json",
        member_sha256=actual_hash,
        target_rate_hz=rate_hz,
    )


def _pair_payload(
    *,
    config_id: str,
    by_rate: dict[int, dict[str, object]],
    batch_invariant: bool,
) -> tuple[RatePairResult, dict[str, object]]:
    at_50 = StepDetectionSummary(
        config_id=config_id,
        event_count=int(by_rate[50]["event_count"]),
        median_interval_s=by_rate[50]["median_interval_s"],
        amplitude_quarter_power_sum=float(
            by_rate[50]["amplitude_quarter_power_sum"]
        ),
        future_sample_violations=int(by_rate[50]["future_sample_violations"]),
    )
    at_100 = StepDetectionSummary(
        config_id=config_id,
        event_count=int(by_rate[100]["event_count"]),
        median_interval_s=by_rate[100]["median_interval_s"],
        amplitude_quarter_power_sum=float(
            by_rate[100]["amplitude_quarter_power_sum"]
        ),
        future_sample_violations=int(by_rate[100]["future_sample_violations"]),
    )
    pair = RatePairResult(
        config_id=config_id,
        at_50_hz=at_50,
        at_100_hz=at_100,
        batch_invariant=batch_invariant,
    )
    return pair, {
        "config_id": config_id,
        "eligible": pair.eligible,
        "batch_invariant": batch_invariant,
        "relative_count_disagreement": pair.relative_count_disagreement,
        "relative_amplitude_score_disagreement": (
            pair.relative_amplitude_score_disagreement
        ),
        "passes_validation_gate": passes_validation_gate(pair),
        "rates": {str(rate): by_rate[rate] for rate in (50, 100)},
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--phase", choices=("development", "validation"), required=True)
    parser.add_argument("--sequence-root", type=Path, action="append", required=True)
    parser.add_argument(
        "--split",
        type=Path,
        default=ROOT / "datasets" / "splits" / "ronin-rate-stability-v1.json",
    )
    parser.add_argument(
        "--frozen-spec",
        type=Path,
        default=(
            ROOT
            / "datasets"
            / "splits"
            / "ronin-rate-stability-v1-frozen.json"
        ),
    )
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    split = json.loads(args.split.read_text(encoding="utf-8"))
    assignment_by_sequence = {
        item["sequence"]: item for item in split["assignments"]
    }
    supplied_sequences = {path.name for path in args.sequence_root}
    if args.phase == "development":
        expected = {
            item["sequence"]
            for item in split["assignments"]
            if item["role"] == "development"
        }
        configs = CANDIDATE_CONFIGS
        frozen_spec: dict[str, object] | None = None
    else:
        expected = {
            item["sequence"]
            for item in split["assignments"]
            if str(item["role"]).startswith("validation-")
        }
        frozen_spec = json.loads(args.frozen_spec.read_text(encoding="utf-8"))
        if frozen_spec["experiment"] != split["experiment"]:
            raise ValueError("Frozen config belongs to a different experiment")
        configs = (get_step_detector_config(str(frozen_spec["config_id"])),)
        if asdict(configs[0]) != frozen_spec["config"]:
            raise ValueError("Frozen detector parameters differ from registered code")
        for relative_path, expected_hash in frozen_spec[
            "implementation_sha256"
        ].items():
            if file_sha256(ROOT / relative_path) != expected_hash:
                raise ValueError(
                    f"Frozen implementation hash changed: {relative_path}"
                )
    if supplied_sequences != expected:
        raise ValueError(
            f"{args.phase} requires exactly {sorted(expected)}, got "
            f"{sorted(supplied_sequences)}"
        )

    sequence_payloads: list[dict[str, object]] = []
    for sequence_root in sorted(args.sequence_root):
        sequence = sequence_root.name
        info = json.loads((sequence_root / "info.json").read_text(encoding="utf-8"))
        fixtures = {rate: _load_fixture(sequence_root, rate) for rate in (50, 100)}
        config_payloads: list[dict[str, object]] = []
        pair_results: list[RatePairResult] = []
        for config in configs:
            by_rate: dict[int, dict[str, object]] = {}
            batch_invariant = True
            for rate, fixture in fixtures.items():
                steps = detect_rate_stable_steps(fixture.session, config=config)
                batched_steps = detect_rate_stable_steps(
                    rebatch_session(fixture.session, batch_latency_ms=250),
                    config=config,
                )
                batch_invariant = batch_invariant and steps == batched_steps
                by_rate[rate] = _step_payload(
                    fixture=fixture,
                    steps=steps,
                    config_id=config.config_id,
                )
                gap_start_s = min(
                    120.0, fixture.ground_truth[-1].timestamp_ns / 2_000_000_000
                )
                gapped_steps = detect_rate_stable_steps(
                    drop_time_ranges(
                        fixture.session, ((gap_start_s, gap_start_s + 0.6),)
                    ),
                    config=config,
                )
                gap_start_ns = round(gap_start_s * 1_000_000_000)
                gap_end_ns = round((gap_start_s + 0.6) * 1_000_000_000)
                by_rate[rate]["gap_600ms"] = {
                    "event_count": len(gapped_steps),
                    "future_sample_violations": sum(
                        step.source_end_ns > step.timestamp_ns
                        for step in gapped_steps
                    ),
                    "events_spanning_gap": sum(
                        step.source_start_ns < gap_start_ns
                        and step.source_end_ns >= gap_end_ns
                        for step in gapped_steps
                    ),
                }
            pair, pair_payload = _pair_payload(
                config_id=config.config_id,
                by_rate=by_rate,
                batch_invariant=batch_invariant,
            )
            pair_results.append(pair)
            config_payloads.append(pair_payload)

        ranked = rank_development_pairs(tuple(pair_results))
        selected_config_id = ranked[0].config_id if args.phase == "development" else None
        if args.phase == "validation" and any(
            payload["config_id"] != configs[0].config_id
            for payload in config_payloads
        ):
            raise AssertionError("Validation evaluated an unfrozen configuration")

        legacy_by_rate = {
            str(rate): _legacy_payload(fixture) for rate, fixture in fixtures.items()
        }
        legacy_pair = {
            "relative_count_disagreement": relative_disagreement(
                float(legacy_by_rate["50"]["event_count"]),
                float(legacy_by_rate["100"]["event_count"]),
            ),
            "relative_amplitude_score_disagreement": relative_disagreement(
                float(legacy_by_rate["50"]["amplitude_quarter_power_sum"]),
                float(legacy_by_rate["100"]["amplitude_quarter_power_sum"]),
            ),
            "rates": legacy_by_rate,
        }
        sequence_payloads.append(
            {
                "sequence": sequence,
                "role": assignment_by_sequence[sequence]["role"],
                "subject_key": assignment_by_sequence[sequence]["subject_key"],
                "device": info.get("device", "unknown"),
                "duration_s": info.get("length"),
                "selected_development_config_id": selected_config_id,
                "development_rank_order": (
                    [pair.config_id for pair in ranked]
                    if args.phase == "development"
                    else None
                ),
                "legacy": legacy_pair,
                "rate_stable": config_payloads,
            }
        )

    validation_pass = None
    if args.phase == "validation":
        validation_pass = all(
            bool(sequence["rate_stable"][0]["passes_validation_gate"])
            for sequence in sequence_payloads
        )
    payload = {
        "schema_version": 1,
        "experiment": split["experiment"],
        "phase": args.phase,
        "evidence_kind": "public-sequence-benchmark-only",
        "selection_uses_trajectory_truth": False,
        "fixed_weinberg_gain": FIXED_WEINBERG_GAIN,
        "frozen_spec": frozen_spec,
        "validation_pass": validation_pass,
        "decision_boundary": (
            "rate-stability diagnostic only; cannot establish PDR product Go"
        ),
        "sequences": sequence_payloads,
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
                "sequences": sorted(supplied_sequences),
                "validation_pass": validation_pass,
                "output": str(args.output),
            },
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
