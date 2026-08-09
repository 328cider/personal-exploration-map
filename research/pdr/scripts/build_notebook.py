"""Build and execute the Phase 1 notebook with nbformat/nbclient."""

from __future__ import annotations

from pathlib import Path

import nbformat
from nbclient import NotebookClient


REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
OUTPUT = REPOSITORY_ROOT / "research" / "pdr" / "notebooks" / "01_synthetic_foundation.ipynb"


def markdown(source: str):
    return nbformat.v4.new_markdown_cell(source.strip())


def code(source: str):
    return nbformat.v4.new_code_cell(source.strip())


def build():
    notebook = nbformat.v4.new_notebook()
    notebook["metadata"] = {
        "kernelspec": {
            "display_name": "Python 3 (PDR research)",
            "language": "python",
            "name": "python3",
        },
        "language_info": {"name": "python", "version": "3.12"},
        "pdr_research": {
            "phase": 1,
            "seed": 19,
            "claim_boundary": "pipeline validation only; no real-device accuracy claim",
        },
    }
    notebook["cells"] = [
        markdown(
            """
# Phase 1 — Android-compatible synthetic PDR foundation

## tl;dr

- Synthetic samples contain only Android-shaped raw sensor values and monotonic timing.
- Ground-truth position, body heading, and stride stay in a separate object.
- Golden cases expose 90° rotation, mirror image, false topology, and distance scale error.
- This notebook validates capture/evaluation plumbing. It is **not** evidence that pocket PDR works on a phone.
"""
        ),
        markdown(
            """
## Context & Methods

The product needs heading and distance estimates that can eventually be reproduced from ordinary Android APIs. This notebook uses a fixed seed and the `imu6` profile (accelerometer + gyroscope) at 100 Hz, then exercises the 50 Hz replay path, batching, gaps, timestamp jitter, and optional magnetic disturbance.

Truth is available only to the evaluator. No estimator feature in this example receives trajectory, true body heading, Tango/VIO, motion capture, or a corrected future pose. Origin-preserving metrics are reported so an optimal alignment cannot hide a 90-degree rotation.
"""
        ),
        code(
            """
from pathlib import Path
import sys

cwd = Path.cwd().resolve()
candidates = (cwd / "research" / "pdr", cwd, cwd.parent)
research_root = next(path for path in candidates if (path / "pdr_research").is_dir())
sys.path.insert(0, str(research_root))

from pdr_research.compatibility import validate_session
from pdr_research.metrics import evaluate_trajectory
from pdr_research.synthetic import downsample_session, generate_fixture, transform_truth

SEED = 19
"""
        ),
        markdown("## Data\n\nGenerate a closed rectangular route. The route geometry is retained separately from the normalized raw sensor session."),
        code(
            """
fixture = generate_fixture(route="rectangle", sample_rate_hz=100, seed=SEED)
validate_session(fixture.session)

raw_fields = set(fixture.session.samples[0].__dataclass_fields__)
truth_only_fields = {"x_m", "y_m", "body_heading_rad", "stride_m"}
assert raw_fields.isdisjoint(truth_only_fields)

{
    "session_id": fixture.session.session_id,
    "raw_sensor_types": sorted({sample.sensor_type for sample in fixture.session.samples}),
    "raw_sample_count": len(fixture.session.samples),
    "truth_point_count": len(fixture.ground_truth),
    "ground_truth_leakage": sorted(raw_fields & truth_only_fields),
    "dataset_hash": fixture.dataset_hash,
}
"""
        ),
        markdown("### Robustness replay\n\nExercise rate reduction and delivery effects without changing the estimator's ground truth."),
        code(
            """
at_50_hz = downsample_session(fixture.session, source_rate_hz=100, target_rate_hz=50)
validate_session(at_50_hz)

disturbed = generate_fixture(
    route="straight",
    sample_rate_hz=100,
    seed=SEED,
    batch_latency_ms=250,
    gaps=((2.0, 2.6),),
    timestamp_jitter_us=500,
    include_magnetometer=True,
    magnetic_anomaly=(4.0, 5.0),
    device_yaw_changes=((6.0, 90.0),),
)
validate_session(disturbed.session)

{
    "samples_100_hz": len(fixture.session.samples),
    "samples_50_hz": len(at_50_hz.samples),
    "batched_callbacks": sum(
        sample.callback_timestamp_ns > sample.sensor_timestamp_ns
        for sample in disturbed.session.samples
    ),
    "gap_and_magnetic_fixture_hash": disturbed.dataset_hash,
}
"""
        ),
        markdown("## Results\n\nCompare deterministic geometry faults against the same truth sequence."),
        code(
            """
scenarios = {
    "perfect": transform_truth(fixture.ground_truth),
    "scale_1.15": transform_truth(fixture.ground_truth, scale=1.15),
    "rotate_90": transform_truth(fixture.ground_truth, rotation_deg=90.0),
    "mirror_x": transform_truth(fixture.ground_truth, mirror_x=True),
}

results = {}
for name, estimate in scenarios.items():
    results[name] = evaluate_trajectory(
        session_id=fixture.session.session_id,
        truth=fixture.ground_truth,
        estimate_xy=estimate,
        estimator=f"golden-{name}",
        estimator_version="1",
        capability_profile="imu6",
        seed=SEED,
        dataset_hash=fixture.dataset_hash,
    )

header = f"{'scenario':<12} {'scale error':>12} {'heading error':>14} {'topology':>10}  flags"
print(header)
print("-" * len(header))
for name, result in results.items():
    print(
        f"{name:<12} "
        f"{result.metrics['distance_scale_error']:>12.3f} "
        f"{result.metrics['origin_heading_error_deg']:>14.1f} "
        f"{str(result.metrics['topology_correct']):>10}  "
        f"{', '.join(result.failure_flags) or '-'}"
    )

false_loop_fixture = generate_fixture(route="straight", sample_rate_hz=100, seed=SEED)
count = len(false_loop_fixture.ground_truth)
false_loop_estimate = tuple(
    (100.0 * (index / (count // 2)), 0.0)
    if index <= count // 2
    else (100.0 * ((count - 1 - index) / (count - 1 - count // 2)), 0.0)
    for index in range(count)
)
false_loop_result = evaluate_trajectory(
    session_id=false_loop_fixture.session.session_id,
    truth=false_loop_fixture.ground_truth,
    estimate_xy=false_loop_estimate,
    estimator="golden-false-loop",
    estimator_version="1",
    capability_profile="imu6",
    seed=SEED,
    dataset_hash=false_loop_fixture.dataset_hash,
)
print(f"false_loop   {'-':>12} {'-':>14} {str(false_loop_result.metrics['topology_correct']):>10}  {', '.join(false_loop_result.failure_flags)}")
"""
        ),
        code(
            """
assert results["perfect"].failure_flags == ()
assert abs(results["scale_1.15"].metrics["distance_scale_error"] - 0.15) < 1e-6
assert "catastrophic-rotation" in results["rotate_90"].failure_flags
assert "catastrophic-mirror" in results["mirror_x"].failure_flags
assert "false-loop-closure" in false_loop_result.failure_flags
print("All notebook acceptance assertions passed.")
"""
        ),
        markdown(
            """
## Takeaways

1. The normalized raw session and truth table are structurally separated, and the leakage assertion is executable.
2. The same raw-session contract survives 50/100 Hz replay, batching, timestamp jitter, gaps, and optional magnetic anomalies.
3. Origin-preserving checks expose catastrophic rotations and mirrors; a shape-aligned score alone would be unsafe.
4. The next allowed step is a sequence-level public-data audit and B0/B1 replay using only approved fields. Native walking capture remains gated.
"""
        ),
    ]
    return notebook


def main() -> None:
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    notebook = build()
    client = NotebookClient(
        notebook,
        timeout=120,
        kernel_name="python3",
        resources={"metadata": {"path": str(REPOSITORY_ROOT)}},
    )
    client.execute()
    nbformat.validate(notebook)
    nbformat.write(notebook, OUTPUT)
    print(f"Wrote and executed {OUTPUT}")


if __name__ == "__main__":
    main()
