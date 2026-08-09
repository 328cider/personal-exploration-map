"""Build and execute the reader-facing RoNIN public-sequence notebook."""

from __future__ import annotations

from pathlib import Path

import nbformat
from nbclient import NotebookClient


REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
OUTPUT = REPOSITORY_ROOT / "research" / "pdr" / "notebooks" / "04_ronin_public_sequence.ipynb"


def markdown(source: str):
    return nbformat.v4.new_markdown_cell(source.strip())


def code(source: str):
    return nbformat.v4.new_code_cell(source.strip())


def build():
    notebook = nbformat.v4.new_notebook()
    notebook["metadata"] = {
        "kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},
        "language_info": {"name": "python", "version": "3.12"},
        "pdr_research": {
            "phase": "public-sequence-gate",
            "dataset": "RoNIN",
            "sequence": "a054_1",
            "evidence_kind": "public-sequence-benchmark-only",
            "claim_boundary": "stops current baseline configurations; does not establish Android feasibility or generalization",
        },
    }
    notebook["cells"] = [
        markdown(
            """
# RoNIN `a054_1` — first strict public-sequence replay

## tl;dr

- The official 3.2 GB unseen-subject archive was not downloaded in full. HTTP Range transferred about 67.1 MB for one sequence and verified ZIP CRC plus extracted-member SHA-256.
- Estimators received only raw Android IMU-device accelerometer, gyroscope, Game Rotation Vector, and raw IMU timestamps.
- Tango pose, synchronized time, `start_frame`, and `imu_time_offset` were isolated to evaluation.
- B0 was unsupported because no product-compatible step-event stream was admitted.
- B1 v1.1.0 uses Android's documented `atan2(R[1], R[4])` azimuth convention rather than generic Z-yaw extraction.
- All supported B1 ideal runs failed a catastrophic distance, heading, turn, or mirror gate at both 50 and 100 Hz. Turn MAE was about 43–60 degrees over 76 events.
- Decision: stop B0/B1 through B1 v1.1.0 as product candidates, do not start a personal pilot, and keep Android lifecycle feasibility as a separate unknown.
"""
        ),
        markdown(
            """
## Context & Methods

The official custom license is non-commercial scientific-research only and prohibits commercial product use and redistribution without SFU permission. The exact license URL and SHA-256 are in the committed artifact specification.

### Assumptions and claim boundary

1. `raw/imu/acce`, `raw/imu/gyro`, and `raw/imu/game_rv` preserve Android API semantics; the HDF quaternion is explicitly reordered from `w,x,y,z` to Android-like `x,y,z,w`.
2. Source rates above 200 Hz are downsampled causally to 50/100 Hz and are not product requirements.
3. Rotation-vector azimuth follows Android `SensorManager.getOrientation()` (`atan2(R[1], R[4])`) and is converted to mathematical heading with `pi/2 - azimuth`.
4. Callback timestamps and Android sensor capability metadata are absent, so this sequence cannot pass lifecycle or device-support gates.
5. Tango orientation and the evaluation-only `align_tango_to_body` label define body-heading truth and the evaluation frame. No ICP or later shape alignment is applied.
6. One public sequence can reject these configurations but cannot prove unseen-device/user generalization.
"""
        ),
        code(
            """
from pathlib import Path
import json
import subprocess
import sys

repository_root = Path.cwd()
report_path = Path("/outputs/ronin-a054_1-replay.json")
sequence_root = Path("/data/ronin/a054_1")
manifest_path = repository_root / "research" / "pdr" / "datasets" / "manifests" / "ronin-a054_1.json"

if not report_path.exists():
    subprocess.run(
        [
            sys.executable,
            "research/pdr/scripts/replay_ronin_sequence.py",
            "--sequence-root", str(sequence_root),
            "--output", str(report_path),
        ],
        check=True,
    )

report = json.loads(report_path.read_text(encoding="utf-8"))
manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
print(
    f"records={report['record_count']} supported={report['supported_record_count']} "
    f"future_violations={report['future_sample_violations']}"
)
print(
    f"range_bytes={manifest['artifact']['http_range_bytes_transferred']} "
    f"archive_bytes={manifest['artifact']['archive_size_bytes']}"
)
"""
        ),
        markdown("## Results\n\n### Ideal raw-stream records"),
        code(
            """
print(f"{'rate':>4} {'profile':<16} {'supported':>9} {'truth m':>9} {'estimate m':>10} {'scale':>8} {'drift':>8} {'heading':>9} {'mirror':>7}")
print("-" * 94)
for record in report["records"]:
    if record["scenario"] != "ideal-raw":
        continue
    metrics = record["metrics"]
    if not record["supported"]:
        print(f"{record['target_rate_hz']:>4} {record['capability_profile']:<16} {'no':>9} {'-':>9} {'-':>10} {'-':>8} {'-':>8} {'-':>9} {'-':>7}")
        continue
    print(
        f"{record['target_rate_hz']:>4} {record['capability_profile']:<16} {'yes':>9} "
        f"{metrics['truth_distance_m']:>9.1f} {metrics['estimated_distance_m']:>10.1f} "
        f"{metrics['distance_scale_error']:>8.3f} {metrics['endpoint_drift_ratio']:>8.3f} "
        f"{metrics['heading_mae_deg']:>9.1f} {str(metrics['mirrored']):>7}"
    )
"""
        ),
        markdown("### Acceptance assertions"),
        code(
            """
assert report["record_count"] == 32
assert report["supported_record_count"] == 24
assert report["future_sample_violations"] == 0
assert report["decision"] == "benchmark-only-not-product-go"
assert manifest["license"]["commercial_product_use"] == "prohibited"

b0 = [record for record in report["records"] if record["estimator"].startswith("B0")]
assert len(b0) == 8 and all(not record["supported"] for record in b0)

supported = [record for record in report["records"] if record["supported"]]
for rate in (50, 100):
    for estimator in {record["estimator"] for record in supported if record["target_rate_hz"] == rate}:
        selected = {
            record["scenario"]: record
            for record in supported
            if record["target_rate_hz"] == rate and record["estimator"] == estimator
        }
        assert selected["ideal-raw"]["metrics"] == selected["batch-250ms"]["metrics"]
        assert (
            selected["gap-600ms"]["metrics"]["maximum_uncertainty_m"]
            > selected["ideal-raw"]["metrics"]["maximum_uncertainty_m"]
        )

ideal_b1 = [
    record
    for record in supported
    if record["scenario"] == "ideal-raw" and record["estimator"].startswith("B1")
]
assert len(ideal_b1) == 6 and all(record["failure_flags"] for record in ideal_b1)

manifest_results = {
    (item["target_rate_hz"], item["profile"]): item
    for item in manifest["replay"]["ideal_results"]
}
for record in ideal_b1:
    expected = manifest_results[(record["target_rate_hz"], record["capability_profile"])]
    for manifest_key, metric_key in (
        ("truth_distance_m", "truth_distance_m"),
        ("estimated_distance_m", "estimated_distance_m"),
        ("distance_scale_error", "distance_scale_error"),
        ("endpoint_drift_ratio", "endpoint_drift_ratio"),
        ("heading_mae_deg", "heading_mae_deg"),
        ("turn_mae_deg", "turn_angle_mae_deg"),
        ("evaluated_turn_count", "evaluated_turn_count"),
    ):
        assert expected[manifest_key] == record["metrics"][metric_key]
    assert expected["mirrored"] == record["metrics"]["mirrored"]
print("All license, leakage, capability, batching, gap, and stop-boundary assertions passed.")
"""
        ),
        markdown(
            """
## Takeaways

1. The raw Android-field adapter and label-isolation gates work on a real HDF5 sequence at both target rates.
2. The current step detector/stride rule estimates roughly 570–613 m for about 381 m of truth, so low endpoint drift in `imu6` does not imply acceptable distance.
3. Correct Android azimuth semantics reduce platform heading MAE, but the paths remain mirrored and have catastrophic turn error. Device orientation is still not body heading.
4. Callback batching independence and explicit gap uncertainty work, but real callback gaps and screen-off behavior are absent from the artifact.
5. Confidence is sufficient to stop these exact baseline configurations. It is not sufficient for a product Go, a personal pilot, or an Android feasibility claim.
"""
        ),
    ]
    return notebook


def main() -> None:
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    notebook = build()
    client = NotebookClient(
        notebook,
        timeout=300,
        kernel_name="python3",
        resources={"metadata": {"path": str(REPOSITORY_ROOT)}},
    )
    client.execute()
    nbformat.validate(notebook)
    nbformat.write(notebook, OUTPUT)
    print(f"Wrote and executed {OUTPUT}")


if __name__ == "__main__":
    main()
