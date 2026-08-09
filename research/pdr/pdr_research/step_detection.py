"""Causal, source-rate-stable step candidates from Android accelerometer data.

The detector consumes only ``TYPE_ACCELEROMETER`` values and monotonic sensor
timestamps.  It first closes fixed-duration magnitude buckets, then uses
timestamp-derived filters and a peak/valley hysteresis state machine.  No truth,
future interpolation, platform orientation, or completed trajectory is visible
to this module.
"""

from __future__ import annotations

from dataclasses import dataclass
import math
import statistics

from .contracts import NormalizedSensorSession, SensorSample


ACCELEROMETER = "TYPE_ACCELEROMETER"


@dataclass(frozen=True)
class StepDetectorConfig:
    config_id: str
    internal_rate_hz: int
    baseline_tau_s: float
    smoothing_tau_s: float
    activation_threshold_mps2: float
    minimum_prominence_mps2: float
    release_threshold_mps2: float
    minimum_interval_s: float
    reset_gap_s: float = 0.20
    warmup_s: float = 0.60


@dataclass(frozen=True)
class DetectedStep:
    timestamp_ns: int
    amplitude_mps2: float
    source_start_ns: int
    source_end_ns: int


@dataclass(frozen=True)
class StepDetectionSummary:
    config_id: str
    event_count: int
    median_interval_s: float | None
    amplitude_quarter_power_sum: float
    future_sample_violations: int


# The development ranking is locked in RATE_STABILITY_PROTOCOL.md.  These
# configurations vary only magnitude and refractory gates; all share the same
# time-domain normalization and filter topology.
CANDIDATE_CONFIGS = (
    StepDetectorConfig(
        config_id="rs25-a010-p025-r025",
        internal_rate_hz=25,
        baseline_tau_s=0.75,
        smoothing_tau_s=0.08,
        activation_threshold_mps2=0.10,
        minimum_prominence_mps2=0.25,
        release_threshold_mps2=0.0,
        minimum_interval_s=0.25,
    ),
    StepDetectorConfig(
        config_id="rs25-a015-p030-r028",
        internal_rate_hz=25,
        baseline_tau_s=0.75,
        smoothing_tau_s=0.08,
        activation_threshold_mps2=0.15,
        minimum_prominence_mps2=0.30,
        release_threshold_mps2=0.0,
        minimum_interval_s=0.28,
    ),
    StepDetectorConfig(
        config_id="rs25-a020-p035-r030",
        internal_rate_hz=25,
        baseline_tau_s=0.75,
        smoothing_tau_s=0.08,
        activation_threshold_mps2=0.20,
        minimum_prominence_mps2=0.35,
        release_threshold_mps2=0.0,
        minimum_interval_s=0.30,
    ),
    StepDetectorConfig(
        config_id="rs25-a025-p045-r032",
        internal_rate_hz=25,
        baseline_tau_s=0.75,
        smoothing_tau_s=0.08,
        activation_threshold_mps2=0.25,
        minimum_prominence_mps2=0.45,
        release_threshold_mps2=0.0,
        minimum_interval_s=0.32,
    ),
)

CONFIGS_BY_ID = {config.config_id: config for config in CANDIDATE_CONFIGS}


def get_step_detector_config(config_id: str) -> StepDetectorConfig:
    try:
        return CONFIGS_BY_ID[config_id]
    except KeyError as error:
        raise ValueError(f"Unknown step detector config: {config_id}") from error


def _accelerometer_samples(
    session: NormalizedSensorSession,
) -> tuple[SensorSample, ...]:
    return tuple(
        sorted(
            (
                sample
                for sample in session.samples
                if sample.sensor_type == ACCELEROMETER
            ),
            key=lambda sample: (sample.sensor_timestamp_ns, sample.sequence_id),
        )
    )


def _causal_magnitude_buckets(
    samples: tuple[SensorSample, ...], *, target_rate_hz: int
) -> tuple[tuple[int, float, int, int], ...]:
    """Average completed time buckets without future interpolation.

    The bucket grid is anchored to monotonic-clock multiples, rather than the
    first delivered sample.  Thus the same physical stream sampled at 50 or
    100 Hz uses the same 40 ms boundaries for a 25 Hz detector.
    """

    if target_rate_hz <= 0 or 1_000_000_000 % target_rate_hz:
        raise ValueError("target_rate_hz must divide one second exactly")
    if not samples:
        return ()
    period_ns = 1_000_000_000 // target_rate_hz
    anchor_ns = samples[0].sensor_timestamp_ns // period_ns * period_ns
    current_bucket: int | None = None
    magnitudes: list[float] = []
    source_start_ns = 0
    source_end_ns = 0
    result: list[tuple[int, float, int, int]] = []

    for sample in samples:
        bucket = (sample.sensor_timestamp_ns - anchor_ns) // period_ns
        if current_bucket is None:
            current_bucket = bucket
            source_start_ns = sample.sensor_timestamp_ns
        elif bucket != current_bucket:
            boundary_ns = anchor_ns + (current_bucket + 1) * period_ns
            if magnitudes:
                result.append(
                    (
                        boundary_ns,
                        sum(magnitudes) / len(magnitudes),
                        source_start_ns,
                        source_end_ns,
                    )
                )
            current_bucket = bucket
            magnitudes = []
            source_start_ns = sample.sensor_timestamp_ns
        magnitudes.append(math.sqrt(sum(value * value for value in sample.values[:3])))
        source_end_ns = sample.sensor_timestamp_ns

    # The final open bucket is intentionally not emitted: without a later event
    # crossing its boundary, a live implementation cannot know it is complete.
    return tuple(result)


