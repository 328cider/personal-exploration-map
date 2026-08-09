"""Research-only interfaces. None of these types are product map-truth APIs."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Mapping, Sequence


class FieldRole(str, Enum):
    LIVE_INPUT = "live-input"
    POST_SESSION_INPUT = "post-session-input"
    TRAINING_LABEL = "training-label"
    EVALUATION_ONLY = "evaluation-only"
    FORBIDDEN = "forbidden"


class CompatibilityDecision(str, Enum):
    PRODUCT_COMPATIBLE = "product-compatible"
    BENCHMARK_ONLY = "benchmark-only"
    REJECT = "reject"


@dataclass(frozen=True)
class CaptureCapabilityProfile:
    name: str
    required_sensor_types: frozenset[str]
    optional_sensor_types: frozenset[str] = frozenset()
    target_rates_hz: Mapping[str, float] = field(default_factory=dict)
    permissions: frozenset[str] = frozenset()

    def missing_required(self, available_sensor_types: set[str]) -> set[str]:
        return set(self.required_sensor_types) - available_sensor_types


@dataclass(frozen=True)
class AndroidFieldMapping:
    field_name: str
    role: FieldRole
    android_api: str | None
    sensor_type: str | None
    unit: str
    axes_or_frame: str
    timestamp_basis: str
    required_rate_hz: float | None
    reproducible_from_android_raw: bool
    transformation: str = "identity"


@dataclass(frozen=True)
class DatasetField:
    name: str
    mapping: AndroidFieldMapping
    availability: str
    notes: str = ""


@dataclass(frozen=True)
class DatasetCompatibilityReport:
    dataset: str
    source_url: str
    platform: str
    fields: tuple[DatasetField, ...]
    split_keys: tuple[str, ...]
    research_license: str
    redistribution_license: str
    product_license: str
    declared_decision: CompatibilityDecision
    decision_reasons: tuple[str, ...]
    content_hash: str | None = None


@dataclass(frozen=True)
class SensorMetadata:
    sensor_type: str
    android_api: str
    vendor: str
    version: int
    resolution: float
    maximum_range: float
    power_ma: float
    min_delay_us: int
    max_delay_us: int
    fifo_reserved_count: int
    fifo_max_count: int
    is_wake_up: bool
    reporting_mode: str


@dataclass(frozen=True)
class SensorSample:
    sensor_type: str
    sensor_timestamp_ns: int
    callback_timestamp_ns: int
    values: tuple[float, ...]
    accuracy: int
    sequence_id: int
    batch_id: int


@dataclass(frozen=True)
class NormalizedSensorSession:
    session_id: str
    capability_profile: str
    sensor_metadata: tuple[SensorMetadata, ...]
    samples: tuple[SensorSample, ...]
    provenance: Mapping[str, str]
    lifecycle_diagnostics: Sequence[Mapping[str, object]] = ()


@dataclass(frozen=True)
class EstimatePoint:
    timestamp_ns: int
    x_m: float
    y_m: float
    heading_rad: float
    uncertainty_m: float
    source_start_ns: int
    source_end_ns: int


@dataclass(frozen=True)
class EstimatorOutput:
    estimator: str
    version: str
    required_capability_profile: str
    frame: str
    mode: str
    points: tuple[EstimatePoint, ...]


@dataclass(frozen=True)
class EvaluationResult:
    session_id: str
    estimator: str
    estimator_version: str
    capability_profile: str
    metrics: Mapping[str, float | int | bool]
    failure_flags: tuple[str, ...]
    seed: int
    dataset_hash: str
