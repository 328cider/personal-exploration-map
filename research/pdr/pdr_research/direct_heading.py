"""Causal benchmark-only direct circular body-heading estimator.

Inference consumes only Android-shaped sensor features. Numeric circular labels
may be passed to the fitting function, but dataset truth types and adapters are
intentionally absent from this module.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
import hashlib
import json
import math
from pathlib import Path

import numpy as np

from .body_heading import BodyHeadingPoint, BodyHeadingRun
from .learned_heading import (
    FEATURE_COUNT as MOTION_FEATURE_COUNT,
    LearnedFeatureSeries,
)


DIRECT_INPUT_COUNT = 63
RESERVOIR_SIZE = 64
RESERVOIR_SEED = 20260809
INPUT_SCALE = 0.25
BIAS_SCALE = 0.10
TURN_WEIGHT = 4.0
TURN_RATE_SCALE_RAD_S = math.radians(30.0)
MAX_DEVICE_RATE_RAD_S = math.radians(360.0)
SCALE_FLOOR = 1e-6
MINIMUM_OUTPUT_NORM = 1e-6
REQUIRED_SENSOR_TYPES = frozenset(
    {
        "TYPE_ACCELEROMETER",
        "TYPE_GYROSCOPE",
        "TYPE_GAME_ROTATION_VECTOR",
    }
)


@dataclass(frozen=True)
class DirectHeadingConfig:
    config_id: str
    window_s: float
    reservoir_leak: float
    recurrent_gain: float
    readout_ridge_alpha: float
    reservoir_size: int = RESERVOIR_SIZE
    reservoir_seed: int = RESERVOIR_SEED
    input_scale: float = INPUT_SCALE
    bias_scale: float = BIAS_SCALE
    turn_weight: float = TURN_WEIGHT
    output_rate_hz: int = 10


@dataclass(frozen=True)
class DirectInputRow:
    timestamp_ns: int
    inputs: tuple[float, ...]
    segment_start: bool
    source_start_ns: int
    source_end_ns: int


@dataclass(frozen=True)
class DirectInputSeries:
    session_id: str
    supported: bool
    rows: tuple[DirectInputRow, ...]
    input_names: tuple[str, ...]
    used_sensor_types: frozenset[str]
    missing_requirements: tuple[str, ...] = ()


@dataclass(frozen=True)
class CircularReservoirModel:
    schema_version: int
    estimator: str
    config: DirectHeadingConfig
    input_names: tuple[str, ...]
    input_mean: tuple[float, ...]
    input_scale: tuple[float, ...]
    readout_coefficients: tuple[tuple[float, float], ...]
    readout_intercept: tuple[float, float]
    trained_sequence_ids: tuple[str, ...]
    training_row_count: int
    fit_rate_hz: int
    seed: int

    def to_payload(self) -> dict[str, object]:
        return {
            "schema_version": self.schema_version,
            "estimator": self.estimator,
            "config": asdict(self.config),
            "input_names": list(self.input_names),
            "input_mean": list(self.input_mean),
            "input_scale": list(self.input_scale),
            "readout_coefficients": [list(row) for row in self.readout_coefficients],
            "readout_intercept": list(self.readout_intercept),
            "trained_sequence_ids": list(self.trained_sequence_ids),
            "training_row_count": self.training_row_count,
            "fit_rate_hz": self.fit_rate_hz,
            "seed": self.seed,
        }


def _number_code(value: float) -> str:
    if float(value).is_integer():
        return f"{round(value):05d}"
    return f"{value:.2f}".replace(".", "")


def _candidate_configs() -> tuple[DirectHeadingConfig, ...]:
    result = []
    for window_s in (0.5, 1.0):
        for leak in (0.25, 0.75):
            for gain in (0.5, 0.9):
                for alpha in (1.0, 100.0, 10000.0):
                    config_id = (
                        f"dch-w{round(window_s * 1000):04d}"
                        f"-l{round(leak * 100):02d}"
                        f"-g{round(gain * 100):02d}"
                        f"-a{_number_code(alpha)}"
                    )
                    result.append(
                        DirectHeadingConfig(
                            config_id=config_id,
                            window_s=window_s,
                            reservoir_leak=leak,
                            recurrent_gain=gain,
                            readout_ridge_alpha=alpha,
                        )
                    )
    return tuple(sorted(result, key=lambda config: config.config_id))


CANDIDATE_CONFIGS = _candidate_configs()
CONFIGS_BY_ID = {config.config_id: config for config in CANDIDATE_CONFIGS}


def get_direct_heading_config(config_id: str) -> DirectHeadingConfig:
    try:
        return CONFIGS_BY_ID[config_id]
    except KeyError as error:
        raise ValueError(f"Unknown direct-heading config: {config_id}") from error


def _input_names(motion_names: tuple[str, ...]) -> tuple[str, ...]:
    return motion_names + (
        "device_relative_yaw_sin",
        "device_relative_yaw_cos",
        "device_yaw_rate_clipped_rad_s",
    )


def build_direct_inputs(series: LearnedFeatureSeries) -> DirectInputSeries:
    names = _input_names(series.feature_names)
    if len(names) != DIRECT_INPUT_COUNT:
        raise ValueError(f"Direct heading requires {DIRECT_INPUT_COUNT} inputs")
    if not series.supported or not series.rows:
        return DirectInputSeries(
            session_id=series.session_id,
            supported=False,
            rows=(),
            input_names=names,
            used_sensor_types=frozenset(),
            missing_requirements=series.missing_requirements or ("no-feature-rows",),
        )

    relative_yaw = 0.0
    rows = []
    for row in series.rows:
        if row.segment_start:
            relative_yaw = 0.0
            yaw_rate = 0.0
        else:
            relative_yaw = _wrap_angle(
                relative_yaw + row.device_heading_delta_rad
            )
            if row.elapsed_since_previous_s <= 0.0:
                raise ValueError("Direct-heading row has non-positive elapsed time")
            yaw_rate = row.device_heading_delta_rad / row.elapsed_since_previous_s
            yaw_rate = min(
                MAX_DEVICE_RATE_RAD_S,
                max(-MAX_DEVICE_RATE_RAD_S, yaw_rate),
            )
        values = row.features + (
            math.sin(relative_yaw),
            math.cos(relative_yaw),
            yaw_rate,
        )
        if len(values) != DIRECT_INPUT_COUNT:
            raise AssertionError("Direct-heading input width changed")
        rows.append(
            DirectInputRow(
                timestamp_ns=row.timestamp_ns,
                inputs=values,
                segment_start=row.segment_start,
                source_start_ns=row.source_start_ns,
                source_end_ns=row.source_end_ns,
            )
        )
    return DirectInputSeries(
        session_id=series.session_id,
        supported=True,
        rows=tuple(rows),
        input_names=names,
        used_sensor_types=series.used_sensor_types,
    )


def _wrap_angle(angle: float) -> float:
    return (angle + math.pi) % (2.0 * math.pi) - math.pi


def _fixed_reservoir() -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    generator = np.random.Generator(np.random.PCG64(RESERVOIR_SEED))
    input_matrix = generator.uniform(
        -1.0, 1.0, size=(RESERVOIR_SIZE, DIRECT_INPUT_COUNT)
    )
    bias = generator.uniform(-1.0, 1.0, size=RESERVOIR_SIZE)
    ring_signs = np.asarray(
        [-1.0 if index % 3 == 0 else 1.0 for index in range(RESERVOIR_SIZE)]
    )
    return input_matrix, bias, ring_signs


FIXED_INPUT_MATRIX, FIXED_BIAS, FIXED_RING_SIGNS = _fixed_reservoir()


def _series_arrays(series: DirectInputSeries) -> tuple[np.ndarray, np.ndarray]:
    if not series.supported or not series.rows:
        raise ValueError(f"{series.session_id}: direct input series is unsupported")
    inputs = np.asarray([row.inputs for row in series.rows], dtype=float)
    starts = np.asarray([row.segment_start for row in series.rows], dtype=bool)
    if inputs.shape[1] != DIRECT_INPUT_COUNT:
        raise ValueError("Direct input matrix width changed")
    if not np.isfinite(inputs).all():
        raise ValueError("Direct input series contains non-finite values")
    return inputs, starts


def reservoir_states(
    standardized_inputs: np.ndarray,
    segment_starts: np.ndarray,
    *,
    config: DirectHeadingConfig,
) -> np.ndarray:
    if standardized_inputs.ndim != 2 or standardized_inputs.shape[1] != DIRECT_INPUT_COUNT:
        raise ValueError("Standardized direct inputs have the wrong shape")
    if len(standardized_inputs) != len(segment_starts):
        raise ValueError("Segment-start vector length differs from inputs")
    projected = standardized_inputs @ FIXED_INPUT_MATRIX.T
    result = np.empty((len(standardized_inputs), RESERVOIR_SIZE), dtype=float)
    state = np.zeros(RESERVOIR_SIZE, dtype=float)
    for index, current_projection in enumerate(projected):
        if segment_starts[index]:
            state.fill(0.0)
        recurrent = FIXED_RING_SIGNS * np.roll(state, 1)
        proposal = np.tanh(
            config.input_scale * current_projection
            + config.bias_scale * FIXED_BIAS
            + config.recurrent_gain * recurrent
        )
        state = (
            (1.0 - config.reservoir_leak) * state
            + config.reservoir_leak * proposal
        )
        result[index] = state
    return result


def fit_direct_circular_readout(
    *,
    series: tuple[DirectInputSeries, ...],
    circular_targets: tuple[np.ndarray, ...],
    body_rates_rad_s: tuple[np.ndarray, ...],
    config: DirectHeadingConfig,
    trained_sequence_ids: tuple[str, ...],
) -> CircularReservoirModel:
    if not series or len(series) != len(circular_targets) or len(series) != len(body_rates_rad_s):
        raise ValueError("Direct-heading training sequence counts differ")
    if len(series) != len(trained_sequence_ids):
        raise ValueError("Training IDs do not match direct-heading sequences")
    input_names = series[0].input_names
    arrays = []
    starts = []
    for item, target, body_rate in zip(series, circular_targets, body_rates_rad_s):
        inputs, segment_starts = _series_arrays(item)
        if item.input_names != input_names:
            raise ValueError("Direct-heading input schema differs across sequences")
        if target.shape != (len(inputs), 2):
            raise ValueError("Circular target must have one sin/cos pair per input")
        if body_rate.shape != (len(inputs),):
            raise ValueError("Body-rate target length differs from inputs")
        if not np.isfinite(target).all() or not np.isfinite(body_rate).all():
            raise ValueError("Direct-heading labels contain non-finite values")
        arrays.append(inputs)
        starts.append(segment_starts)

    all_inputs = np.concatenate(arrays, axis=0)
    input_mean = np.mean(all_inputs, axis=0)
    input_scale = np.maximum(np.std(all_inputs, axis=0), SCALE_FLOOR)
    designs = []
    for inputs, segment_starts in zip(arrays, starts):
        standardized = (inputs - input_mean) / input_scale
        states = reservoir_states(standardized, segment_starts, config=config)
        designs.append(np.concatenate((states, standardized), axis=1))

    design = np.concatenate(designs, axis=0)
    targets = np.concatenate(circular_targets, axis=0)
    rates = np.concatenate(body_rates_rad_s, axis=0)
    weights = 1.0 + config.turn_weight * np.minimum(
        np.abs(rates) / TURN_RATE_SCALE_RAD_S,
        1.0,
    )
    weight_sum = float(np.sum(weights))
    design_mean = np.sum(design * weights[:, None], axis=0) / weight_sum
    target_mean = np.sum(targets * weights[:, None], axis=0) / weight_sum
    centered_design = design - design_mean
    centered_targets = targets - target_mean
    system = centered_design.T @ (centered_design * weights[:, None])
    system += config.readout_ridge_alpha * np.eye(design.shape[1])
    right = centered_design.T @ (centered_targets * weights[:, None])
    coefficients = np.linalg.pinv(system, rcond=1e-12) @ right
    intercept = target_mean - design_mean @ coefficients
    return CircularReservoirModel(
        schema_version=1,
        estimator="causal direct circular echo-state body heading",
        config=config,
        input_names=input_names,
        input_mean=tuple(float(value) for value in input_mean),
        input_scale=tuple(float(value) for value in input_scale),
        readout_coefficients=tuple(
            (float(row[0]), float(row[1])) for row in coefficients
        ),
        readout_intercept=(float(intercept[0]), float(intercept[1])),
        trained_sequence_ids=tuple(sorted(trained_sequence_ids)),
        training_row_count=len(design),
        fit_rate_hz=50,
        seed=RESERVOIR_SEED,
    )


def predict_direct_heading(
    series: DirectInputSeries, *, model: CircularReservoirModel
) -> BodyHeadingRun:
    if not series.supported or not series.rows:
        return BodyHeadingRun(
            estimator=model.estimator,
            version=f"1.0.0+{model.config.config_id}",
            required_capability_profile="platform-fused",
            supported=False,
            used_sensor_types=frozenset(),
            points=(),
            missing_requirements=series.missing_requirements or ("no-direct-input-rows",),
        )
    if series.input_names != model.input_names:
        raise ValueError("Direct-heading input schema does not match model")
    inputs, segment_starts = _series_arrays(series)
    standardized = (
        inputs - np.asarray(model.input_mean)
    ) / np.asarray(model.input_scale)
    states = reservoir_states(standardized, segment_starts, config=model.config)
    design = np.concatenate((states, standardized), axis=1)
    coefficients = np.asarray(model.readout_coefficients)
    raw_outputs = design @ coefficients + np.asarray(model.readout_intercept)

    points = []
    segment_anchor: float | None = None
    previous_heading = 0.0
    for row, raw in zip(series.rows, raw_outputs):
        if row.segment_start:
            segment_anchor = None
            previous_heading = 0.0
        norm = float(np.hypot(raw[0], raw[1]))
        fresh = norm >= MINIMUM_OUTPUT_NORM
        if fresh:
            raw_angle = math.atan2(float(raw[0]), float(raw[1]))
            if segment_anchor is None:
                segment_anchor = raw_angle
            heading = _wrap_angle(raw_angle - segment_anchor)
            previous_heading = heading
        else:
            heading = previous_heading
        points.append(
            BodyHeadingPoint(
                timestamp_ns=row.timestamp_ns,
                heading_rad=heading,
                anisotropy=min(1.0, norm),
                fresh=fresh,
                source_start_ns=row.source_start_ns,
                source_end_ns=row.source_end_ns,
            )
        )
    return BodyHeadingRun(
        estimator=model.estimator,
        version=f"1.0.0+{model.config.config_id}",
        required_capability_profile="platform-fused",
        supported=bool(points),
        used_sensor_types=REQUIRED_SENSOR_TYPES if points else frozenset(),
        points=tuple(points),
        missing_requirements=() if points else ("direct-heading:no-output",),
    )


def canonical_model_bytes(model: CircularReservoirModel) -> bytes:
    return (
        json.dumps(
            model.to_payload(),
            sort_keys=True,
            ensure_ascii=False,
            allow_nan=False,
            separators=(",", ":"),
        )
        + "\n"
    ).encode("utf-8")


def model_sha256(model: CircularReservoirModel) -> str:
    return hashlib.sha256(canonical_model_bytes(model)).hexdigest()


def write_model(path: Path, model: CircularReservoirModel) -> str:
    content = canonical_model_bytes(model)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)
    return hashlib.sha256(content).hexdigest()


def read_model(path: Path) -> CircularReservoirModel:
    payload = json.loads(path.read_text(encoding="utf-8"))
    config_payload = payload["config"]
    config = get_direct_heading_config(config_payload["config_id"])
    if asdict(config) != config_payload:
        raise ValueError("Serialized direct-heading config changed")
    model = CircularReservoirModel(
        schema_version=int(payload["schema_version"]),
        estimator=str(payload["estimator"]),
        config=config,
        input_names=tuple(payload["input_names"]),
        input_mean=tuple(float(value) for value in payload["input_mean"]),
        input_scale=tuple(float(value) for value in payload["input_scale"]),
        readout_coefficients=tuple(
            (float(row[0]), float(row[1]))
            for row in payload["readout_coefficients"]
        ),
        readout_intercept=tuple(float(value) for value in payload["readout_intercept"]),
        trained_sequence_ids=tuple(payload["trained_sequence_ids"]),
        training_row_count=int(payload["training_row_count"]),
        fit_rate_hz=int(payload["fit_rate_hz"]),
        seed=int(payload["seed"]),
    )
    if model.schema_version != 1:
        raise ValueError("Unsupported direct-heading model schema")
    if len(model.input_names) != DIRECT_INPUT_COUNT:
        raise ValueError("Serialized direct-heading input schema changed")
    if len(model.readout_coefficients) != RESERVOIR_SIZE + DIRECT_INPUT_COUNT:
        raise ValueError("Serialized direct-heading readout width changed")
    return model
