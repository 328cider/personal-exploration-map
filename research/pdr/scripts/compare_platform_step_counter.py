"""Post-freeze comparison with RoNIN's Android Step Counter stream."""

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

from pdr_research.ronin import load_ronin_raw_fixture  # noqa: E402
from pdr_research.ronin_step_counter import (  # noqa: E402
    load_ronin_step_counter_reference,
)
from pdr_research.step_detection import (  # noqa: E402
    detect_rate_stable_steps,
    get_step_detector_config,
)


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def _truth_distance(fixture) -> float:
    return sum(
        math.hypot(right.x_m - left.x_m, right.y_m - left.y_m)
        for left, right in zip(fixture.ground_truth, fixture.ground_truth[1:])
    )


def main() -> None:
    parser = argparse.ArgumentParser()
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
    frozen = json.loads(args.frozen_spec.read_text(encoding="utf-8"))
    expected = {item["sequence"] for item in split["assignments"]}
    supplied = {path.name for path in args.sequence_root}
    if supplied != expected:
        raise ValueError(
            f"Platform comparison requires all {sorted(expected)}, got {sorted(supplied)}"
        )
    config = get_step_detector_config(frozen["config_id"])
    assignment_by_sequence = {
        item["sequence"]: item for item in split["assignments"]
    }

    records: list[dict[str, object]] = []
    for sequence_root in sorted(args.sequence_root):
        sequence = sequence_root.name
        manifest = json.loads(
            (sequence_root / "artifact_manifest.json").read_text(encoding="utf-8")
        )
        member = next(
            item
            for item in manifest["members"]
            if item["output_name"] == "data.hdf5"
        )
        actual_hash = file_sha256(sequence_root / "data.hdf5")
        if actual_hash != member["sha256"]:
            raise ValueError(f"HDF5 hash mismatch for {sequence}")
        reference = load_ronin_step_counter_reference(
            data_path=sequence_root / "data.hdf5",
            info_path=sequence_root / "info.json",
        )
        by_rate: dict[str, object] = {}
        truth_distance_m = None
        for rate_hz in (50, 100):
            fixture = load_ronin_raw_fixture(
                data_path=sequence_root / "data.hdf5",
                info_path=sequence_root / "info.json",
                member_sha256=actual_hash,
                target_rate_hz=rate_hz,
            )
            truth_distance_m = _truth_distance(fixture)
            steps = detect_rate_stable_steps(fixture.session, config=config)
            signed_error = (
                (len(steps) - reference.counter_delta) / reference.counter_delta
                if reference.counter_delta
                else None
            )
            by_rate[str(rate_hz)] = {
                "custom_event_count": len(steps),
                "signed_count_error_vs_platform": signed_error,
                "absolute_count_error_vs_platform": (
                    abs(signed_error) if signed_error is not None else None
                ),
            }
        assert truth_distance_m is not None
        records.append(
            {
                "sequence": sequence,
                "role": assignment_by_sequence[sequence]["role"],
                "subject_key": assignment_by_sequence[sequence]["subject_key"],
                "artifact_member_sha256": actual_hash,
                "platform_step_counter": asdict(reference),
                "truth_implied_mean_step_length_m": (
                    truth_distance_m / reference.counter_delta
                    if reference.counter_delta
                    else None
                ),
                "rates": by_rate,
            }
        )

    maximum_disagreement = max(
        float(rate["absolute_count_error_vs_platform"])
        for record in records
        for rate in record["rates"].values()
    )
    payload = {
        "schema_version": 1,
        "experiment": split["experiment"],
        "analysis_stage": "post-freeze-secondary-diagnostic",
        "config_id": config.config_id,
        "config_was_modified_after_validation": False,
        "platform_reference_role": "optional-android-live-input-comparator-not-ground-truth",
        "maximum_absolute_count_error_vs_platform": maximum_disagreement,
        "decision": {
            "rate_stability": "pass-predeclared-validation-gate",
            "step_count_accuracy": "not-established; heterogeneous platform disagreement",
            "product_or_personal_pilot": "stop",
            "reason": (
                "Rate stability cannot compensate for a detector that may count the "
                "wrong gait events; platform output itself is not ground truth"
            ),
        },
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
                "config_id": config.config_id,
                "maximum_absolute_count_error_vs_platform": maximum_disagreement,
                "output": str(args.output),
                "sequences": sorted(supplied),
            },
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