def _filter_alpha(delta_s: float, tau_s: float) -> float:
    if delta_s <= 0.0 or tau_s <= 0.0:
        raise ValueError("Filter delta and time constant must be positive")
    return math.exp(-delta_s / tau_s)


def detect_rate_stable_steps(
    session: NormalizedSensorSession,
    *,
    config: StepDetectorConfig,
) -> tuple[DetectedStep, ...]:
    buckets = _causal_magnitude_buckets(
        _accelerometer_samples(session), target_rate_hz=config.internal_rate_hz
    )
    if len(buckets) < 3:
        return ()

    filtered_baseline = buckets[0][1]
    filtered_dynamic = 0.0
    previous_timestamp_ns = buckets[0][0]
    warmup_anchor_ns = buckets[0][0]
    valley_value = 0.0
    valley_timestamp_ns = buckets[0][0]
    armed = False
    peak_value = 0.0
    last_detection_ns = -10**18
    result: list[DetectedStep] = []

    for timestamp_ns, magnitude, source_start_ns, source_end_ns in buckets[1:]:
        delta_s = (timestamp_ns - previous_timestamp_ns) / 1_000_000_000
        if delta_s <= 0.0:
            raise ValueError("Magnitude bucket timestamps must increase")
        if delta_s > config.reset_gap_s:
            filtered_baseline = magnitude
            filtered_dynamic = 0.0
            warmup_anchor_ns = timestamp_ns
            valley_value = 0.0
            valley_timestamp_ns = timestamp_ns
            armed = False
            previous_timestamp_ns = timestamp_ns
            continue

        baseline_alpha = _filter_alpha(delta_s, config.baseline_tau_s)
        filtered_baseline = (
            baseline_alpha * filtered_baseline + (1.0 - baseline_alpha) * magnitude
        )
        detrended = magnitude - filtered_baseline
        smoothing_alpha = _filter_alpha(delta_s, config.smoothing_tau_s)
        filtered_dynamic = (
            smoothing_alpha * filtered_dynamic + (1.0 - smoothing_alpha) * detrended
        )
        previous_timestamp_ns = timestamp_ns

        if timestamp_ns - warmup_anchor_ns < round(config.warmup_s * 1e9):
            if filtered_dynamic < valley_value:
                valley_value = filtered_dynamic
                valley_timestamp_ns = timestamp_ns
            continue

        if not armed:
            if filtered_dynamic < valley_value:
                valley_value = filtered_dynamic
                valley_timestamp_ns = timestamp_ns
            if (
                filtered_dynamic >= config.activation_threshold_mps2
                and filtered_dynamic - valley_value
                >= config.minimum_prominence_mps2
            ):
                armed = True
                peak_value = filtered_dynamic
            continue

        if filtered_dynamic > peak_value:
            peak_value = filtered_dynamic
        if filtered_dynamic > config.release_threshold_mps2:
            continue

        amplitude = peak_value - valley_value
        minimum_interval_ns = round(config.minimum_interval_s * 1e9)
        if (
            amplitude >= config.minimum_prominence_mps2
            and timestamp_ns - last_detection_ns >= minimum_interval_ns
        ):
            result.append(
                DetectedStep(
                    timestamp_ns=timestamp_ns,
                    amplitude_mps2=amplitude,
                    source_start_ns=valley_timestamp_ns,
                    source_end_ns=source_end_ns,
                )
            )
            last_detection_ns = timestamp_ns
        armed = False
        valley_value = filtered_dynamic
        valley_timestamp_ns = timestamp_ns

    return tuple(result)


def summarize_step_detection(
    steps: tuple[DetectedStep, ...], *, config_id: str
) -> StepDetectionSummary:
    intervals = tuple(
        (right.timestamp_ns - left.timestamp_ns) / 1_000_000_000
        for left, right in zip(steps, steps[1:])
    )
    return StepDetectionSummary(
        config_id=config_id,
        event_count=len(steps),
        median_interval_s=statistics.median(intervals) if intervals else None,
        amplitude_quarter_power_sum=sum(
            step.amplitude_mps2 ** 0.25 for step in steps
        ),
        future_sample_violations=sum(
            step.source_end_ns > step.timestamp_ns for step in steps
        ),
    )
