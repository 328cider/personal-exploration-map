"""Compatibility, leakage, profile, and temporal-causality gates."""

from __future__ import annotations

from dataclasses import dataclass

from .contracts import (
    CompatibilityDecision,
    DatasetCompatibilityReport,
    EstimatorOutput,
    FieldRole,
    NormalizedSensorSession,
)
from .profiles import PROFILES


@dataclass(frozen=True)
class GateFinding:
    severity: str
    code: str
    message: str


def audit_report(report: DatasetCompatibilityReport) -> tuple[GateFinding, ...]:
    findings: list[GateFinding] = []
    seen: set[str] = set()
    for dataset_field in report.fields:
        mapping = dataset_field.mapping
        if mapping.field_name in seen:
            findings.append(GateFinding("error", "duplicate-field", mapping.field_name))
        seen.add(mapping.field_name)

        if mapping.role in {FieldRole.LIVE_INPUT, FieldRole.POST_SESSION_INPUT}:
            if not mapping.android_api:
                findings.append(
                    GateFinding("error", "missing-android-api", mapping.field_name)
                )
            if not mapping.reproducible_from_android_raw:
                findings.append(
                    GateFinding("error", "non-reproducible-input", mapping.field_name)
                )
            if mapping.required_rate_hz is not None and mapping.required_rate_hz > 200:
                findings.append(
                    GateFinding("error", "unsupported-rate", mapping.field_name)
                )
            elif mapping.required_rate_hz is not None and mapping.required_rate_hz > 100:
                findings.append(
                    GateFinding("warning", "rate-needs-device-gate", mapping.field_name)
                )

    required_split_keys = {"dataset", "user", "device", "sequence"}
    missing_split_keys = sorted(required_split_keys - set(report.split_keys))
    if missing_split_keys:
        findings.append(
            GateFinding(
                "error",
                "missing-split-keys",
                f"{report.dataset}: {missing_split_keys}",
            )
        )
    normalized_license = report.product_license.strip().lower()
    if any(marker in normalized_license for marker in ("unknown", "unclear", "research-only")):
        findings.append(GateFinding("warning", "product-license-unresolved", report.dataset))
    return tuple(findings)


def computed_decision(report: DatasetCompatibilityReport) -> CompatibilityDecision:
    findings = audit_report(report)
    if report.declared_decision is CompatibilityDecision.REJECT:
        return CompatibilityDecision.REJECT
    if any(finding.severity == "error" for finding in findings):
        return CompatibilityDecision.REJECT
    if findings or report.declared_decision is CompatibilityDecision.BENCHMARK_ONLY:
        return CompatibilityDecision.BENCHMARK_ONLY
    return CompatibilityDecision.PRODUCT_COMPATIBLE


def validate_inference_fields(
    report: DatasetCompatibilityReport,
    field_names: set[str],
    *,
    live: bool,
) -> None:
    fields = {field.mapping.field_name: field.mapping for field in report.fields}
    unknown = sorted(field_names - set(fields))
    if unknown:
        raise ValueError(f"Unknown inference fields: {unknown}")
    permitted = {FieldRole.LIVE_INPUT} if live else {
        FieldRole.LIVE_INPUT,
        FieldRole.POST_SESSION_INPUT,
    }
    leaked = sorted(name for name in field_names if fields[name].role not in permitted)
    if leaked:
        raise ValueError(f"Label/evaluation/forbidden fields used as inference input: {leaked}")


def validate_session(session: NormalizedSensorSession) -> None:
    if session.capability_profile not in PROFILES:
        raise ValueError(f"Unknown capability profile: {session.capability_profile}")
    metadata_types = {metadata.sensor_type for metadata in session.sensor_metadata}
    sample_types = {sample.sensor_type for sample in session.samples}
    undeclared = sorted(sample_types - metadata_types)
    if undeclared:
        raise ValueError(f"Samples without sensor metadata: {undeclared}")
    missing = PROFILES[session.capability_profile].missing_required(metadata_types)
    if missing:
        raise ValueError(f"Profile requirements not met: {sorted(missing)}")
    previous_sensor_timestamp = -1
    for sample in sorted(session.samples, key=lambda item: item.sequence_id):
        if sample.sensor_timestamp_ns < previous_sensor_timestamp:
            raise ValueError("Sensor timestamps are not monotonic by sequence")
        if sample.callback_timestamp_ns < sample.sensor_timestamp_ns:
            raise ValueError("Callback timestamp precedes sensor timestamp")
        previous_sensor_timestamp = sample.sensor_timestamp_ns


def validate_estimator_output(output: EstimatorOutput) -> None:
    if output.required_capability_profile not in PROFILES:
        raise ValueError("Estimator declares an unknown capability profile")
    if output.mode not in {"live", "post-session"}:
        raise ValueError("Estimator mode must be live or post-session")
    for point in output.points:
        if point.source_start_ns > point.source_end_ns:
            raise ValueError("Estimator source range is reversed")
        if output.mode == "live" and point.source_end_ns > point.timestamp_ns:
            raise ValueError("Live estimator used a future sample")
