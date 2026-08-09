"""Run a predeclared heading-convention and stride-gain sensitivity diagnostic."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from pdr_research.compatibility import validate_estimator_output  # noqa: E402
from pdr_research.contracts import EstimatePoint  # noqa: E402
from pdr_research.estimators import run_b1  # noqa: E402
from pdr_research.metrics import evaluate_estimator_output  # noqa: E402
from pdr_research.ronin import load_ronin_raw_fixture  # noqa: E402


WEINBERG_GAINS = (0.364, 0.400, 0.450, 0.640)
PROFILES = ("imu6", "platform-fused")


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def path_length(points: tuple[EstimatePoint, ...]) -> float:
    return sum(
        math.hypot(right.x_m - left.x_m, right.y_m - left.y_m)
        for left, right in zip(points, points[1:])
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--sequence-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    artifact_manifest = json.loads(
        (args.sequence_root / "artifact_manifest.json").read_text(encoding="utf-8")
    )
    hdf_member = next(
        member
        for member in artifact_manifest["members"]
        if member["output_name"] == "data.hdf5"
    )
    actual_hash = file_sha256(args.sequence_root / "data.hdf5")
    if actual_hash != hdf_member["sha256"]:
        raise ValueError("Extracted RoNIN HDF5 hash no longer matches its manifest")

    records: list[dict[str, object]] = []
    for target_rate_hz in (50, 100):
        fixture = load_ronin_raw_fixture(
            data_path=args.sequence_root / "data.hdf5",
            info_path=args.sequence_root / "info.json",
            member_sha256=actual_hash,
            target_rate_hz=target_rate_hz,
        )
        for profile in PROFILES:
            for gain in WEINBERG_GAINS:
                run = run_b1(
                    fixture.session,
                    capability_profile=profile,
                    weinberg_gain=gain,
                )
                if not run.supported or run.output is None:
                    raise AssertionError("Declared diagnostic baseline became unsupported")
                validate_estimator_output(run.output)
                evaluation = evaluate_estimator_output(
                    session_id=fixture.session.session_id,
                    truth=fixture.ground_truth,
                    output=run.output,
                    seed=0,
                    dataset_hash=fixture.dataset_hash,
                )
                records.append(
                    {
                        "target_rate_hz": target_rate_hz,
                        "capability_profile": profile,
                        "weinberg_gain": gain,
                        "estimator": run.requirement.estimator,
                        "estimator_version": run.requirement.version,
                        "used_sensor_types": sorted(run.used_sensor_types),
                        "fallback_flags": list(run.fallback_flags),
                        "metrics": dict(evaluation.metrics),
                        "failure_flags": list(evaluation.failure_flags),
                        "recomputed_path_length_m": path_length(run.output.points),
                    }
                )

    if len(records) != 16:
        raise AssertionError("Unexpected heading/stride diagnostic cardinality")
    if any(record["metrics"]["future_sample_violations"] for record in records):
        raise AssertionError("Diagnostic estimator used a future sample")
    for target_rate_hz in (50, 100):
        for profile in PROFILES:
            group = [
                record
                for record in records
                if record["target_rate_hz"] == target_rate_hz
                and record["capability_profile"] == profile
            ]
            distances = [record["metrics"]["estimated_distance_m"] for record in group]
            if distances != sorted(distances):
                raise AssertionError("Stride gain did not monotonically change distance")
            headings = {round(record["metrics"]["heading_mae_deg"], 12) for record in group}
            if len(headings) != 1:
                raise AssertionError("Stride-only sensitivity changed heading")
            for record in group:
                if not math.isclose(
                    record["metrics"]["estimated_distance_m"],
                    record["recomputed_path_length_m"],
                    rel_tol=0.0,
                    abs_tol=1e-9,
                ):
                    raise AssertionError("Reported distance is inconsistent")

    payload = {
        "schema_version": 1,
        "dataset": "RoNIN",
        "sequence": artifact_manifest["sequence"],
        "artifact_member_sha256": actual_hash,
        "source_adapter_id": "ronin-raw-hdf5-v2",
        "evidence_kind": "public-sequence-diagnostic-only",
        "android_heading_definition": {
            "source": (
                "https://android.googlesource.com/platform/frameworks/base/"
                "+/android16-qpr2-release/"
                "core/java/android/hardware/SensorManager.java"
            ),
            "azimuth_formula": "atan2(R[1], R[4])",
            "estimator_conversion": "math_heading = pi/2 - android_azimuth",
        },
        "stride_sensitivity": {
            "formula": "length = K * (acceleration_peak_minus_valley) ** 0.25",
            "gains": list(WEINBERG_GAINS),
            "selection_rule": (
                "predeclared sensitivity only; do not select K from this test sequence"
            ),
            "calibration_gate": (
                "K varies by person, walking speed, and phone placement; an uncalibrated "
                "fixed K cannot support a product-Go decision"
            ),
        },
        "decision": {
            "heading": "stop-device-orientation-as-body-heading",
            "stride": "sensitivity-only-no-test-sequence-selection",
            "personal_pilot": "not-authorized-by-this-evidence",
        },
        "record_count": len(records),
        "future_sample_violations": 0,
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
                "future_sample_violations": 0,
                "output": str(args.output),
            },
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
