"""Replay one verified RoNIN raw sequence at 50/100 Hz without raw-row output."""

from __future__ import annotations

import argparse
from dataclasses import replace
import hashlib
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from pdr_research.compatibility import (  # noqa: E402
    validate_estimator_output,
    validate_session,
)
from pdr_research.estimators import run_common_baselines  # noqa: E402
from pdr_research.metrics import evaluate_estimator_output  # noqa: E402
from pdr_research.ronin import load_ronin_raw_fixture  # noqa: E402
from pdr_research.synthetic import drop_sensor, drop_time_ranges, rebatch_session  # noqa: E402


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--sequence-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    artifact_manifest = json.loads(
        (args.sequence_root / "artifact_manifest.json").read_text(encoding="utf-8")
    )
    hdf_member = next(
        member for member in artifact_manifest["members"] if member["output_name"] == "data.hdf5"
    )
    actual_hash = file_sha256(args.sequence_root / "data.hdf5")
    if actual_hash != hdf_member["sha256"]:
        raise ValueError("Extracted RoNIN HDF5 hash no longer matches its manifest")

    records: list[dict[str, object]] = []
    evaluation_notes: tuple[str, ...] = ()
    for target_rate_hz in (50, 100):
        fixture = load_ronin_raw_fixture(
            data_path=args.sequence_root / "data.hdf5",
            info_path=args.sequence_root / "info.json",
            member_sha256=actual_hash,
            target_rate_hz=target_rate_hz,
        )
        evaluation_notes = fixture.evaluation_notes
        gap_start_s = min(120.0, fixture.ground_truth[-1].timestamp_ns / 2e9)
        scenarios = {
            "ideal-raw": fixture.session,
            "batch-250ms": rebatch_session(fixture.session, batch_latency_ms=250),
            "gap-600ms": drop_time_ranges(
                fixture.session, ((gap_start_s, gap_start_s + 0.6),)
            ),
            "imu6-only": drop_sensor(
                fixture.session, "TYPE_GAME_ROTATION_VECTOR"
            ),
        }
        for scenario, session in scenarios.items():
            validate_session(
                replace(
                    session,
                    capability_profile=(
                        "imu6" if scenario == "imu6-only" else "platform-fused"
                    ),
                )
            )
            original_samples = session.samples
            for run in run_common_baselines(session):
                record: dict[str, object] = {
                    "dataset": "RoNIN",
                    "sequence": fixture.sequence,
                    "target_rate_hz": target_rate_hz,
                    "scenario": scenario,
                    "estimator": run.requirement.estimator,
                    "estimator_version": run.requirement.version,
                    "capability_profile": run.requirement.required_capability_profile,
                    "supported": run.supported,
                    "used_sensor_types": sorted(run.used_sensor_types),
                    "missing_requirements": list(run.missing_requirements),
                    "fallback_flags": list(run.fallback_flags),
                    "dataset_hash": fixture.dataset_hash,
                    "evidence_kind": "public-sequence-benchmark-only",
                    "decision": "benchmark-only-not-product-go",
                }
                if run.output is not None:
                    validate_estimator_output(run.output)
                    evaluation = evaluate_estimator_output(
                        session_id=session.session_id,
                        truth=fixture.ground_truth,
                        output=run.output,
                        seed=0,
                        dataset_hash=fixture.dataset_hash,
                    )
                    record["metrics"] = dict(evaluation.metrics)
                    record["failure_flags"] = list(evaluation.failure_flags)
                else:
                    record["metrics"] = {}
                    record["failure_flags"] = ["unsupported-capability"]
                records.append(record)
            if session.samples != original_samples:
                raise AssertionError("Estimator mutated public replay evidence")

    supported = [record for record in records if record["supported"]]
    future_sample_violations = sum(
        int(record["metrics"].get("future_sample_violations", 0))
        for record in supported
    )
    if len(records) != 32 or len(supported) != 24:
        raise AssertionError("Unexpected public replay matrix cardinality")
    if future_sample_violations:
        raise AssertionError("Public replay used future sensor samples")
    b0_records = [record for record in records if str(record["estimator"]).startswith("B0")]
    if len(b0_records) != 8 or any(record["supported"] for record in b0_records):
        raise AssertionError("B0 must remain unsupported without compatible step events")
    for target_rate_hz in (50, 100):
        for estimator in {
            str(record["estimator"])
            for record in supported
            if record["target_rate_hz"] == target_rate_hz
        }:
            ideal = next(
                record
                for record in supported
                if record["target_rate_hz"] == target_rate_hz
                and record["scenario"] == "ideal-raw"
                and record["estimator"] == estimator
            )
            batched = next(
                record
                for record in supported
                if record["target_rate_hz"] == target_rate_hz
                and record["scenario"] == "batch-250ms"
                and record["estimator"] == estimator
            )
            gapped = next(
                record
                for record in supported
                if record["target_rate_hz"] == target_rate_hz
                and record["scenario"] == "gap-600ms"
                and record["estimator"] == estimator
            )
            if ideal["metrics"] != batched["metrics"]:
                raise AssertionError("Callback batching changed sensor-time metrics")
            if (
                gapped["metrics"]["maximum_uncertainty_m"]
                <= ideal["metrics"]["maximum_uncertainty_m"]
            ):
                raise AssertionError("Sensor gap did not increase reported uncertainty")
    if any(record["decision"] != "benchmark-only-not-product-go" for record in records):
        raise AssertionError("Public sequence claim boundary was weakened")

    payload = {
        "schema_version": 1,
        "dataset": "RoNIN",
        "sequence": artifact_manifest["sequence"],
        "artifact_member_sha256": actual_hash,
        "license": artifact_manifest["license"],
        "evidence_kind": "public-sequence-benchmark-only",
        "decision": "benchmark-only-not-product-go",
        "record_count": len(records),
        "supported_record_count": len(supported),
        "future_sample_violations": future_sample_violations,
        "evaluation_notes": list(evaluation_notes),
        "records": records,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(payload, indent=2, ensure_ascii=False, allow_nan=False) + "\n",
        encoding="utf-8",
    )
    print(
        json.dumps(
            {
                "record_count": len(records),
                "supported_record_count": len(supported),
                "future_sample_violations": payload["future_sample_violations"],
                "output": str(args.output),
            },
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
