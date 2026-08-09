"""Origin-preserving geometry checks that do not hide catastrophic failures."""

from __future__ import annotations

from bisect import bisect_right
from dataclasses import replace
import math
from typing import Sequence

from .contracts import EstimatorOutput, EvaluationResult
from .synthetic import TruthPoint


Point = tuple[float, float]


def _distance(a: Point, b: Point) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1])


def _length(points: Sequence[Point]) -> float:
    return sum(_distance(a, b) for a, b in zip(points, points[1:]))


def _first_heading(points: Sequence[Point]) -> float:
    origin = points[0]
    for point in points[1:]:
        if _distance(origin, point) > 0.5:
            return math.atan2(point[1] - origin[1], point[0] - origin[0])
    return 0.0


def _wrap_degrees(value: float) -> float:
    return (value + 180.0) % 360.0 - 180.0


def _wrap_radians(value: float) -> float:
    return (value + math.pi) % (2.0 * math.pi) - math.pi


def _signed_area(points: Sequence[Point]) -> float:
    if len(points) < 3:
        return 0.0
    return 0.5 * sum(
        a[0] * b[1] - b[0] * a[1]
        for a, b in zip(points, (*points[1:], points[0]))
    )


def _orientation(a: Point, b: Point, c: Point) -> float:
    return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])


def _proper_intersection(a: Point, b: Point, c: Point, d: Point) -> bool:
    return (
        _orientation(a, b, c) * _orientation(a, b, d) < 0
        and _orientation(c, d, a) * _orientation(c, d, b) < 0
    )


def _simplify_collinear(points: Sequence[Point], tolerance: float = 1e-8) -> tuple[Point, ...]:
    """Remove dense straight-line samples before the quadratic topology check."""
    if len(points) < 3:
        return tuple(points)
    simplified = [points[0]]
    for index, point in enumerate(points[1:-1], start=1):
        if abs(_orientation(simplified[-1], point, points[index + 1])) > tolerance:
            simplified.append(point)
    simplified.append(points[-1])
    return tuple(simplified)


def self_intersection_count(
    points: Sequence[Point], *, endpoints_are_adjacent: bool | None = None
) -> int:
    points = _simplify_collinear(points)
    count = 0
    closed = (
        len(points) > 2 and _distance(points[0], points[-1]) < 1e-6
        if endpoints_are_adjacent is None
        else endpoints_are_adjacent
    )
    segment_count = len(points) - 1
    for left in range(segment_count):
        for right in range(left + 2, segment_count):
            if closed and left == 0 and right == segment_count - 1:
                continue
            if _proper_intersection(
                points[left], points[left + 1], points[right], points[right + 1]
            ):
                count += 1
    return count


def evaluate_trajectory(
    *,
    session_id: str,
    truth: Sequence[TruthPoint],
    estimate_xy: Sequence[Point],
    estimator: str,
    estimator_version: str,
    capability_profile: str,
    seed: int,
    dataset_hash: str,
) -> EvaluationResult:
    if len(truth) != len(estimate_xy) or len(truth) < 2:
        raise ValueError("Truth and estimate must have the same non-trivial length")
    truth_xy = tuple((point.x_m, point.y_m) for point in truth)
    truth_length = _length(truth_xy)
    estimate_length = _length(estimate_xy)
    endpoint_error = _distance(
        (estimate_xy[-1][0] - estimate_xy[0][0], estimate_xy[-1][1] - estimate_xy[0][1]),
        (truth_xy[-1][0] - truth_xy[0][0], truth_xy[-1][1] - truth_xy[0][1]),
    )
    endpoint_drift_ratio = endpoint_error / truth_length if truth_length else 0.0
    distance_scale_error = abs(estimate_length / truth_length - 1.0) if truth_length else 0.0
    heading_error_deg = abs(
        _wrap_degrees(
            math.degrees(_first_heading(estimate_xy) - _first_heading(truth_xy))
        )
    )
    truth_area = _signed_area(truth_xy)
    estimate_area = _signed_area(estimate_xy)
    mirrored = abs(truth_area) > 1.0 and truth_area * estimate_area < 0.0
    truth_is_closed = _distance(truth_xy[0], truth_xy[-1]) < 1e-6
    truth_intersections = self_intersection_count(
        truth_xy, endpoints_are_adjacent=truth_is_closed
    )
    estimate_intersections = self_intersection_count(
        estimate_xy, endpoints_are_adjacent=truth_is_closed
    )
    false_intersections = max(0, estimate_intersections - truth_intersections)
    truth_closure_ratio = (
        _distance(truth_xy[0], truth_xy[-1]) / truth_length if truth_length else 0.0
    )
    estimate_closure_ratio = (
        _distance(estimate_xy[0], estimate_xy[-1]) / estimate_length
        if estimate_length
        else 0.0
    )
    false_loop_closure = truth_closure_ratio > 0.5 and estimate_closure_ratio < 0.05

    flags: list[str] = []
    if heading_error_deg >= 45.0:
        flags.append("catastrophic-rotation")
    if mirrored:
        flags.append("catastrophic-mirror")
    if false_intersections:
        flags.append("false-self-intersection")
    if false_loop_closure:
        flags.append("false-loop-closure")
    if distance_scale_error > 0.30:
        flags.append("catastrophic-distance-scale")
    if endpoint_drift_ratio > 0.30:
        flags.append("catastrophic-endpoint-drift")

    return EvaluationResult(
        session_id=session_id,
        estimator=estimator,
        estimator_version=estimator_version,
        capability_profile=capability_profile,
        metrics={
            "truth_distance_m": truth_length,
            "estimated_distance_m": estimate_length,
            "endpoint_error_m": endpoint_error,
            "endpoint_drift_ratio": endpoint_drift_ratio,
            "distance_scale_error": distance_scale_error,
            "origin_heading_error_deg": heading_error_deg,
            "mirrored": mirrored,
            "false_self_intersections": false_intersections,
            "false_loop_closure": false_loop_closure,
            "topology_correct": (
                not mirrored and false_intersections == 0 and not false_loop_closure
            ),
        },
        failure_flags=tuple(flags),
        seed=seed,
        dataset_hash=dataset_hash,
    )


