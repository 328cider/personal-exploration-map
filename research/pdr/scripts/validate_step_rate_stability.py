"""Independent output-level QA for the rate-stability experiment.

This validator deliberately uses only the Python standard library and does not
import detector or ranking implementation code.  It recomputes headline ratios,
the preregistered ordering, validation gates, hashes, and comparison summaries.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def relative_disagreement(left: float, right: float) -> float:
    denominator = max(abs(left), abs(right))
    return abs(left - right) / denominator if denominator else 0.0


def close(left: float, right: float) -> bool:
    return math.isclose(left, right, rel_tol=0.0, abs_tol=1e-12)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--development",
        type=Path,
        default=Path("/outputs/ronin-rate-stability-development.json"),
    )
    parser.add_argument(
        "--validation",
        type=Path,
        default=Path("/outputs/ronin-rate-stability-validation.json"),
    )
    parser.add_argument(
        "--platform-comparison",
        type=Path,
        default=Path("/outputs/ronin-platform-step-counter-comparison.json"),
    )
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
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()

    development = json.loads(args.development.read_text(encoding="utf-8"))
    validation = json.loads(args.validation.read_text(encoding="utf-8"))
    platform = json.loads(args.platform_comparison.read_text(encoding="utf-8"))
    split = json.loads(args.split.read_text(encoding="utf-8"))
    frozen = json.loads(args.frozen_spec.read_text(encoding="utf-8"))
    assertions = 0

    def require(condition: bool, message: str) -> None:
        nonlocal assertions
        assertions += 1
        if not condition:
            raise AssertionError(message)

    experiment = split["experiment"]
    require(development["experiment"] == experiment, "development experiment mismatch")
    require(validation["experiment"] == experiment, "validation experiment mismatch")
    require(platform["experiment"] == experiment, "platform experiment mismatch")
    require(frozen["experiment"] == experiment, "frozen experiment mismatch")
    require(sha256(args.split) == frozen["split_sha256"], "split hash mismatch")
    require(
        sha256(args.development) == frozen["development"]["output_sha256"],
        "development output changed after freeze",
    )
    for relative_path, expected_hash in frozen["implementation_sha256"].items():
        require(
            sha256(ROOT / relative_path) == expected_hash,
            f"implementation hash mismatch: {relative_path}",
        )

    require(development["phase"] == "development", "wrong development phase")
    require(
        development["selection_uses_trajectory_truth"] is False,
        "development selection used trajectory truth",
    )
    require(len(development["sequences"]) == 1, "unexpected development cardinality")
    dev_sequence = development["sequences"][0]
    require(
        dev_sequence["sequence"] == frozen["development"]["sequence"],
        "development sequence mismatch",
    )
    recomputed_pairs: list[tuple[tuple[object, ...], str]] = []
    for pair in dev_sequence["rate_stable"]:
        at_50 = pair["rates"]["50"]
        at_100 = pair["rates"]["100"]
        count_disagreement = relative_disagreement(
            float(at_50["event_count"]), float(at_100["event_count"])
        )
        amplitude_disagreement = relative_disagreement(
            float(at_50["amplitude_quarter_power_sum"]),
            float(at_100["amplitude_quarter_power_sum"]),
        )
        eligible = (
            pair["batch_invariant"]
            and at_50["event_count"] >= 20
            and at_100["event_count"] >= 20
            and at_50["future_sample_violations"] == 0
            and at_100["future_sample_violations"] == 0
            and 0.25 <= at_50["median_interval_s"] <= 1.25
            and 0.25 <= at_100["median_interval_s"] <= 1.25
        )
        require(
            close(count_disagreement, pair["relative_count_disagreement"]),
            f"development count ratio mismatch: {pair['config_id']}",
        )
        require(
            close(
                amplitude_disagreement,
                pair["relative_amplitude_score_disagreement"],
            ),
            f"development amplitude ratio mismatch: {pair['config_id']}",
        )
        require(eligible == pair["eligible"], "development eligibility mismatch")
        recomputed_pairs.append(
            (
                (
                    not eligible,
                    count_disagreement,
                    amplitude_disagreement,
                    pair["config_id"],
                ),
                pair["config_id"],
            )
        )
    recomputed_order = [item[1] for item in sorted(recomputed_pairs)]
    require(
        recomputed_order == dev_sequence["development_rank_order"],
        "development rank order mismatch",
    )
    require(
        recomputed_order[0] == frozen["config_id"],
        "frozen config is not the truth-free winner",
    )

    expected_validation = {
        item["sequence"]
        for item in split["assignments"]
        if item["role"].startswith("validation-")
    }
    require(validation["phase"] == "validation", "wrong validation phase")
    require(
        {item["sequence"] for item in validation["sequences"]}
        == expected_validation,
        "validation sequence set mismatch",
    )
    validation_rows: list[dict[str, object]] = []
    for sequence in validation["sequences"]:
        require(len(sequence["rate_stable"]) == 1, "validation tried extra configs")
        pair = sequence["rate_stable"][0]
        require(pair["config_id"] == frozen["config_id"], "unfrozen validation config")
        at_50 = pair["rates"]["50"]
        at_100 = pair["rates"]["100"]
        count_disagreement = relative_disagreement(
            float(at_50["event_count"]), float(at_100["event_count"])
        )
        amplitude_disagreement = relative_disagreement(
            float(at_50["amplitude_quarter_power_sum"]),
            float(at_100["amplitude_quarter_power_sum"]),
        )
        gate = (
            pair["batch_invariant"]
            and at_50["event_count"] >= 20
            and at_100["event_count"] >= 20
            and at_50["future_sample_violations"] == 0
            and at_100["future_sample_violations"] == 0
            and 0.25 <= at_50["median_interval_s"] <= 1.25
            and 0.25 <= at_100["median_interval_s"] <= 1.25
            and count_disagreement <= 0.01
            and amplitude_disagreement <= 0.02
        )
        require(close(count_disagreement, pair["relative_count_disagreement"]), "validation count ratio mismatch")
        require(close(amplitude_disagreement, pair["relative_amplitude_score_disagreement"]), "validation amplitude ratio mismatch")
        require(gate == pair["passes_validation_gate"], "validation gate mismatch")
        require(gate, f"validation gate failed: {sequence['sequence']}")
        validation_rows.append(
            {
                "sequence": sequence["sequence"],
                "device": sequence["device"],
                "count_50_hz": at_50["event_count"],
                "count_100_hz": at_100["event_count"],
                "relative_count_disagreement": count_disagreement,
                "relative_amplitude_disagreement": amplitude_disagreement,
                "b1_distance_scale_error_50_hz": at_50["b1_metrics"][
                    "distance_scale_error"
                ],
                "b1_distance_scale_error_100_hz": at_100["b1_metrics"][
                    "distance_scale_error"
                ],
                "b1_heading_mae_50_hz": at_50["b1_metrics"]["heading_mae_deg"],
                "b1_heading_mae_100_hz": at_100["b1_metrics"]["heading_mae_deg"],
            }
        )
    require(validation["validation_pass"] is True, "aggregate validation pass mismatch")

    all_assigned = {item["sequence"] for item in split["assignments"]}
    require(
        {item["sequence"] for item in platform["records"]} == all_assigned,
        "platform comparison omitted a sequence",
    )
    require(platform["config_id"] == frozen["config_id"], "platform config mismatch")
    recomputed_platform_errors: list[float] = []
    platform_rows: list[dict[str, object]] = []
    for record in platform["records"]:
        reference_count = int(record["platform_step_counter"]["counter_delta"])
        require(reference_count > 0, "empty platform counter")
        per_rate: dict[str, object] = {}
        for rate, values in record["rates"].items():
            signed_error = (
                int(values["custom_event_count"]) - reference_count
            ) / reference_count
            require(
                close(signed_error, values["signed_count_error_vs_platform"]),
                "platform signed error mismatch",
            )
            require(
                close(abs(signed_error), values["absolute_count_error_vs_platform"]),
                "platform absolute error mismatch",
            )
            recomputed_platform_errors.append(abs(signed_error))
            per_rate[rate] = signed_error
        platform_rows.append(
            {
                "sequence": record["sequence"],
                "platform_count": reference_count,
                "signed_error_50_hz": per_rate["50"],
                "signed_error_100_hz": per_rate["100"],
            }
        )
    maximum_platform_error = max(recomputed_platform_errors)
    require(
        close(
            maximum_platform_error,
            platform["maximum_absolute_count_error_vs_platform"],
        ),
        "maximum platform disagreement mismatch",
    )
    require(
        platform["decision"]["product_or_personal_pilot"] == "stop",
        "platform diagnostic weakened Stop boundary",
    )

    devices = {
        dev_sequence["device"],
        *(row["device"] for row in validation_rows),
    }
    require(len(devices) == 3, "device identifiers are not disjoint")
    payload = {
        "schema_version": 1,
        "experiment": experiment,
        "qa_pass": True,
        "assertion_count": assertions,
        "frozen_config_id": frozen["config_id"],
        "development_output_sha256": sha256(args.development),
        "validation_output_sha256": sha256(args.validation),
        "platform_comparison_sha256": sha256(args.platform_comparison),
        "validation_rows": validation_rows,
        "platform_rows": platform_rows,
        "maximum_absolute_count_error_vs_platform": maximum_platform_error,
        "interpretation": (
            "Rate stability passed independently recomputed gates, but count "
            "accuracy and body heading remain blockers; product/pilot stays Stop."
        ),
    }
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(
            json.dumps(payload, indent=2, ensure_ascii=False, allow_nan=False) + "\n",
            encoding="utf-8",
        )
    print(json.dumps(payload, sort_keys=True))


if __name__ == "__main__":
    main()
