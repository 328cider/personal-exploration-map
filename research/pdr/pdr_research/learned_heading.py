"""Causal benchmark-only residual-ridge body-heading estimator.

Feature extraction and inference consume only Android-shaped sensor samples.
Supervised labels are attached by the analysis script, outside this module's
inference entrypoints.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
import hashlib
import json
import math
from pathlib import Path

import numpy as np

from .body_heading import BodyHeadingPoint, BodyHeadingRun
from .contracts import NormalizedSensorSession


ACCELEROMETER = "TYPE_ACCELEROMETER"
GYROSCOPE = "TYPE_GYROSCOPE"
GAME_ROTATION_VECTOR = "TYPE_GAME_ROTATION_VECTOR"
REQUIRED_SENSOR_TYPES = frozenset(
    {ACCELEROMETER, GYROSCOPE, GAME_ROTATION_VECTOR}
)
OUTPUT_RATE_HZ = 10
OUTPUT_PERIOD_NS = 100_000_000
FEATURE_BIN_COUNT = 5
FEATURE_COUNT = 60
MINIMUM_BIN_COVERAGE = 0.50
MAXIMUM_ORIENTATION_AGE_NS = 100_000_000
SCALE_FLOOR = 1e-6
TURN_RATE_SCALE_RAD_S = math.radians(30.0)


@dataclass(frozen=True)
class LearnedHeadingConfig:
    config_id: str
    window_s: float
    ridge_alpha: float
    turn_weight: float
    residual_clip_deg_s: float
    output_rate_hz: int = OUTPUT_RATE_HZ
    feature_bin_count: int = FEATURE_BIN_COUNT


@dataclass(frozen=True)
class LearnedFeatureRow:
    timestamp_ns: int
    features: tuple[float, ...]
    device_heading_delta_rad: float
    elapsed_since_previous_s: float
    segment_start: bool
    source_start_ns: int
    source_end_ns: int


@dataclass(frozen=True)
class LearnedFeatureSeries:
    session_id: str
    supported: bool
    rows: tuple[LearnedFeatureRow, ...]
    feature_names: tuple[str, ...]
    used_sensor_types: frozenset[str]
    missing_requirements: tuple[str, ...] = ()


@dataclass(frozen=True)
class ResidualRidgeModel:
    schema_version: int
    estimator: str
    config: LearnedHeadingConfig
    feature_names: tuple[str, ...]
    feature_mean: tuple[float, ...]
    feature_scale: tuple[float, ...]
    coefficients: tuple[float, ...]
    intercept_rad_s: float
    trained_sequence_ids: tuple[str, ...]
    training_row_count: int
    fit_rate_hz: int
    seed: int | None

    def to_payload(self) -> dict[str, object]:
        return {
            "schema_version": self.schema_version,
            "estimator": self.estimator,
            "config": asdict(self.config),
            "feature_names": list(self.feature_names),
            "feature_mean": list(self.feature_mean),
            "feature_scale": list(self.feature_scale),
            "coefficients": list(self.coefficients),
            "intercept_rad_s": self.intercept_rad_s,
            "trained_sequence_ids": list(self.trained_sequence_ids),
            "training_row_count": self.training_row_count,
            "fit_rate_hz": self.fit_rate_hz,
            "seed": self.seed,
        }


def _number_code(value: float) -> str:
    return f"{value:g}".replace(".", "p").replace("-", "m")


def _candidate_configs() -> tuple[LearnedHeadingConfig, ...]:
    result = []
    for window_s in (0.5, 1.0, 2.0):
        for ridge_alpha in (0.1, 10.0, 1000.0):
            for turn_weight in (0.0, 8.0):
                for residual_clip_deg_s in (90.0, 180.0):
                    config_id = (
                        f"lhr-w{round(window_s * 1000):04d}"
                        f"-a{_number_code(ridge_alpha)}"
                        f"-t{_number_code(turn_weight)}"
                        f"-c{round(residual_clip_deg_s):03d}"
                    )
                    result.append(
                        LearnedHeadingConfig(
                            config_id=config_id,
                            window_s=window_s,
                            ridge_alpha=ridge_alpha,
                            turn_weight=turn_weight,
                            residual_clip_deg_s=residual_clip_deg_s,
                        )
                    )
    return tuple(sorted(result, key=lambda config: config.config_id))


CANDIDATE_CONFIGS = _candidate_configs()
CONFIGS_BY_ID = {config.config_id: config for config in CANDIDATE_CONFIGS}


def get_learned_heading_config(config_id: str) -> LearnedHeadingConfig:
    try:
        return CONFIGS_BY_ID[config_id]
    except KeyError as error:
        raise ValueError(f"Unknown learned-heading config: {config_id}") from error


def _wrap_angle(angle: float) -> float:
    return (angle + math.pi) % (2.0 * math.pi) - math.pi


def _normalized_xyzw(values: tuple[float, ...]) -> tuple[float, float, float, float]:
    if len(values) < 3:
        raise ValueError("Game Rotation Vector requires at least x/y/z")
    x, y, z = values[:3]
    w = values[3] if len(values) >= 4 else math.sqrt(max(0.0, 1.0 - x*x - y*y - z*z))
    norm = math.sqrt(w*w + x*x + y*y + z*z)
    if norm <= 1e-12:
        raise ValueError("Game Rotation Vector quaternion has zero norm")
    return x / norm, y / norm, z / norm, w / norm


def _device_heading(values: tuple[float, ...]) -> float:
    x, y, z, w = _normalized_xyzw(values)
    rotation_01 = 2.0 * (x*y - w*z)
    rotation_11 = 1.0 - 2.0 * (x*x + z*z)
    return _wrap_angle(math.pi / 2.0 - math.atan2(rotation_01, rotation_11))


def _feature_names() -> tuple[str, ...]:
    names = []
    for bin_index in range(FEATURE_BIN_COUNT):
        for sensor in ("accel", "gyro"):
            for statistic in ("mean", "std"):
                for axis in ("x", "y", "z"):
                    names.append(f"bin{bin_index}_{sensor}_{statistic}_{axis}")
    return tuple(names)


FEATURE_NAMES = _feature_names()
assert len(FEATURE_NAMES) == FEATURE_COUNT


def _stream_array(
    session: NormalizedSensorSession, sensor_type: str
) -> tuple[np.ndarray, np.ndarray]:
    ordered = sorted(
        (
            sample
            for sample in session.samples
            if sample.sensor_type == sensor_type
        ),
        key=lambda sample: (sample.sensor_timestamp_ns, sample.sequence_id),
    )
    if not ordered:
        return np.empty(0, dtype=np.int64), np.empty((0, 0), dtype=float)
    timestamps = np.fromiter(
        (sample.sensor_timestamp_ns for sample in ordered), dtype=np.int64
    )
    values = np.asarray([sample.values for sample in ordered], dtype=float)
    return timestamps, values


def _median_period_ns(timestamps: np.ndarray) -> int:
    if len(timestamps) < 2:
        return OUTPUT_PERIOD_NS
    differences = np.diff(timestamps)
    positive = differences[differences > 0]
    if not len(positive):
        return OUTPUT_PERIOD_NS
    return max(1, round(float(np.median(positive))))


def extract_learned_features(
    session: NormalizedSensorSession, *, config: LearnedHeadingConfig
) -> LearnedFeatureSeries:
    available = {sample.sensor_type for sample in session.samples}
    missing = tuple(sorted(REQUIRED_SENSOR_TYPES - available))
    if missing:
        return LearnedFeatureSeries(
            session_id=session.session_id,
            supported=False,
            rows=(),
            feature_names=FEATURE_NAMES,
            used_sensor_types=frozenset(),
            missing_requirements=missing,
        )
    if config.output_rate_hz != OUTPUT_RATE_HZ:
        raise ValueError("Learned heading output rate is locked at 10 Hz")
    if config.feature_bin_count != FEATURE_BIN_COUNT:
        raise ValueError("Learned heading feature-bin count is locked at five")

    accel_t, accel_v = _stream_array(session, ACCELEROMETER)
    gyro_t, gyro_v = _stream_array(session, GYROSCOPE)
    orientation_t, orientation_v = _stream_array(session, GAME_ROTATION_VECTOR)
    if accel_v.shape[1] < 3 or gyro_v.shape[1] < 3 or orientation_v.shape[1] < 3:
        raise ValueError("Required sensor stream has fewer than three values")

    window_ns = round(config.window_s * 1_000_000_000)
    bin_ns = window_ns // FEATURE_BIN_COUNT
    if bin_ns <= 0 or window_ns % FEATURE_BIN_COUNT:
        raise ValueError("Window must divide into five integer-nanosecond bins")
    first_possible = max(accel_t[0], gyro_t[0], orientation_t[0]) + window_ns
    last_possible = min(accel_t[-1], gyro_t[-1], orientation_t[-1])
    first_tick = (
        (int(first_possible) + OUTPUT_PERIOD_NS - 1) // OUTPUT_PERIOD_NS
    ) * OUTPUT_PERIOD_NS
    last_tick = int(last_possible) // OUTPUT_PERIOD_NS * OUTPUT_PERIOD_NS
    accel_period = _median_period_ns(accel_t)
    gyro_period = _median_period_ns(gyro_t)

    rows: list[LearnedFeatureRow] = []
    previous_tick: int | None = None
    previous_heading: float | None = None
    for tick_ns in range(first_tick, last_tick + 1, OUTPUT_PERIOD_NS):
        window_start = tick_ns - window_ns
        vector: list[float] = []
        source_end_candidates: list[int] = []
        valid = True
        for bin_index in range(FEATURE_BIN_COUNT):
            bin_start = window_start + bin_index * bin_ns
            bin_end = bin_start + bin_ns
            for timestamps, values, period in (
                (accel_t, accel_v, accel_period),
                (gyro_t, gyro_v, gyro_period),
            ):
                left = int(np.searchsorted(timestamps, bin_start, side="left"))
                # Adjacent bins are half-open; only the final bin includes the
                # output-tick sample. This prevents a boundary sample from
                # being counted twice while remaining fully causal.
                right_side = (
                    "right" if bin_index == FEATURE_BIN_COUNT - 1 else "left"
                )
                right = int(np.searchsorted(timestamps, bin_end, side=right_side))
                expected = max(1, round(bin_ns / period))
                minimum = max(2, math.floor(expected * MINIMUM_BIN_COVERAGE))
                if right - left < minimum:
                    valid = False
                    break
                chunk = values[left:right, :3]
                vector.extend(float(value) for value in np.mean(chunk, axis=0))
                vector.extend(float(value) for value in np.std(chunk, axis=0))
                source_end_candidates.append(int(timestamps[right - 1]))
            if not valid:
                break
        if not valid:
            continue

        orientation_index = int(
            np.searchsorted(orientation_t, tick_ns, side="right") - 1
        )
        if orientation_index < 0:
            continue
        orientation_timestamp = int(orientation_t[orientation_index])
        if tick_ns - orientation_timestamp > MAXIMUM_ORIENTATION_AGE_NS:
            continue
        heading = _device_heading(tuple(float(v) for v in orientation_v[orientation_index]))
        segment_start = (
            previous_tick is None
            or tick_ns - previous_tick > OUTPUT_PERIOD_NS + 1
        )
        if segment_start or previous_heading is None or previous_tick is None:
            device_delta = 0.0
            elapsed_s = 0.0
        else:
            device_delta = _wrap_angle(heading - previous_heading)
            elapsed_s = (tick_ns - previous_tick) / 1_000_000_000
        if len(vector) != FEATURE_COUNT:
            raise AssertionError(f"Expected {FEATURE_COUNT} features, got {len(vector)}")
        source_end = max(source_end_candidates + [orientation_timestamp])
        if source_end > tick_ns:
            raise AssertionError("Feature extraction used a future sample")
        rows.append(
            LearnedFeatureRow(
                timestamp_ns=tick_ns,
                features=tuple(vector),
                device_heading_delta_rad=device_delta,
                elapsed_since_previous_s=elapsed_s,
                segment_start=segment_start,
                source_start_ns=window_start,
                source_end_ns=source_end,
            )
        )
        previous_tick = tick_ns
        previous_heading = heading

    return LearnedFeatureSeries(
        session_id=session.session_id,
        supported=bool(rows),
        rows=tuple(rows),
        feature_names=FEATURE_NAMES,
        used_sensor_types=REQUIRED_SENSOR_TYPES if rows else frozenset(),
        missing_requirements=() if rows else ("learned-heading:no-covered-window",),
    )


def fit_residual_ridge(
    *,
    features: np.ndarray,
    residual_targets_rad_s: np.ndarray,
    body_rates_rad_s: np.ndarray,
    config: LearnedHeadingConfig,
    trained_sequence_ids: tuple[str, ...],
) -> ResidualRidgeModel:
    if features.ndim != 2 or features.shape[1] != FEATURE_COUNT:
        raise ValueError(f"Training features must have {FEATURE_COUNT} columns")
    if len(features) != len(residual_targets_rad_s) or len(features) != len(body_rates_rad_s):
        raise ValueError("Training feature and target row counts differ")
    if not len(features):
        raise ValueError("Cannot fit learned heading without training rows")
    if not np.isfinite(features).all() or not np.isfinite(residual_targets_rad_s).all():
        raise ValueError("Training data contain non-finite values")

    sample_weights = 1.0 + config.turn_weight * np.minimum(
        np.abs(body_rates_rad_s) / TURN_RATE_SCALE_RAD_S,
        1.0,
    )
    weight_sum = float(np.sum(sample_weights))
    feature_mean = np.sum(features * sample_weights[:, None], axis=0) / weight_sum
    centered = features - feature_mean
    variance = np.sum(centered * centered * sample_weights[:, None], axis=0) / weight_sum
    feature_scale = np.maximum(np.sqrt(np.maximum(variance, 0.0)), SCALE_FLOOR)
    standardized = centered / feature_scale
    target_mean = float(np.sum(residual_targets_rad_s * sample_weights) / weight_sum)
    centered_target = residual_targets_rad_s - target_mean
    weighted_design = standardized * sample_weights[:, None]
    system = standardized.T @ weighted_design
    system += config.ridge_alpha * np.eye(FEATURE_COUNT)
    right = standardized.T @ (sample_weights * centered_target)
    coefficients = np.linalg.pinv(system, rcond=1e-12) @ right
    return ResidualRidgeModel(
        schema_version=1,
        estimator="causal time-binned residual ridge body heading",
        config=config,
        feature_names=FEATURE_NAMES,
        feature_mean=tuple(float(value) for value in feature_mean),
        feature_scale=tuple(float(value) for value in feature_scale),
        coefficients=tuple(float(value) for value in coefficients),
        intercept_rad_s=target_mean,
        trained_sequence_ids=tuple(sorted(trained_sequence_ids)),
        training_row_count=len(features),
        fit_rate_hz=50,
        seed=None,
    )


def predict_learned_heading(
    series: LearnedFeatureSeries, *, model: ResidualRidgeModel
) -> BodyHeadingRun:
    if not series.supported or not series.rows:
        return BodyHeadingRun(
            estimator=model.estimator,
            version=f"1.0.0+{model.config.config_id}",
            required_capability_profile="platform-fused",
            supported=False,
            used_sensor_types=frozenset(),
            points=(),
            missing_requirements=series.missing_requirements or ("no-feature-rows",),
        )
    if series.feature_names != model.feature_names:
        raise ValueError("Feature schema does not match fitted model")
    mean = np.asarray(model.feature_mean)
    scale = np.asarray(model.feature_scale)
    coefficients = np.asarray(model.coefficients)
    clip_rad_s = math.radians(model.config.residual_clip_deg_s)
    heading = 0.0
    points = []
    for row in series.rows:
        feature = np.asarray(row.features)
        residual_rate = model.intercept_rad_s + float(
            ((feature - mean) / scale) @ coefficients
        )
        residual_rate = min(clip_rad_s, max(-clip_rad_s, residual_rate))
        if not row.segment_start:
            heading = _wrap_angle(
                heading
                + row.device_heading_delta_rad
                + residual_rate * row.elapsed_since_previous_s
            )
        points.append(
            BodyHeadingPoint(
                timestamp_ns=row.timestamp_ns,
                heading_rad=heading,
                anisotropy=0.0,
                fresh=True,
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
        missing_requirements=() if points else ("learned-heading:no-output",),
    )


def predict_device_heading_series(
    series: LearnedFeatureSeries, *, config: LearnedHeadingConfig
) -> BodyHeadingRun:
    """Matched-grid direct-device baseline with no learned correction."""

    if not series.supported or not series.rows:
        return BodyHeadingRun(
            estimator="direct Game Rotation Vector device heading on learned grid",
            version=f"1.0.0+{config.config_id}",
            required_capability_profile="platform-fused",
            supported=False,
            used_sensor_types=frozenset(),
            points=(),
            missing_requirements=series.missing_requirements or ("no-feature-rows",),
        )
    heading = 0.0
    points = []
    for row in series.rows:
        if not row.segment_start:
            heading = _wrap_angle(heading + row.device_heading_delta_rad)
        points.append(
            BodyHeadingPoint(
                timestamp_ns=row.timestamp_ns,
                heading_rad=heading,
                anisotropy=0.0,
                fresh=True,
                source_start_ns=row.source_end_ns,
                source_end_ns=row.source_end_ns,
            )
        )
    return BodyHeadingRun(
        estimator="direct Game Rotation Vector device heading on learned grid",
        version=f"1.0.0+{config.config_id}",
        required_capability_profile="platform-fused",
        supported=True,
        used_sensor_types=frozenset({GAME_ROTATION_VECTOR}),
        points=tuple(points),
    )


def canonical_model_bytes(model: ResidualRidgeModel) -> bytes:
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


def model_sha256(model: ResidualRidgeModel) -> str:
    return hashlib.sha256(canonical_model_bytes(model)).hexdigest()


def write_model(path: Path, model: ResidualRidgeModel) -> str:
    content = canonical_model_bytes(model)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)
    return hashlib.sha256(content).hexdigest()


def read_model(path: Path) -> ResidualRidgeModel:
    payload = json.loads(path.read_text(encoding="utf-8"))
    config_payload = payload["config"]
    config = get_learned_heading_config(config_payload["config_id"])
    if asdict(config) != config_payload:
        raise ValueError("Serialized learned-heading config changed")
    model = ResidualRidgeModel(
        schema_version=int(payload["schema_version"]),
        estimator=str(payload["estimator"]),
        config=config,
        feature_names=tuple(payload["feature_names"]),
        feature_mean=tuple(float(value) for value in payload["feature_mean"]),
        feature_scale=tuple(float(value) for value in payload["feature_scale"]),
        coefficients=tuple(float(value) for value in payload["coefficients"]),
        intercept_rad_s=float(payload["intercept_rad_s"]),
        trained_sequence_ids=tuple(payload["trained_sequence_ids"]),
        training_row_count=int(payload["training_row_count"]),
        fit_rate_hz=int(payload["fit_rate_hz"]),
        seed=payload["seed"],
    )
    if model.schema_version != 1:
        raise ValueError("Unexpected learned-heading model schema")
    if len(model.feature_names) != FEATURE_COUNT:
        raise ValueError("Serialized learned-heading feature schema changed")
    return model