def _interpolate_truth(truth: Sequence[TruthPoint], timestamp_ns: int) -> TruthPoint:
    timestamps = [point.timestamp_ns for point in truth]
    right = bisect_right(timestamps, timestamp_ns)
    if right <= 0:
        return truth[0]
    if right >= len(truth):
        return truth[-1]
    left_point = truth[right - 1]
    right_point = truth[right]
    interval = right_point.timestamp_ns - left_point.timestamp_ns
    fraction = (timestamp_ns - left_point.timestamp_ns) / interval if interval else 0.0
    heading_delta = _wrap_radians(
        right_point.body_heading_rad - left_point.body_heading_rad
    )
    return TruthPoint(
        timestamp_ns=timestamp_ns,
        x_m=left_point.x_m + (right_point.x_m - left_point.x_m) * fraction,
        y_m=left_point.y_m + (right_point.y_m - left_point.y_m) * fraction,
        body_heading_rad=_wrap_radians(left_point.body_heading_rad + heading_delta * fraction),
        stride_m=left_point.stride_m + (right_point.stride_m - left_point.stride_m) * fraction,
    )


def _turn_errors_deg(
    truth: Sequence[TruthPoint], output: EstimatorOutput
) -> tuple[float, ...]:
    truth_turns: list[tuple[int, int, float]] = []
    anchor_timestamp = truth[0].timestamp_ns
    anchor_heading = truth[0].body_heading_rad
    for point in truth[1:]:
        delta = _wrap_radians(point.body_heading_rad - anchor_heading)
        if abs(math.degrees(delta)) >= 30.0:
            truth_turns.append((anchor_timestamp, point.timestamp_ns, delta))
            anchor_timestamp = point.timestamp_ns
            anchor_heading = point.body_heading_rad
    output_timestamps = [point.timestamp_ns for point in output.points]
    errors: list[float] = []
    for start_timestamp_ns, end_timestamp_ns, truth_delta in truth_turns:
        left = bisect_right(output_timestamps, start_timestamp_ns) - 1
        right = bisect_right(output_timestamps, end_timestamp_ns - 1)
        if left < 0 or right >= len(output.points) or right <= left:
            continue
        before = output.points[left].heading_rad
        after = output.points[right].heading_rad
        estimated_delta = _wrap_radians(after - before)
        errors.append(abs(math.degrees(_wrap_radians(estimated_delta - truth_delta))))
    return tuple(errors)


def evaluate_estimator_output(
    *,
    session_id: str,
    truth: Sequence[TruthPoint],
    output: EstimatorOutput,
    seed: int,
    dataset_hash: str,
) -> EvaluationResult:
    if len(output.points) < 2:
        raise ValueError("Estimator output requires at least two points")
    matched_truth = tuple(
        _interpolate_truth(truth, point.timestamp_ns) for point in output.points
    )
    result = evaluate_trajectory(
        session_id=session_id,
        truth=matched_truth,
        estimate_xy=tuple((point.x_m, point.y_m) for point in output.points),
        estimator=output.estimator,
        estimator_version=output.version,
        capability_profile=output.required_capability_profile,
        seed=seed,
        dataset_hash=dataset_hash,
    )
    heading_errors = tuple(
        abs(
            math.degrees(
                _wrap_radians(point.heading_rad - truth_point.body_heading_rad)
            )
        )
        for point, truth_point in zip(output.points, matched_truth)
    )
    turn_errors = _turn_errors_deg(truth, output)
    heading_mae = sum(heading_errors) / len(heading_errors)
    turn_mae = sum(turn_errors) / len(turn_errors) if turn_errors else 0.0
    future_violations = sum(
        point.source_end_ns > point.timestamp_ns for point in output.points
    )
    metrics = dict(result.metrics)
    metrics.update(
        {
            "heading_mae_deg": heading_mae,
            "turn_angle_mae_deg": turn_mae,
            "evaluated_turn_count": len(turn_errors),
            "output_point_count": len(output.points),
            "maximum_uncertainty_m": max(point.uncertainty_m for point in output.points),
            "future_sample_violations": future_violations,
        }
    )
    flags = list(result.failure_flags)
    if heading_mae >= 45.0 and "catastrophic-heading" not in flags:
        flags.append("catastrophic-heading")
    if turn_errors and turn_mae >= 45.0 and "catastrophic-turn" not in flags:
        flags.append("catastrophic-turn")
    if future_violations:
        flags.append("future-sample-leakage")
    return replace(result, metrics=metrics, failure_flags=tuple(flags))
