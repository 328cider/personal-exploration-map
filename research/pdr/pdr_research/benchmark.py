"""Common baseline replay matrix and bounded synthetic-only summaries."""

from __future__ import annotations

from dataclasses import dataclass, replace
import hashlib
import math
import statistics
from typing import Mapping, Sequence

from .compatibility import validate_estimator_output, validate_session
from .contracts import EvaluationResult, NormalizedSensorSession
from .estimators import run_common_baselines
from .metrics import evaluate_estimator_output
from .synthetic import (
    SyntheticFixture,
    drop_sensor,
    drop_time_ranges,
    generate_fixture,
    rebatch_session,
)


@dataclass(frozen=True)
class ReplayScenario:
    name: str
    batch_latency_ms: int = 0
    gaps_s: tuple[tuple[float, float], ...] = ()
    dropped_sensor_types: tuple[str, ...] = ()
    device_yaw_changes: tuple[tuple[float, float], ...] = ()
    magnetic_anomaly: tuple[float, float] | None = None


@dataclass(frozen=True)
class BenchmarkRecord:
    route: str
    scenario: str
    sample_rate_hz: int
    estimator: str
    estimator_version: str
    capability_profile: str
    supported: bool
    used_sensor_types: tuple[str, ...]
    missing_requirements: tuple[str, ...]
    fallback_flags: tuple[str, ...]
    metrics: Mapping[str, float | int | bool]
    failure_flags: tuple[str, ...]
    dataset_hash: str
    evidence_kind: str = "synthetic-pipeline-only"


SCENARIOS = (
    ReplayScenario("ideal-all"),
    ReplayScenario("batch-250ms", batch_latency_ms=250),
    ReplayScenario("gap-600ms", gaps_s=((2.0, 2.6),)),
    ReplayScenario(
        "imu6-only",
        dropped_sensor_types=(
            "TYPE_STEP_DETECTOR",
            "TYPE_ROTATION_VECTOR",
            "TYPE_GAME_ROTATION_VECTOR",
            "TYPE_MAGNETIC_FIELD",
        ),
    ),
    ReplayScenario(
        "handling-magnetic",
        device_yaw_changes=((6.0, 90.0),),
        magnetic_anomaly=(4.0, 5.0),
    ),
)


def _scenario_hash(dataset_hash: str, scenario: ReplayScenario) -> str:
    payload = (
        dataset_hash,
        scenario.name,
        scenario.batch_latency_ms,
        scenario.gaps_s,
        scenario.dropped_sensor_types,
        scenario.device_yaw_changes,
        scenario.magnetic_anomaly,
    )
    return hashlib.sha256(repr(payload).encode("utf-8")).hexdigest()


def _with_provenance(
    session: NormalizedSensorSession, scenario: ReplayScenario
) -> NormalizedSensorSession:
    return replace(
        session,
        provenance={
            **session.provenance,
            "replay_scenario": scenario.name,
            "warning": "synthetic pipeline test; not real-device accuracy evidence",
        },
    )


def build_scenario_fixture(
    *, route: str, sample_rate_hz: int, seed: int, scenario: ReplayScenario
) -> SyntheticFixture:
    fixture = generate_fixture(
        route=route,
        sample_rate_hz=sample_rate_hz,
        seed=seed,
        include_magnetometer=True,
        include_rotation_vector=True,
        include_game_rotation_vector=True,
        include_step_detector=True,
        magnetic_anomaly=scenario.magnetic_anomaly,
        device_yaw_changes=scenario.device_yaw_changes,
    )
    session = fixture.session
    if scenario.batch_latency_ms:
        session = rebatch_session(session, batch_latency_ms=scenario.batch_latency_ms)
    if scenario.gaps_s:
        session = drop_time_ranges(session, scenario.gaps_s)
    for sensor_type in scenario.dropped_sensor_types:
        session = drop_sensor(session, sensor_type)
    session = _with_provenance(session, scenario)
    return replace(
        fixture,
        session=session,
        dataset_hash=_scenario_hash(fixture.dataset_hash, scenario),
    )


def _record_from_evaluation(
    *,
    fixture: SyntheticFixture,
    route: str,
    scenario: ReplayScenario,
    sample_rate_hz: int,
    evaluation: EvaluationResult,
    used_sensor_types: frozenset[str],
    missing_requirements: tuple[str, ...],
    fallback_flags: tuple[str, ...],
) -> BenchmarkRecord:
    return BenchmarkRecord(
        route=route,
        scenario=scenario.name,
        sample_rate_hz=sample_rate_hz,
        estimator=evaluation.estimator,
        estimator_version=evaluation.estimator_version,
        capability_profile=evaluation.capability_profile,
        supported=True,
        used_sensor_types=tuple(sorted(used_sensor_types)),
        missing_requirements=missing_requirements,
        fallback_flags=fallback_flags,
        metrics=evaluation.metrics,
        failure_flags=evaluation.failure_flags,
        dataset_hash=fixture.dataset_hash,
    )


