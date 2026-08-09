"""Truth-isolated evaluation and rate comparison for body-heading outputs."""

from __future__ import annotations

from bisect import bisect_right
from dataclasses import dataclass
import math
import statistics
from typing import Sequence

from .body_heading import BodyHeadingRun
from .synthetic import TruthPoint


@dataclass(frozen=True)
class BodyHeadingEvaluation:
    session_id: str
    estimator: str
    version: str
    metrics: dict[str, float | int]
    failure_flags: tuple[str, ...]


@dataclass(frozen=True)
class HeadingRateComparison:
    matched_output_count: int
    median_disagreement_deg: float
    p95_disagreement_deg: float


def _wrap_angle(angle: float) -> float:
    return (angle + math.pi) % (2.0 * math.pi) - math.pi


def _nearest_rank(values: Sequence[float], fraction: float) -> float:
    if not values:
        raise ValueError("Quantile requires at least one value")
    ordered = sorted(values)
    index = max(0, min(len(ordered) - 1, math.ceil(fraction * len(ordered)) - 1))
    return ordered[index]


def _interpolate_truth(
    truth: Sequence[TruthPoint],
    timestamp_ns: int,
    *,
    timestamps: Sequence[int] | None = None,
) -> TruthPoint:
    if not truth:
        raise ValueError("Heading evaluation requires truth")
    timestamps = (
        timestamps
        if timestamps is not None
        else tuple(point.timestamp_ns for point in truth)
    )
    right = bisect_right(timestamps, timestamp_ns)
    if right <= 0:
        return truth[0]
    if right >= len(truth):
        return truth[-1]
    left_point = truth[right - 1]
    right_point = truth[right]
    interval = right_point.timestamp_ns - left_point.timestamp_ns
    fraction = (timestamp_ns - left_point.timestamp_ns) / interval if interval else 0.0
    heading_delta = _wrap_angle(
        right_point.body_heading_rad - left_point.body_heading_rad
    )
    return TruthPoint(
        timestamp_ns=timestamp_ns,
        x_m=left_point.x_m + (right_point.x_m - left_point.x_m) * fraction,
        y_m=left_point.y_m + (right_point.y_m - left_point.y_m) * fraction,
        body_heading_rad=_wrap_angle(
            left_point.body_heading_rad + heading_delta * fraction
        ),
        stride_m=left_point.stride_m + (right_point.stride_m - left_point.stride_m) * fraction,
    )


def _truth_speed_mps(
    truth: Sequence[TruthPoint],
    timestamp_ns: int,
    *,
    timestamps: Sequence[int],
) -> float:
    left_ns = max(truth[0].timestamp_ns, timestamp_ns - 500_000_000)
    right_ns = min(truth[-1].timestamp_ns, timestamp_ns + 500_000_000)
    if right_ns <= left_ns:
        return 0.0
    left = _interpolate_truth(truth, left_ns, timestamps=timestamps)
    right = _interpolate_truth(truth, right_ns, timestamps=timestamps)
    return math.hypot(right.x_m - left.x_m, right.y_m - left.y_m) / (
        (right_ns - left_ns) / 1_000_000_000
    )


def _turn_errors_deg(
    truth_headings: Sequence[float], estimate_headings: Sequence[float]
) -> tuple[float, ...]:
    if len(truth_headings) != len(estimate_headings):
        raise ValueError("Turn evaluation requires matched headings")
    if not truth_headings:
        return ()
    anchor_truth = truth_headings[0]
    anchor_estimate = estimate_headings[0]
    result = []
    for truth_heading, estimate_heading in zip(
        truth_headings[1:], estimate_headings[1:]
    ):
        truth_delta = _wrap_angle(truth_heading - anchor_truth)
        if abs(math.degrees(truth_delta)) < 30.0:
            continue
        estimate_delta = _wrap_angle(estimate_heading - anchor_estimate)
        result.append(
            abs(math.degrees(_wrap_angle(estimate_delta - truth_delta)))
        )
        anchor_truth = truth_heading
        anchor_estimate = estimate_heading
    return tuple(result)


def evaluate_body_heading(
    *,
    session_id: str,
    truth: Sequence[TruthPoint],
    run: BodyHeadingRun,
    session_start_ns: int,
    moving_threshold_mps: float = 0.1,
) -> BodyHeadingEvaluation:
    if not run.supported or not run.points:
        raise ValueError("Cannot evaluate an unsupported body-heading run")
    truth_timestamps = tuple(point.timestamp_ns for point in truth)
    matched_truth = tuple(
        _interpolate_truth(
            truth, point.timestamp_ns, timestamps=truth_timestamps
        )
        for point in run.points
    )
    truth_reference = matched_truth[0].body_heading_rad
    truth_relative = tuple(
        _wrap_angle(point.body_heading_rad - truth_reference)
        for point in matched_truth
    )
    estimate_headings = tuple(point.heading_rad for point in run.points)
    errors_deg = tuple(
        abs(math.degrees(_wrap_angle(estimate - expected)))
        for estimate, expected in zip(estimate_headings, truth_relative)
    )
    moving_errors = tuple(
        error
        for point, error in zip(run.points, errors_deg)
        if _truth_speed_mps(
            truth, point.timestamp_ns, timestamps=truth_timestamps
        )
        >= moving_threshold_mps
    )
    turn_errors = _turn_errors_deg(truth_relative, estimate_headings)
    expected_period_ns = (
        statistics.median(
            right.timestamp_ns - left.timestamp_ns
            for left, right in zip(run.points, run.points[1:])
        )
        if len(run.points) >= 2
        else 100_000_000
    )
    expected_outputs = max(
        1,
        round(
            (run.points[-1].timestamp_ns - run.points[0].timestamp_ns)
            / expected_period_ns
        )
        + 1,
    )
    future_violations = sum(
        point.source_end_ns > point.timestamp_ns for point in run.points
    )
    all_mae = statistics.fmean(errors_deg)
    turn_mae = statistics.fmean(turn_errors) if turn_errors else 0.0
    metrics: dict[str, float | int] = {
        "heading_mae_deg": all_mae,
        "heading_p90_deg": _nearest_rank(errors_deg, 0.90),
        "moving_heading_mae_deg": (
            statistics.fmean(moving_errors) if moving_errors else all_mae
        ),
        "turn_angle_mae_deg": turn_mae,
        "evaluated_turn_count": len(turn_errors),
        "output_count": len(run.points),
        "fresh_output_fraction": sum(point.fresh for point in run.points)
        / len(run.points),
        "output_grid_coverage": len(run.points) / expected_outputs,
        "initialization_latency_s": (
            run.points[0].timestamp_ns - session_start_ns
        )
        / 1_000_000_000,
        "future_sample_violations": future_violations,
    }
    flags = []
    if all_mae >= 45.0:
        flags.append("catastrophic-heading")
    if turn_errors and turn_mae >= 45.0:
        flags.append("catastrophic-turn")
    if future_violations:
        flags.append("future-sample-leakage")
    return BodyHeadingEvaluation(
        session_id=session_id,
        estimator=run.estimator,
        version=run.version,
        metrics=metrics,
        failure_flags=tuple(flags),
    )


def compare_heading_rates(
    at_50_hz: BodyHeadingRun, at_100_hz: BodyHeadingRun
) -> HeadingRateComparison:
    if not at_50_hz.supported or not at_100_hz.supported:
        raise ValueError("Rate comparison requires supported runs")
    left = {point.timestamp_ns: point.heading_rad for point in at_50_hz.points}
    right = {point.timestamp_ns: point.heading_rad for point in at_100_hz.points}
    common = sorted(set(left) & set(right))
    if not common:
        raise ValueError("Rate comparison has no matched output timestamps")
    first = common[0]
    constant_offset = _wrap_angle(right[first] - left[first])
    disagreements = tuple(
        abs(
            math.degrees(
                _wrap_angle(left[timestamp] - (right[timestamp] - constant_offset))
            )
        )
        for timestamp in common
    )
    return HeadingRateComparison(
        matched_output_count=len(common),
        median_disagreement_deg=statistics.median(disagreements),
        p95_disagreement_deg=_nearest_rank(disagreements, 0.95),
    )