def run_fixture_baselines(
    *,
    fixture: SyntheticFixture,
    route: str,
    scenario: ReplayScenario,
    sample_rate_hz: int,
    seed: int,
) -> tuple[BenchmarkRecord, ...]:
    validate_session(fixture.session)
    original_samples = fixture.session.samples
    records: list[BenchmarkRecord] = []
    for run in run_common_baselines(fixture.session):
        if not run.supported:
            records.append(
                BenchmarkRecord(
                    route=route,
                    scenario=scenario.name,
                    sample_rate_hz=sample_rate_hz,
                    estimator=run.requirement.estimator,
                    estimator_version=run.requirement.version,
                    capability_profile=run.requirement.required_capability_profile,
                    supported=False,
                    used_sensor_types=(),
                    missing_requirements=run.missing_requirements,
                    fallback_flags=run.fallback_flags,
                    metrics={},
                    failure_flags=("unsupported-capability",),
                    dataset_hash=fixture.dataset_hash,
                )
            )
            continue
        assert run.output is not None
        validate_estimator_output(run.output)
        evaluation = evaluate_estimator_output(
            session_id=fixture.session.session_id,
            truth=fixture.ground_truth,
            output=run.output,
            seed=seed,
            dataset_hash=fixture.dataset_hash,
        )
        records.append(
            _record_from_evaluation(
                fixture=fixture,
                route=route,
                scenario=scenario,
                sample_rate_hz=sample_rate_hz,
                evaluation=evaluation,
                used_sensor_types=run.used_sensor_types,
                missing_requirements=run.missing_requirements,
                fallback_flags=run.fallback_flags,
            )
        )
    if fixture.session.samples != original_samples:
        raise AssertionError("Estimator mutated immutable replay evidence")
    return tuple(records)


def run_synthetic_matrix(
    *,
    routes: Sequence[str] = ("straight", "rectangle", "out-and-back", "loop"),
    rates_hz: Sequence[int] = (50, 100),
    scenarios: Sequence[ReplayScenario] = SCENARIOS,
    seed: int = 23,
) -> tuple[BenchmarkRecord, ...]:
    records: list[BenchmarkRecord] = []
    for route in routes:
        for sample_rate_hz in rates_hz:
            for scenario in scenarios:
                fixture = build_scenario_fixture(
                    route=route,
                    sample_rate_hz=sample_rate_hz,
                    seed=seed,
                    scenario=scenario,
                )
                records.extend(
                    run_fixture_baselines(
                        fixture=fixture,
                        route=route,
                        scenario=scenario,
                        sample_rate_hz=sample_rate_hz,
                        seed=seed,
                    )
                )
    return tuple(records)


def _percentile(values: Sequence[float], probability: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    index = max(0, math.ceil(probability * len(ordered)) - 1)
    return ordered[index]


def summarize_records(records: Sequence[BenchmarkRecord]) -> tuple[dict[str, object], ...]:
    grouped: dict[tuple[str, str, str], list[BenchmarkRecord]] = {}
    for record in records:
        key = (record.estimator, record.capability_profile, record.scenario)
        grouped.setdefault(key, []).append(record)
    summaries: list[dict[str, object]] = []
    for (estimator, profile, scenario), group in sorted(grouped.items()):
        supported = [record for record in group if record.supported]
        endpoint = [float(record.metrics["endpoint_drift_ratio"]) for record in supported]
        heading = [float(record.metrics["heading_mae_deg"]) for record in supported]
        turn = [float(record.metrics["turn_angle_mae_deg"]) for record in supported]
        catastrophic = [
            record
            for record in supported
            if any(
                flag.startswith("catastrophic-")
                or flag in {"false-self-intersection", "false-loop-closure"}
                for flag in record.failure_flags
            )
        ]
        summaries.append(
            {
                "estimator": estimator,
                "capability_profile": profile,
                "scenario": scenario,
                "runs": len(group),
                "supported_runs": len(supported),
                "unsupported_runs": len(group) - len(supported),
                "endpoint_drift_median": statistics.median(endpoint) if endpoint else None,
                "endpoint_drift_p90": _percentile(endpoint, 0.90),
                "heading_mae_median_deg": statistics.median(heading) if heading else None,
                "turn_mae_median_deg": statistics.median(turn) if turn else None,
                "catastrophic_rate": len(catastrophic) / len(supported) if supported else None,
                "evidence_decision": "pipeline-only-not-go-narrow-stop",
            }
        )
    return tuple(summaries)
