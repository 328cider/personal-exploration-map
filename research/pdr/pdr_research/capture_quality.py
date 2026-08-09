"""Validation and KPI calculation for research-only Android capture bundles.

The validator deliberately treats logger output as evidence, never as map truth.
It has no Android dependency and is suitable for Docker/CI replay before a bundle
is allowed into an estimator or training pipeline.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
import hashlib
import json
import math
from pathlib import Path, PurePosixPath
from typing import Any, Iterable, Iterator, Mapping, Sequence
import zipfile


SCHEMA_VERSION = "pdr-capture/v1"
REQUIRED_SENSOR_TYPES = frozenset({"TYPE_ACCELEROMETER", "TYPE_GYROSCOPE"})
ALLOWED_CAPTURE_MODES = {
    "live-50": (50, 20_000, 0),
    "live-100": (100, 10_000, 0),
    "batch-50-250": (50, 20_000, 250_000),
    "batch-100-250": (100, 10_000, 250_000),
}
ALLOWED_PLACEMENTS = {"front-left", "front-right", "rear-left", "rear-right", "hand", "bag", "other-declared"}
ALLOWED_LIFECYCLES = {
    "foreground-screen-on",
    "foreground-service-screen-on-to-off",
    "foreground-service-screen-off",
    "foreground-service-app-background",
    "foreground-service-notification-return",
}
ALLOWED_MOTION_CONDITIONS = {"no-walking", "stationary", "walk", "mixed"}
ALLOWED_ROLES = frozenset(
    {"live-input", "post-session-input", "training-label", "evaluation-only", "forbidden"}
)


@dataclass(frozen=True)
class CaptureFinding:
    severity: str
    code: str
    message: str
    stream: str | None = None
    line: int | None = None


@dataclass(frozen=True)
class SensorQuality:
    sensor_type: str
    samples: int
    duration_s: float
    realized_rate_hz: float
    interval_p50_ms: float
    interval_p95_ms: float
    callback_latency_p95_ms: float
    max_gap_ms: float
    gaps_ge_100ms: int
    gaps_ge_1000ms: int
    effective_coverage: float


@dataclass(frozen=True)
class CaptureProtocolMetadata:
    program_id: str
    program_revision: int
    participant_code: str
    device_pseudonym: str
    placement: str
    route_id: str
    split: str
    lifecycle: str
    motion_condition: str
    planned_duration_s: int
    capture_mode: str
    request_step_sensors: bool
    request_location: bool
    hold_wake_lock: bool


@dataclass(frozen=True)
class LifecycleEvidence:
    screen_on_s: float
    screen_off_s: float
    activity_visible_s: float
    activity_hidden_s: float
    notification_return_observed: bool
    declared_protocol_satisfied: bool


@dataclass(frozen=True)
class ResourceQuality:
    evidence_bytes: int
    storage_available_delta_bytes: int | None
    battery_start_fraction: float | None
    battery_end_fraction: float | None
    battery_drain_percentage_points_per_hour: float | None
    battery_guardrail_eligible: bool
    max_battery_temperature_c: float | None
    thermal_severe_or_worse_s: float


@dataclass(frozen=True)
class CaptureQualityReport:
    session_id: str
    outcome: str
    findings: tuple[CaptureFinding, ...]
    sensors: Mapping[str, SensorQuality]
    mandatory_imu_coverage: float
    integrity_rate: float
    writer_drop_count: int
    protocol_cell_id: str
    session_duration_s: float
    protocol: CaptureProtocolMetadata
    lifecycle: LifecycleEvidence
    resources: ResourceQuality

    @property
    def usable(self) -> bool:
        return self.outcome == "usable"

    def to_dict(self) -> dict[str, Any]:
        return {
            "schema_version": "pdr-capture-quality/v1",
            "session_id": self.session_id,
            "outcome": self.outcome,
            "usable": self.usable,
            "protocol_cell_id": self.protocol_cell_id,
            "session_duration_s": self.session_duration_s,
            "protocol": {
                "program_id": self.protocol.program_id,
                "program_revision": self.protocol.program_revision,
                "participant_code": self.protocol.participant_code,
                "device_pseudonym": self.protocol.device_pseudonym,
                "placement": self.protocol.placement,
                "route_id": self.protocol.route_id,
                "split": self.protocol.split,
                "lifecycle": self.protocol.lifecycle,
                "motion_condition": self.protocol.motion_condition,
                "planned_duration_s": self.protocol.planned_duration_s,
                "capture_mode": self.protocol.capture_mode,
                "request_step_sensors": self.protocol.request_step_sensors,
                "request_location": self.protocol.request_location,
                "hold_wake_lock": self.protocol.hold_wake_lock,
            },
            "lifecycle_evidence": {
                "screen_on_s": self.lifecycle.screen_on_s,
                "screen_off_s": self.lifecycle.screen_off_s,
                "activity_visible_s": self.lifecycle.activity_visible_s,
                "activity_hidden_s": self.lifecycle.activity_hidden_s,
                "notification_return_observed": self.lifecycle.notification_return_observed,
                "declared_protocol_satisfied": self.lifecycle.declared_protocol_satisfied,
            },
            "resource_quality": {
                "evidence_bytes": self.resources.evidence_bytes,
                "storage_available_delta_bytes": self.resources.storage_available_delta_bytes,
                "battery_start_fraction": self.resources.battery_start_fraction,
                "battery_end_fraction": self.resources.battery_end_fraction,
                "battery_drain_percentage_points_per_hour": (
                    self.resources.battery_drain_percentage_points_per_hour
                ),
                "battery_guardrail_eligible": self.resources.battery_guardrail_eligible,
                "max_battery_temperature_c": self.resources.max_battery_temperature_c,
                "thermal_severe_or_worse_s": self.resources.thermal_severe_or_worse_s,
            },
            "mandatory_imu_coverage": self.mandatory_imu_coverage,
            "integrity_rate": self.integrity_rate,
            "writer_drop_count": self.writer_drop_count,
            "sensors": {
                key: {
                    "samples": value.samples,
                    "duration_s": value.duration_s,
                    "realized_rate_hz": value.realized_rate_hz,
                    "interval_p50_ms": value.interval_p50_ms,
                    "interval_p95_ms": value.interval_p95_ms,
                    "callback_latency_p95_ms": value.callback_latency_p95_ms,
                    "max_gap_ms": value.max_gap_ms,
                    "gaps_ge_100ms": value.gaps_ge_100ms,
                    "gaps_ge_1000ms": value.gaps_ge_1000ms,
                    "effective_coverage": value.effective_coverage,
                }
                for key, value in sorted(self.sensors.items())
            },
            "findings": [
                {
                    "severity": finding.severity,
                    "code": finding.code,
                    "message": finding.message,
                    "stream": finding.stream,
                    "line": finding.line,
                }
                for finding in self.findings
            ],
        }


@dataclass(frozen=True)
class CaptureProgramKpis:
    attempted_sessions: int
    usable_sessions: int
    capture_usability_rate: float
    planned_cells: int
    ready_cells: int
    evidence_readiness_rate: float
    median_mandatory_imu_coverage: float
    integrity_pass_rate: float
    plan_contract_violations: int
    stage_readiness: Mapping[str, Mapping[str, int | float]]
    outcome: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "schema_version": "pdr-capture-program-kpis/v1",
            "attempted_sessions": self.attempted_sessions,
            "usable_sessions": self.usable_sessions,
            "capture_usability_rate": self.capture_usability_rate,
            "planned_cells": self.planned_cells,
            "ready_cells": self.ready_cells,
            "evidence_readiness_rate": self.evidence_readiness_rate,
            "median_mandatory_imu_coverage": self.median_mandatory_imu_coverage,
            "integrity_pass_rate": self.integrity_pass_rate,
            "plan_contract_violations": self.plan_contract_violations,
            "stage_readiness": self.stage_readiness,
            "outcome": self.outcome,
        }


@dataclass(frozen=True)
class CapturePlanCell:
    cell_id: str
    stage: str
    split: str
    program_id: str
    program_revision: int
    participant_code: str
    device_pseudonym: str
    placement: str
    route_id: str
    lifecycle: str
    motion_condition: str
    planned_duration_s: int
    capture_mode: str
    request_step_sensors: bool
    request_location: bool
    hold_wake_lock: bool
    minimum_lifecycle_evidence_s: float
    required_usable_sessions: int
    truth_required: bool
    truth_ready: bool
    rights_ready: bool


def load_capture_program_plan(path: Path) -> tuple[CapturePlanCell, ...]:
    plan = json.loads(path.read_text(encoding="utf-8"))
    if plan.get("schema_version") != "pdr-capture-program/v1":
        raise ValueError("Unsupported capture-program schema")
    program_id = plan.get("program_id")
    program_revision = plan.get("program_revision")
    if not isinstance(program_id, str) or not program_id:
        raise ValueError("Capture plan needs a program_id")
    if type(program_revision) is not int or program_revision < 1:
        raise ValueError("Capture plan needs a positive program_revision")
    authorization = plan.get("authorization")
    if authorization not in {
        "desk-template-not-authorized-for-personal-collection",
        "approved-for-collection",
    }:
        raise ValueError("Capture plan needs an explicit authorization state")
    if authorization == "approved-for-collection" and not plan.get("frozen_before_collection"):
        raise ValueError("An approved capture plan must be frozen before collection")
    if authorization == "approved-for-collection":
        frozen_at = plan.get("frozen_at_utc")
        if not isinstance(frozen_at, str) or not frozen_at.endswith("Z"):
            raise ValueError("An approved capture plan needs an immutable UTC freeze timestamp")
    participants = _unique_index(plan.get("participants", []), "participant_code", "participant")
    devices = _unique_index(plan.get("devices", []), "device_pseudonym", "device")
    routes = _unique_index(plan.get("routes", []), "route_id", "route")
    seen_cells: set[str] = set()
    cells: list[CapturePlanCell] = []
    allowed_stages = {"E0", "C0", "C1", "C2"}
    allowed_splits = {"development", "tuning", "sealed-validation"}
    for raw in plan.get("cells", []):
        cell_id = str(raw.get("cell_id", ""))
        if not cell_id or cell_id in seen_cells:
            raise ValueError(f"Duplicate or empty capture cell: {cell_id}")
        seen_cells.add(cell_id)
        stage = str(raw.get("stage", ""))
        split = str(raw.get("split", ""))
        if stage not in allowed_stages or split not in allowed_splits:
            raise ValueError(f"Invalid stage/split in {cell_id}")
        capture_mode = str(raw.get("capture_mode", ""))
        placement = str(raw.get("placement", ""))
        lifecycle = str(raw.get("lifecycle", ""))
        motion_condition = str(raw.get("motion_condition", ""))
        if capture_mode not in ALLOWED_CAPTURE_MODES:
            raise ValueError(f"Invalid capture mode in {cell_id}")
        if placement not in ALLOWED_PLACEMENTS:
            raise ValueError(f"Invalid placement in {cell_id}")
        if lifecycle not in ALLOWED_LIFECYCLES:
            raise ValueError(f"Invalid lifecycle in {cell_id}")
        if motion_condition not in ALLOWED_MOTION_CONDITIONS:
            raise ValueError(f"Invalid motion condition in {cell_id}")
        if stage == "E0" and motion_condition != "no-walking":
            raise ValueError(f"E0 must remain no-walking: {cell_id}")
        if stage == "C0" and motion_condition not in {"no-walking", "stationary"}:
            raise ValueError(f"C0 must remain a no-walking capability stage: {cell_id}")
        if stage in {"C1", "C2"} and motion_condition not in {"walk", "mixed"}:
            raise ValueError(f"{stage} must declare walking or mixed motion: {cell_id}")
        participant = participants.get(raw.get("participant_code"))
        device = devices.get(raw.get("device_pseudonym"))
        route = routes.get(raw.get("route_id"))
        if participant is None or device is None or route is None:
            raise ValueError(f"Unresolved participant/device/route in {cell_id}")
        for entity_name, entity in (("participant", participant), ("device", device), ("route", route)):
            if entity.get("split") != split:
                raise ValueError(f"{entity_name} split leakage in {cell_id}")
        truth_required = bool(raw.get("truth_required"))
        truth_ready = bool(raw.get("truth_ready"))
        rights_ready = bool(raw.get("rights_ready"))
        if rights_ready and not route.get("rights_ready", False):
            raise ValueError(f"Cell claims rights readiness but route does not: {cell_id}")
        if stage == "C2" and not truth_required:
            raise ValueError(f"C2 accuracy cell must require independent truth: {cell_id}")
        if truth_ready and truth_required and not route.get("continuous_truth", False):
            raise ValueError(f"Cell claims ready truth but route lacks continuous truth: {cell_id}")
        required = int(raw.get("required_usable_sessions", plan.get("minimum_usable_sessions_per_cell", 1)))
        if required < 1:
            raise ValueError(f"Invalid required session count in {cell_id}")
        planned_duration_s = int(raw.get("planned_duration_s", 0))
        minimum_lifecycle_evidence_s = float(raw.get("minimum_lifecycle_evidence_s", 0.0))
        if not 60 <= planned_duration_s <= 21_600:
            raise ValueError(f"Invalid planned duration in {cell_id}")
        if not 0 < minimum_lifecycle_evidence_s <= planned_duration_s:
            raise ValueError(f"Invalid minimum lifecycle evidence in {cell_id}")
        request_flags: dict[str, bool] = {}
        for flag in ("request_step_sensors", "request_location", "hold_wake_lock"):
            if type(raw.get(flag)) is not bool:
                raise ValueError(f"{flag} must be boolean in {cell_id}")
            request_flags[flag] = raw[flag]
        cells.append(
            CapturePlanCell(
                cell_id=cell_id,
                stage=stage,
                split=split,
                program_id=program_id,
                program_revision=program_revision,
                participant_code=str(raw["participant_code"]),
                device_pseudonym=str(raw["device_pseudonym"]),
                placement=placement,
                route_id=str(raw["route_id"]),
                lifecycle=lifecycle,
                motion_condition=motion_condition,
                planned_duration_s=planned_duration_s,
                capture_mode=capture_mode,
                request_step_sensors=request_flags["request_step_sensors"],
                request_location=request_flags["request_location"],
                hold_wake_lock=request_flags["hold_wake_lock"],
                minimum_lifecycle_evidence_s=minimum_lifecycle_evidence_s,
                required_usable_sessions=required,
                truth_required=truth_required,
                truth_ready=truth_ready,
                rights_ready=rights_ready,
            )
        )
    if not cells:
        raise ValueError("Capture plan has no cells")
    return tuple(cells)


class _BundleReader:
    def __init__(self, path: Path):
        self.path = path
        self._zip: zipfile.ZipFile | None = None
        self._prefix = ""
        if path.is_file():
            self._zip = zipfile.ZipFile(path)
            names = [name for name in self._zip.namelist() if not name.endswith("/")]
            manifest_names = [name for name in names if PurePosixPath(name).name == "session_manifest.json"]
            start_names = [name for name in names if PurePosixPath(name).name == "session_start.json"]
            anchors = manifest_names if len(manifest_names) == 1 else start_names
            if len(anchors) != 1:
                raise ValueError("Capture ZIP must contain one session manifest or one partial session start")
            parent = str(PurePosixPath(anchors[0]).parent)
            self._prefix = "" if parent == "." else f"{parent}/"
        elif not path.is_dir():
            raise FileNotFoundError(path)

    def close(self) -> None:
        if self._zip is not None:
            self._zip.close()

    def exists(self, relative: str) -> bool:
        if self._zip is not None:
            return f"{self._prefix}{relative}" in self._zip.namelist()
        return (self.path / relative).is_file()

    def read_bytes(self, relative: str) -> bytes:
        if self._zip is not None:
            return self._zip.read(f"{self._prefix}{relative}")
        return (self.path / relative).read_bytes()

    def file_names(self) -> set[str]:
        if self._zip is not None:
            return {
                name.removeprefix(self._prefix)
                for name in self._zip.namelist()
                if name.startswith(self._prefix) and not name.endswith("/")
            }
        return {
            str(path.relative_to(self.path)).replace("\\", "/")
            for path in self.path.rglob("*")
            if path.is_file()
        }


def load_field_contract(path: Path) -> dict[str, Any]:
    contract = json.loads(path.read_text(encoding="utf-8"))
    if contract.get("schema_version") != SCHEMA_VERSION:
        raise ValueError("Unsupported capture field contract")
    for stream_name, stream in contract.get("streams", {}).items():
        fields = stream.get("fields", {})
        if not fields:
            raise ValueError(f"Field contract stream has no fields: {stream_name}")
        for field_name, field in fields.items():
            role = field.get("role")
            if role not in ALLOWED_ROLES:
                raise ValueError(f"Invalid role for {stream_name}.{field_name}: {role}")
            if role in {"live-input", "post-session-input"} and not field.get("android_api"):
                raise ValueError(f"Inference field lacks Android API: {stream_name}.{field_name}")
    return contract


def _protocol_metadata(
    manifest: Mapping[str, Any],
    findings: list[CaptureFinding],
) -> CaptureProtocolMetadata:
    protocol = manifest.get("protocol")
    capture_config = manifest.get("capture_config")
    if not isinstance(protocol, Mapping):
        findings.append(CaptureFinding("critical", "invalid-protocol-metadata", "protocol must be an object"))
        protocol = {}
    if not isinstance(capture_config, Mapping):
        findings.append(
            CaptureFinding("critical", "invalid-capture-config", "capture_config must be an object")
        )
        capture_config = {}

    def text_field(source: Mapping[str, Any], name: str) -> str:
        value = source.get(name)
        if not isinstance(value, str) or not value:
            findings.append(CaptureFinding("critical", "invalid-protocol-field", name))
            return ""
        return value

    def bool_field(source: Mapping[str, Any], name: str) -> bool:
        value = source.get(name)
        if type(value) is not bool:
            findings.append(CaptureFinding("critical", "invalid-protocol-field", name))
            return False
        return value

    duration = protocol.get("planned_duration_s")
    if type(duration) is not int or not 60 <= duration <= 21_600:
        findings.append(CaptureFinding("critical", "invalid-protocol-field", "planned_duration_s"))
        duration = 0
    program_revision = protocol.get("program_revision")
    if type(program_revision) is not int or program_revision < 1:
        findings.append(CaptureFinding("critical", "invalid-protocol-field", "program_revision"))
        program_revision = 0
    result = CaptureProtocolMetadata(
        program_id=text_field(protocol, "program_id"),
        program_revision=program_revision,
        participant_code=text_field(protocol, "participant_code"),
        device_pseudonym=text_field(protocol, "device_pseudonym"),
        placement=text_field(protocol, "placement"),
        route_id=text_field(protocol, "route_id"),
        split=text_field(protocol, "split"),
        lifecycle=text_field(protocol, "lifecycle"),
        motion_condition=text_field(protocol, "motion_condition"),
        planned_duration_s=duration,
        capture_mode=text_field(capture_config, "mode"),
        request_step_sensors=bool_field(capture_config, "step_sensors_requested"),
        request_location=bool_field(capture_config, "location_requested"),
        hold_wake_lock=bool_field(capture_config, "wake_lock_requested"),
    )
    enum_fields = (
        ("placement", result.placement, ALLOWED_PLACEMENTS),
        ("split", result.split, {"development", "tuning", "sealed-validation"}),
        ("lifecycle", result.lifecycle, ALLOWED_LIFECYCLES),
        ("motion_condition", result.motion_condition, ALLOWED_MOTION_CONDITIONS),
        ("mode", result.capture_mode, set(ALLOWED_CAPTURE_MODES)),
    )
    for name, value, allowed in enum_fields:
        if value not in allowed:
            findings.append(CaptureFinding("critical", "invalid-protocol-enum", f"{name}={value}"))
    expected_mode = ALLOWED_CAPTURE_MODES.get(result.capture_mode)
    if expected_mode is not None:
        observed_mode = tuple(
            capture_config.get(name)
            for name in ("target_rate_hz", "sampling_period_us", "max_report_latency_us")
        )
        if observed_mode != expected_mode:
            findings.append(
                CaptureFinding(
                    "critical",
                    "capture-mode-config-mismatch",
                    f"{result.capture_mode}: expected={expected_mode}, observed={observed_mode}",
                )
            )
    return result


def _check_start_capture_config(
    start_document: Mapping[str, Any],
    manifest: Mapping[str, Any],
    findings: list[CaptureFinding],
) -> None:
    start = start_document.get("capture_config")
    final = manifest.get("capture_config")
    if not isinstance(start, Mapping) or not isinstance(final, Mapping):
        findings.append(CaptureFinding("critical", "start-manifest-config-mismatch", "missing config"))
        return
    shared = (
        "mode",
        "target_rate_hz",
        "sampling_period_us",
        "max_report_latency_us",
        "step_sensors_requested",
        "location_requested",
        "wake_lock_requested",
    )
    mismatched = [name for name in shared if start.get(name) != final.get(name)]
    if mismatched:
        findings.append(
            CaptureFinding(
                "critical",
                "start-manifest-config-mismatch",
                f"mismatched fields: {mismatched}",
            )
        )


def validate_capture_bundle(
    bundle_path: Path,
    *,
    contract_path: Path,
) -> CaptureQualityReport:
    contract = load_field_contract(contract_path)
    sensor_layouts = json.loads(
        (contract_path.parent / "sensor-value-layouts.json").read_text(encoding="utf-8")
    )["sensors"]
    findings: list[CaptureFinding] = []
    try:
        reader = _BundleReader(bundle_path)
    except (FileNotFoundError, ValueError, zipfile.BadZipFile) as exc:
        return _invalid_bundle_report(bundle_path, "unreadable-bundle", str(exc))
    try:
        if not reader.exists("session_manifest.json"):
            return _interrupted_report(reader, bundle_path)
        try:
            manifest = json.loads(reader.read_bytes("session_manifest.json"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            return _invalid_bundle_report(bundle_path, "malformed-manifest", str(exc))
        if not isinstance(manifest, Mapping):
            return _invalid_bundle_report(
                bundle_path, "malformed-manifest", "session_manifest.json must contain an object"
            )
        session_id = str(manifest.get("session_id", ""))
        protocol = _protocol_metadata(manifest, findings)
        protocol_document = manifest.get("protocol")
        protocol_cell_id = str(
            protocol_document.get("cell_id", "") if isinstance(protocol_document, Mapping) else ""
        )
        _check_forbidden_document_fields(manifest, contract, findings, "session_manifest")
        _check_finite(manifest, findings, "session_manifest", 1)
        if manifest.get("schema_version") != SCHEMA_VERSION:
            findings.append(CaptureFinding("critical", "schema-version", "Unsupported schema version"))
        if manifest.get("status") != "complete" or not reader.exists("COMPLETED"):
            findings.append(CaptureFinding("critical", "incomplete-session", "Bundle was not atomically finalized"))
        if not session_id:
            findings.append(CaptureFinding("critical", "missing-session-id", "Manifest session_id is empty"))
        if not protocol_cell_id:
            findings.append(CaptureFinding("high", "missing-protocol-cell", "Protocol cell is required for grouped evaluation"))

        manifest_files = manifest.get("files", [])
        if not isinstance(manifest_files, list) or not manifest_files:
            findings.append(CaptureFinding("critical", "missing-file-inventory", "Manifest file inventory is empty"))
            manifest_files = []
        declared_names: set[str] = set()
        hash_passes = 0
        hash_checks = 0
        for entry in manifest_files:
            if not isinstance(entry, Mapping):
                findings.append(CaptureFinding("critical", "invalid-file-entry", str(entry)))
                continue
            relative = str(entry.get("path", ""))
            stream = str(entry.get("stream", ""))
            if stream not in {"session_start", *contract.get("streams", {}).keys()}:
                findings.append(CaptureFinding("critical", "forbidden-stream", stream or relative))
            if not _safe_relative_path(relative):
                findings.append(CaptureFinding("critical", "unsafe-path", f"Unsafe file path: {relative}"))
                continue
            if relative in declared_names:
                findings.append(CaptureFinding("critical", "duplicate-file-entry", relative))
                continue
            declared_names.add(relative)
            hash_checks += 1
            if not reader.exists(relative):
                findings.append(CaptureFinding("critical", "missing-declared-file", relative))
                continue
            content = reader.read_bytes(relative)
            actual = hashlib.sha256(content).hexdigest()
            if actual != entry.get("sha256"):
                findings.append(CaptureFinding("critical", "hash-mismatch", relative))
            elif len(content) != entry.get("bytes"):
                findings.append(CaptureFinding("critical", "size-mismatch", relative))
            else:
                hash_passes += 1
            if stream == "session_start" and entry.get("records") != 1:
                findings.append(CaptureFinding("critical", "session-start-record-count", relative))
        allowed_unhashed = {"session_manifest.json", "COMPLETED"}
        unexpected = sorted(reader.file_names() - declared_names - allowed_unhashed)
        for relative in unexpected:
            findings.append(CaptureFinding("high", "unhashed-file", relative))
        integrity_rate = hash_passes / hash_checks if hash_checks else 0.0

        if reader.exists("session_start.json"):
            try:
                start_document = json.loads(reader.read_bytes("session_start.json"))
                if not isinstance(start_document, Mapping):
                    findings.append(
                        CaptureFinding(
                            "critical", "malformed-session-start", "session_start.json must contain an object"
                        )
                    )
                    start_document = {}
                _check_forbidden_document_fields(start_document, contract, findings, "session_start")
                _check_finite(start_document, findings, "session_start", 1)
                if start_document.get("session_id") != session_id:
                    findings.append(CaptureFinding("critical", "start-manifest-session-mismatch", session_id))
                if start_document.get("protocol") != manifest.get("protocol"):
                    findings.append(
                        CaptureFinding("critical", "start-manifest-protocol-mismatch", session_id)
                    )
                _check_start_capture_config(start_document, manifest, findings)
                app_document = start_document.get("app")
                revision = (
                    app_document.get("research_revision")
                    if isinstance(app_document, Mapping)
                    else None
                )
                if not isinstance(revision, str) or not revision:
                    findings.append(
                        CaptureFinding("critical", "missing-research-revision", session_id, "session_start")
                    )
            except (UnicodeDecodeError, json.JSONDecodeError) as exc:
                findings.append(CaptureFinding("critical", "malformed-session-start", str(exc)))

        capabilities = _read_stream(reader, manifest_files, "capabilities", contract, session_id, findings)
        sensor_records = _read_stream(reader, manifest_files, "sensor_events", contract, session_id, findings)
        location_records = _read_stream(
            reader, manifest_files, "location_events", contract, session_id, findings
        )
        diagnostic_records = _read_stream(
            reader, manifest_files, "diagnostic_events", contract, session_id, findings
        )
        _check_session_time_bounds(sensor_records, location_records, diagnostic_records, manifest, findings)
        _check_diagnostic_contract(diagnostic_records, protocol, findings)
        _check_registration_capability_match(capabilities, diagnostic_records, findings)

        capability_types = {str(record.get("sensor_type")) for record in capabilities}
        observed_types = {str(record.get("sensor_type")) for record in sensor_records}
        for record in sensor_records:
            sensor_type = str(record.get("sensor_type"))
            layout = sensor_layouts.get(sensor_type)
            if layout is None:
                findings.append(CaptureFinding("critical", "unknown-sensor-layout", sensor_type, "sensor_events"))
                continue
            count = record.get("value_count")
            if not isinstance(count, int) or not int(layout["min_values"]) <= count <= int(layout["max_values"]):
                findings.append(
                    CaptureFinding(
                        "critical",
                        "sensor-layout-mismatch",
                        f"{sensor_type}: value_count={count}, expected={layout['min_values']}..{layout['max_values']}",
                        "sensor_events",
                    )
                )
        undeclared = sorted(observed_types - capability_types)
        for sensor_type in undeclared:
            findings.append(CaptureFinding("critical", "missing-capability-metadata", sensor_type, "sensor_events"))
        missing_required = sorted(REQUIRED_SENSOR_TYPES - observed_types)
        for sensor_type in missing_required:
            findings.append(CaptureFinding("critical", "missing-required-sensor", sensor_type, "sensor_events"))

        writer_document = manifest.get("writer")
        if not isinstance(writer_document, Mapping):
            findings.append(CaptureFinding("critical", "invalid-writer-summary", "writer must be an object"))
            writer_document = {}
        raw_drop_count = writer_document.get("dropped_records", 0)
        if type(raw_drop_count) is not int or raw_drop_count < 0:
            findings.append(CaptureFinding("critical", "invalid-writer-drop-count", str(raw_drop_count)))
            writer_drop_count = 0
        else:
            writer_drop_count = raw_drop_count
        if writer_drop_count:
            findings.append(
                CaptureFinding("critical", "writer-drops", f"Writer dropped {writer_drop_count} records")
            )
        if writer_document.get("fatal_error"):
            findings.append(CaptureFinding("critical", "writer-fatal-error", str(writer_document["fatal_error"])))

        session_duration_s = _session_duration_s(manifest)
        lifecycle = _lifecycle_evidence(
            diagnostic_records,
            manifest,
            protocol.lifecycle,
            findings,
        )
        resources = _resource_quality(diagnostic_records, manifest)
        capture_config_document = manifest.get("capture_config")
        if not isinstance(capture_config_document, Mapping):
            capture_config_document = {}
        raw_target_rate = capture_config_document.get("target_rate_hz")
        if type(raw_target_rate) not in {int, float} or raw_target_rate <= 0:
            findings.append(CaptureFinding("critical", "invalid-target-rate", str(raw_target_rate)))
            target_rate_hz = 100.0
        else:
            target_rate_hz = float(raw_target_rate)
        sensors = _sensor_quality(sensor_records, session_duration_s, target_rate_hz, findings)
        mandatory_coverage = min(
            (sensors[sensor].effective_coverage for sensor in REQUIRED_SENSOR_TYPES if sensor in sensors),
            default=0.0,
        )
        for sensor_type in REQUIRED_SENSOR_TYPES:
            quality = sensors.get(sensor_type)
            if quality is None:
                continue
            minimum_rate = 0.8 * min(target_rate_hz, 50.0)
            if quality.realized_rate_hz < minimum_rate:
                findings.append(
                    CaptureFinding(
                        "critical",
                        "insufficient-rate",
                        f"{sensor_type} realized {quality.realized_rate_hz:.2f} Hz; floor {minimum_rate:.2f} Hz",
                        "sensor_events",
                    )
                )
            if quality.gaps_ge_1000ms:
                findings.append(
                    CaptureFinding(
                        "critical",
                        "catastrophic-gap",
                        f"{sensor_type} has {quality.gaps_ge_1000ms} gaps >= 1000 ms",
                        "sensor_events",
                    )
                )
            elif quality.gaps_ge_100ms:
                findings.append(
                    CaptureFinding(
                        "high",
                        "continuity-gap",
                        f"{sensor_type} has {quality.gaps_ge_100ms} gaps >= 100 ms",
                        "sensor_events",
                    )
                )
        if mandatory_coverage < 0.95:
            findings.append(
                CaptureFinding(
                    "critical",
                    "insufficient-imu-coverage",
                    f"Mandatory IMU effective coverage is {mandatory_coverage:.3%}",
                )
            )
        elif mandatory_coverage < 0.98:
            findings.append(
                CaptureFinding(
                    "high",
                    "marginal-imu-coverage",
                    f"Mandatory IMU effective coverage is {mandatory_coverage:.3%}",
                )
            )

        severities = {finding.severity for finding in findings}
        if "critical" in severities:
            outcome = "invalid"
        elif "high" in severities:
            outcome = "diagnostic-only"
        else:
            outcome = "usable"
        return CaptureQualityReport(
            session_id=session_id,
            outcome=outcome,
            findings=tuple(findings),
            sensors=sensors,
            mandatory_imu_coverage=mandatory_coverage,
            integrity_rate=integrity_rate,
            writer_drop_count=writer_drop_count,
            protocol_cell_id=protocol_cell_id,
            session_duration_s=session_duration_s,
            protocol=protocol,
            lifecycle=lifecycle,
            resources=resources,
        )
    finally:
        reader.close()


def aggregate_capture_program(
    reports: Sequence[CaptureQualityReport],
    *,
    planned_cell_ids: Iterable[str] | None = None,
    plan_cells: Iterable[CapturePlanCell] | None = None,
    minimum_usable_sessions_per_cell: int = 1,
) -> CaptureProgramKpis:
    if (planned_cell_ids is None) == (plan_cells is None):
        raise ValueError("Provide exactly one of planned_cell_ids or plan_cells")
    exact_cells = tuple(plan_cells or ())
    cell_ids = (
        tuple(cell.cell_id for cell in exact_cells)
        if plan_cells is not None
        else tuple(sorted(frozenset(planned_cell_ids or ())))
    )
    if not cell_ids:
        raise ValueError("At least one planned capture cell is required")
    if minimum_usable_sessions_per_cell < 1:
        raise ValueError("minimum_usable_sessions_per_cell must be positive")
    usable = [report for report in reports if report.usable]
    per_cell = {cell_id: 0 for cell_id in cell_ids}
    plan_contract_violations = 0
    exact_by_id = {cell.cell_id: cell for cell in exact_cells}
    for report in reports:
        if plan_cells is not None:
            cell = exact_by_id.get(report.protocol_cell_id)
            if cell is None or not _report_matches_plan_cell(report, cell):
                plan_contract_violations += 1
    for report in usable:
        if plan_cells is None and report.protocol_cell_id in per_cell:
            per_cell[report.protocol_cell_id] += 1
        elif plan_cells is not None:
            cell = exact_by_id.get(report.protocol_cell_id)
            if cell is not None and _report_matches_plan_cell(report, cell):
                per_cell[cell.cell_id] += 1
    if plan_cells is None:
        ready_cell_ids = {
            cell_id
            for cell_id, count in per_cell.items()
            if count >= minimum_usable_sessions_per_cell
        }
        stages_by_cell = {cell_id: "unspecified" for cell_id in cell_ids}
    else:
        ready_cell_ids = {
            cell.cell_id
            for cell in exact_cells
            if per_cell[cell.cell_id] >= cell.required_usable_sessions
            and cell.rights_ready
            and (not cell.truth_required or cell.truth_ready)
        }
        stages_by_cell = {cell.cell_id: cell.stage for cell in exact_cells}
    ready_cells = len(ready_cell_ids)
    attempted = len(reports)
    usability = len(usable) / attempted if attempted else 0.0
    readiness = ready_cells / len(cell_ids)
    coverages = sorted(report.mandatory_imu_coverage for report in reports)
    median_coverage = _quantile(coverages, 0.5) if coverages else 0.0
    integrity_passes = sum(math.isclose(report.integrity_rate, 1.0) for report in reports)
    integrity_rate = integrity_passes / attempted if attempted else 0.0
    stage_readiness: dict[str, dict[str, int | float]] = {}
    for stage in sorted(set(stages_by_cell.values())):
        stage_cells = {cell_id for cell_id, cell_stage in stages_by_cell.items() if cell_stage == stage}
        stage_ready = len(stage_cells & ready_cell_ids)
        stage_readiness[stage] = {
            "planned_cells": len(stage_cells),
            "ready_cells": stage_ready,
            "readiness_rate": stage_ready / len(stage_cells),
        }
    # Program-level thresholds are preregistered decision targets, not claims
    # about current device performance.
    if (
        usability >= 0.90
        and readiness == 1.0
        and integrity_rate == 1.0
        and plan_contract_violations == 0
    ):
        outcome = "capture-ready"
    elif (
        usability >= 0.70
        and readiness >= 0.70
        and integrity_rate == 1.0
        and plan_contract_violations == 0
    ):
        outcome = "narrow-or-remediate"
    else:
        outcome = "stop-or-redesign"
    return CaptureProgramKpis(
        attempted_sessions=attempted,
        usable_sessions=len(usable),
        capture_usability_rate=usability,
        planned_cells=len(cell_ids),
        ready_cells=ready_cells,
        evidence_readiness_rate=readiness,
        median_mandatory_imu_coverage=median_coverage,
        integrity_pass_rate=integrity_rate,
        plan_contract_violations=plan_contract_violations,
        stage_readiness=stage_readiness,
        outcome=outcome,
    )


def _report_matches_plan_cell(report: CaptureQualityReport, cell: CapturePlanCell) -> bool:
    protocol = report.protocol
    metadata_matches = (
        report.protocol_cell_id == cell.cell_id
        and protocol.program_id == cell.program_id
        and protocol.program_revision == cell.program_revision
        and protocol.participant_code == cell.participant_code
        and protocol.device_pseudonym == cell.device_pseudonym
        and protocol.placement == cell.placement
        and protocol.route_id == cell.route_id
        and protocol.split == cell.split
        and protocol.lifecycle == cell.lifecycle
        and protocol.motion_condition == cell.motion_condition
        and protocol.planned_duration_s == cell.planned_duration_s
        and protocol.capture_mode == cell.capture_mode
        and protocol.request_step_sensors == cell.request_step_sensors
        and protocol.request_location == cell.request_location
        and protocol.hold_wake_lock == cell.hold_wake_lock
    )
    lifecycle_seconds = {
        "foreground-screen-on": report.lifecycle.screen_on_s,
        "foreground-service-screen-on-to-off": report.lifecycle.screen_off_s,
        "foreground-service-screen-off": report.lifecycle.screen_off_s,
        "foreground-service-app-background": report.lifecycle.activity_hidden_s,
        "foreground-service-notification-return": report.lifecycle.activity_hidden_s,
    }.get(cell.lifecycle, 0.0)
    return (
        metadata_matches
        and report.lifecycle.declared_protocol_satisfied
        and lifecycle_seconds >= cell.minimum_lifecycle_evidence_s
        and report.session_duration_s >= 0.95 * cell.planned_duration_s
    )


def validate_capture_attempts(
    capture_root: Path,
    *,
    contract_path: Path,
) -> tuple[CaptureQualityReport, ...]:
    """Validate complete bundles and retain interrupted partial attempts in KPIs."""

    reports_by_session: dict[str, CaptureQualityReport] = {}
    for path in sorted(capture_root.iterdir() if capture_root.exists() else ()):
        is_bundle_directory = path.is_dir() and path.name.endswith((".complete", ".partial"))
        is_exported_zip = path.is_file() and path.suffix.lower() == ".zip"
        if not (is_bundle_directory or is_exported_zip):
            continue
        report = validate_capture_bundle(path, contract_path=contract_path)
        prior = reports_by_session.get(report.session_id)
        if prior is None:
            reports_by_session[report.session_id] = report
        elif prior.to_dict() != report.to_dict():
            reports_by_session[report.session_id] = replace(
                prior,
                outcome="invalid",
                findings=prior.findings
                + (
                    CaptureFinding(
                        "critical",
                        "conflicting-attempt-artifacts",
                        f"Multiple non-identical artifacts claim session {report.session_id}",
                    ),
                ),
            )
    return tuple(reports_by_session[key] for key in sorted(reports_by_session))


def _interrupted_report(reader: _BundleReader, bundle_path: Path) -> CaptureQualityReport:
    session_id = bundle_path.name.removesuffix(".partial").removesuffix(".zip")
    protocol_cell_id = ""
    protocol = _empty_protocol_metadata()
    if reader.exists("session_start.json"):
        try:
            payload = json.loads(reader.read_bytes("session_start.json"))
            session_id = str(payload.get("session_id", session_id))
            protocol_cell_id = str(payload.get("protocol", {}).get("cell_id", ""))
            protocol = _protocol_metadata(payload, [])
        except (UnicodeDecodeError, json.JSONDecodeError):
            pass
    return CaptureQualityReport(
        session_id=session_id,
        outcome="invalid",
        findings=(
            CaptureFinding(
                "critical",
                "interrupted-partial-attempt",
                "Capture start attempt did not finalize; it remains in the KPI denominator",
            ),
        ),
        sensors={},
        mandatory_imu_coverage=0.0,
        integrity_rate=0.0,
        writer_drop_count=0,
        protocol_cell_id=protocol_cell_id,
        session_duration_s=0.0,
        protocol=protocol,
        lifecycle=LifecycleEvidence(0.0, 0.0, 0.0, 0.0, False, False),
        resources=_empty_resource_quality(),
    )


def _invalid_bundle_report(bundle_path: Path, code: str, message: str) -> CaptureQualityReport:
    return CaptureQualityReport(
        session_id=bundle_path.stem,
        outcome="invalid",
        findings=(CaptureFinding("critical", code, message),),
        sensors={},
        mandatory_imu_coverage=0.0,
        integrity_rate=0.0,
        writer_drop_count=0,
        protocol_cell_id="",
        session_duration_s=0.0,
        protocol=_empty_protocol_metadata(),
        lifecycle=LifecycleEvidence(0.0, 0.0, 0.0, 0.0, False, False),
        resources=_empty_resource_quality(),
    )


def _empty_protocol_metadata() -> CaptureProtocolMetadata:
    return CaptureProtocolMetadata("", 0, "", "", "", "", "", "", "", 0, "", False, False, False)


def _empty_resource_quality() -> ResourceQuality:
    return ResourceQuality(0, None, None, None, None, False, None, 0.0)


def _safe_relative_path(value: str) -> bool:
    path = PurePosixPath(value)
    return bool(value) and not path.is_absolute() and ".." not in path.parts and "\\" not in value


def _unique_index(rows: Sequence[Mapping[str, Any]], key: str, label: str) -> dict[str, Mapping[str, Any]]:
    result: dict[str, Mapping[str, Any]] = {}
    for row in rows:
        value = str(row.get(key, ""))
        if not value or value in result:
            raise ValueError(f"Duplicate or empty {label} key: {value}")
        result[value] = row
    return result


def _read_stream(
    reader: _BundleReader,
    manifest_files: Sequence[Mapping[str, Any]],
    stream_name: str,
    contract: Mapping[str, Any],
    session_id: str,
    findings: list[CaptureFinding],
) -> list[dict[str, Any]]:
    stream_contract = contract["streams"][stream_name]
    fields = stream_contract["fields"]
    required = {name for name, spec in fields.items() if spec.get("required")}
    open_payload = bool(stream_contract.get("open_payload"))
    entries = sorted(
        (entry for entry in manifest_files if str(entry.get("stream", "")) == stream_name),
        key=lambda entry: str(entry.get("path", "")),
    )
    names = [
        str(entry.get("path"))
        for entry in entries
    ]
    records: list[dict[str, Any]] = []
    seen_sequences: set[int] = set()
    forbidden_fragments = tuple(contract.get("forbidden_name_fragments", ()))
    expected_record_type = {
        "sensor_events": "sensor_event",
        "location_events": "location_event",
        "capabilities": "capability",
        "diagnostic_events": "diagnostic_event",
    }[stream_name]
    for entry, name in zip(entries, names):
        try:
            content = reader.read_bytes(name).decode("utf-8")
        except (KeyError, UnicodeDecodeError) as exc:
            findings.append(CaptureFinding("critical", "unreadable-stream", f"{name}: {exc}", stream_name))
            continue
        physical_lines = content.splitlines()
        if len(physical_lines) != entry.get("records"):
            findings.append(
                CaptureFinding(
                    "critical",
                    "record-count-mismatch",
                    f"{name}: manifest={entry.get('records')} actual={len(physical_lines)}",
                    stream_name,
                )
            )
        for line_number, line in enumerate(physical_lines, 1):
            if not line.strip():
                findings.append(CaptureFinding("high", "blank-record", name, stream_name, line_number))
                continue
            try:
                record = json.loads(line)
            except json.JSONDecodeError as exc:
                findings.append(CaptureFinding("critical", "malformed-json", str(exc), stream_name, line_number))
                continue
            if not isinstance(record, dict):
                findings.append(CaptureFinding("critical", "non-object-record", name, stream_name, line_number))
                continue
            missing = sorted(required - set(record))
            if missing:
                findings.append(
                    CaptureFinding("critical", "missing-fields", f"{name}: {missing}", stream_name, line_number)
                )
            unknown = set(record) - set(fields)
            if open_payload:
                unknown.discard("payload")
            if unknown:
                findings.append(
                    CaptureFinding("critical", "unknown-fields", f"{name}: {sorted(unknown)}", stream_name, line_number)
                )
            flattened_names = _nested_field_names(record)
            leaked = sorted(
                field_name
                for field_name in flattened_names
                if any(fragment in field_name.lower() for fragment in forbidden_fragments)
            )
            if leaked:
                findings.append(
                    CaptureFinding("critical", "truth-leakage", f"{name}: {leaked}", stream_name, line_number)
                )
            if record.get("schema_version") != SCHEMA_VERSION:
                findings.append(CaptureFinding("critical", "record-schema-version", name, stream_name, line_number))
            if record.get("record_type") != expected_record_type:
                findings.append(CaptureFinding("critical", "record-type-mismatch", name, stream_name, line_number))
            if record.get("session_id") != session_id:
                findings.append(CaptureFinding("critical", "cross-session-record", name, stream_name, line_number))
            sequence = record.get("sequence_id")
            if isinstance(sequence, int):
                if sequence in seen_sequences:
                    findings.append(CaptureFinding("critical", "duplicate-sequence", str(sequence), stream_name, line_number))
                seen_sequences.add(sequence)
            _check_finite(record, findings, stream_name, line_number)
            _check_stream_types(record, findings, stream_name, line_number)
            _check_location_availability(record, findings, stream_name, line_number)
            if stream_name == "sensor_events":
                values = record.get("values")
                if not isinstance(values, list) or record.get("value_count") != len(values):
                    findings.append(
                        CaptureFinding("critical", "sensor-value-count-mismatch", name, stream_name, line_number)
                    )
            if stream_name == "location_events":
                event_ns = record.get("location_elapsed_realtime_ns")
                callback_ns = record.get("callback_elapsed_realtime_ns")
                if isinstance(event_ns, int) and isinstance(callback_ns, int) and callback_ns < event_ns:
                    findings.append(
                        CaptureFinding("critical", "callback-before-location", name, stream_name, line_number)
                    )
            records.append(record)
    if "sequence_id" in fields and seen_sequences != set(range(len(records))):
        findings.append(
            CaptureFinding(
                "critical",
                "sequence-gap",
                f"{stream_name}: expected 0..{max(len(records) - 1, 0)}, observed {len(seen_sequences)} unique IDs",
                stream_name,
            )
        )
    timestamp_field = {
        "location_events": "location_elapsed_realtime_ns",
        "diagnostic_events": "elapsed_realtime_ns",
    }.get(stream_name)
    if timestamp_field is not None:
        previous = -1
        for record in sorted(
            records,
            key=lambda item: item.get("sequence_id", -1)
            if type(item.get("sequence_id")) is int
            else -1,
        ):
            timestamp = record.get(timestamp_field)
            if type(timestamp) is int:
                if timestamp < previous:
                    findings.append(
                        CaptureFinding(
                            "critical",
                            "timestamp-regression",
                            timestamp_field,
                            stream_name,
                        )
                    )
                previous = timestamp
    return records


def _check_stream_types(
    record: Mapping[str, Any],
    findings: list[CaptureFinding],
    stream: str,
    line: int,
) -> None:
    def require(name: str, predicate: bool) -> None:
        if not predicate:
            findings.append(CaptureFinding("critical", "field-type-mismatch", name, stream, line))

    require("schema_version", isinstance(record.get("schema_version"), str))
    require("record_type", isinstance(record.get("record_type"), str))
    require("session_id", isinstance(record.get("session_id"), str))
    if "sequence_id" in record:
        require("sequence_id", type(record.get("sequence_id")) is int and record["sequence_id"] >= 0)

    if stream == "sensor_events":
        require("sensor_type", isinstance(record.get("sensor_type"), str))
        require(
            "sensor_timestamp_ns",
            type(record.get("sensor_timestamp_ns")) is int and record["sensor_timestamp_ns"] > 0,
        )
        require(
            "callback_elapsed_realtime_ns",
            type(record.get("callback_elapsed_realtime_ns")) is int
            and record["callback_elapsed_realtime_ns"] > 0,
        )
        require("accuracy", type(record.get("accuracy")) is int)
        require("value_count", type(record.get("value_count")) is int)
        values = record.get("values")
        require(
            "values",
            isinstance(values, list)
            and all(type(value) in {int, float} and not isinstance(value, bool) for value in values),
        )
    elif stream == "location_events":
        integer_fields = ("location_elapsed_realtime_ns", "callback_elapsed_realtime_ns", "wall_time_ms")
        for name in integer_fields:
            require(name, type(record.get(name)) is int and record[name] >= 0)
        require("provider", isinstance(record.get("provider"), str))
        require("latitude_deg", type(record.get("latitude_deg")) in {int, float})
        require("longitude_deg", type(record.get("longitude_deg")) in {int, float})
        for name in (
            "has_elapsed_realtime_uncertainty",
            "has_accuracy",
            "has_altitude",
            "has_vertical_accuracy",
            "has_speed",
            "has_speed_accuracy",
            "has_bearing",
            "has_bearing_accuracy",
            "is_mock",
        ):
            require(name, type(record.get(name)) is bool)
        for name in (
            "elapsed_realtime_uncertainty_ns",
            "accuracy_m",
            "altitude_m",
            "vertical_accuracy_m",
            "speed_mps",
            "speed_accuracy_mps",
            "bearing_deg",
            "bearing_accuracy_deg",
        ):
            value = record.get(name)
            require(name, value is None or type(value) in {int, float})
    elif stream == "capabilities":
        for name in ("sensor_type", "name", "vendor", "reporting_mode"):
            require(name, isinstance(record.get(name), str))
        for name in (
            "sensor_type_id",
            "version",
            "min_delay_us",
            "max_delay_us",
            "fifo_reserved_event_count",
            "fifo_max_event_count",
        ):
            require(name, type(record.get(name)) is int)
        for name in ("resolution", "maximum_range", "power_ma"):
            require(name, type(record.get(name)) in {int, float})
        require("is_wake_up", type(record.get("is_wake_up")) is bool)
    elif stream == "diagnostic_events":
        require(
            "elapsed_realtime_ns",
            type(record.get("elapsed_realtime_ns")) is int and record["elapsed_realtime_ns"] > 0,
        )
        require("event", isinstance(record.get("event"), str))
        require("payload", isinstance(record.get("payload"), dict))


def _nested_field_names(value: Any, prefix: str = "") -> set[str]:
    names: set[str] = set()
    if isinstance(value, dict):
        for key, child in value.items():
            name = f"{prefix}.{key}" if prefix else str(key)
            names.add(name)
            names.update(_nested_field_names(child, name))
    elif isinstance(value, list):
        for child in value:
            names.update(_nested_field_names(child, prefix))
    return names


def _check_forbidden_document_fields(
    document: Mapping[str, Any],
    contract: Mapping[str, Any],
    findings: list[CaptureFinding],
    stream: str,
) -> None:
    fragments = tuple(contract.get("forbidden_name_fragments", ()))
    leaked = sorted(
        name
        for name in _nested_field_names(document)
        if any(fragment in name.lower() for fragment in fragments)
    )
    if leaked:
        findings.append(CaptureFinding("critical", "truth-leakage", f"{stream}: {leaked}", stream))


def _check_finite(
    value: Any,
    findings: list[CaptureFinding],
    stream: str,
    line: int,
    path: str = "",
) -> None:
    if isinstance(value, float) and not math.isfinite(value):
        findings.append(CaptureFinding("critical", "non-finite-value", path, stream, line))
    elif isinstance(value, dict):
        for key, child in value.items():
            _check_finite(child, findings, stream, line, f"{path}.{key}" if path else key)
    elif isinstance(value, list):
        for index, child in enumerate(value):
            _check_finite(child, findings, stream, line, f"{path}[{index}]")


def _check_location_availability(
    record: Mapping[str, Any],
    findings: list[CaptureFinding],
    stream: str,
    line: int,
) -> None:
    if stream != "location_events":
        return
    pairs = (
        ("has_elapsed_realtime_uncertainty", "elapsed_realtime_uncertainty_ns"),
        ("has_accuracy", "accuracy_m"),
        ("has_altitude", "altitude_m"),
        ("has_vertical_accuracy", "vertical_accuracy_m"),
        ("has_speed", "speed_mps"),
        ("has_speed_accuracy", "speed_accuracy_mps"),
        ("has_bearing", "bearing_deg"),
        ("has_bearing_accuracy", "bearing_accuracy_deg"),
    )
    for flag, value in pairs:
        if bool(record.get(flag)) != (record.get(value) is not None):
            findings.append(CaptureFinding("critical", "availability-contradiction", f"{flag}/{value}", stream, line))
    latitude = record.get("latitude_deg")
    longitude = record.get("longitude_deg")
    if isinstance(latitude, (int, float)) and not -90 <= latitude <= 90:
        findings.append(CaptureFinding("critical", "invalid-latitude", str(latitude), stream, line))
    if isinstance(longitude, (int, float)) and not -180 <= longitude <= 180:
        findings.append(CaptureFinding("critical", "invalid-longitude", str(longitude), stream, line))


def _session_duration_s(manifest: Mapping[str, Any]) -> float:
    start = manifest.get("started_elapsed_realtime_ns")
    end = manifest.get("ended_elapsed_realtime_ns")
    if type(start) is int and type(end) is int and end > start:
        return (end - start) / 1_000_000_000
    return 0.0


def _check_session_time_bounds(
    sensor_records: Sequence[Mapping[str, Any]],
    location_records: Sequence[Mapping[str, Any]],
    diagnostic_records: Sequence[Mapping[str, Any]],
    manifest: Mapping[str, Any],
    findings: list[CaptureFinding],
) -> None:
    start = manifest.get("started_elapsed_realtime_ns")
    end = manifest.get("ended_elapsed_realtime_ns")
    if type(start) is not int or type(end) is not int or end <= start:
        return
    checks = (
        ("sensor_events", sensor_records, ("sensor_timestamp_ns", "callback_elapsed_realtime_ns")),
        (
            "location_events",
            location_records,
            ("location_elapsed_realtime_ns", "callback_elapsed_realtime_ns"),
        ),
        ("diagnostic_events", diagnostic_records, ("elapsed_realtime_ns",)),
    )
    for stream, records, fields in checks:
        for record in records:
            for field in fields:
                value = record.get(field)
                if type(value) is int and not start <= value <= end:
                    findings.append(
                        CaptureFinding(
                            "critical",
                            "timestamp-outside-session",
                            f"{field}={value}, session={start}..{end}",
                            stream,
                        )
                    )


def _check_diagnostic_contract(
    records: Sequence[Mapping[str, Any]],
    protocol: CaptureProtocolMetadata,
    findings: list[CaptureFinding],
) -> None:
    events = [record.get("event") for record in records]
    required_events = {
        "capability_probe",
        "storage_preflight",
        "capture_started",
        "capture_stopping",
        "final_resource_snapshot",
        "sensor_flush_requested",
    }
    for event in sorted(required_events - set(events)):
        findings.append(
            CaptureFinding("critical", "missing-lifecycle-diagnostic", event, "diagnostic_events")
        )

    registrations: dict[str, Mapping[str, Any]] = {}
    flush_expected: set[str] = set()
    flush_accepted = False
    flush_completed: set[str] = set()
    for record in records:
        payload = record.get("payload")
        if not isinstance(payload, Mapping):
            continue
        event = record.get("event")
        if event == "sensor_registration" and isinstance(payload.get("sensor_type"), str):
            registrations[str(payload["sensor_type"])] = payload
        elif event == "sensor_flush_requested":
            flush_accepted = payload.get("accepted") is True
            expected = payload.get("expected_sensor_types")
            if isinstance(expected, list) and all(isinstance(value, str) for value in expected):
                flush_expected.update(expected)
        elif event == "sensor_flush_completed" and isinstance(payload.get("sensor_type"), str):
            flush_completed.add(str(payload["sensor_type"]))
    for sensor_type in sorted(REQUIRED_SENSOR_TYPES):
        registration = registrations.get(sensor_type)
        if registration is None or registration.get("registered") is not True:
            findings.append(
                CaptureFinding(
                    "critical",
                    "required-sensor-registration-not-proven",
                    sensor_type,
                    "diagnostic_events",
                )
            )
            continue
        expected_mode = ALLOWED_CAPTURE_MODES.get(protocol.capture_mode)
        if expected_mode is not None:
            _, expected_period_us, expected_latency_us = expected_mode
            if (
                registration.get("sampling_period_us") != expected_period_us
                or registration.get("max_report_latency_us") != expected_latency_us
            ):
                findings.append(
                    CaptureFinding(
                        "critical",
                        "required-sensor-registration-config-mismatch",
                        sensor_type,
                        "diagnostic_events",
                    )
                )
    if not flush_accepted:
        findings.append(
            CaptureFinding("critical", "sensor-flush-not-accepted", "clean-stop flush", "diagnostic_events")
        )
    missing_flush = sorted(flush_expected - flush_completed)
    if missing_flush:
        findings.append(
            CaptureFinding(
                "critical",
                "sensor-flush-incomplete",
                f"missing completion for {missing_flush}",
                "diagnostic_events",
            )
        )
    if flush_accepted and not flush_expected:
        findings.append(
            CaptureFinding(
                "critical",
                "sensor-flush-empty-contract",
                "accepted flush did not declare expected sensors",
                "diagnostic_events",
            )
        )


def _check_registration_capability_match(
    capabilities: Sequence[Mapping[str, Any]],
    diagnostics: Sequence[Mapping[str, Any]],
    findings: list[CaptureFinding],
) -> None:
    capability_keys = {
        (record.get("sensor_type"), record.get("name"), record.get("vendor"))
        for record in capabilities
    }
    for record in diagnostics:
        if record.get("event") != "sensor_registration":
            continue
        payload = record.get("payload")
        if not isinstance(payload, Mapping) or payload.get("registered") is not True:
            continue
        key = (payload.get("sensor_type"), payload.get("name"), payload.get("vendor"))
        if key not in capability_keys:
            findings.append(
                CaptureFinding(
                    "critical",
                    "registration-capability-mismatch",
                    f"registered sensor metadata missing from capability probe: {key}",
                    "diagnostic_events",
                )
            )


def _lifecycle_evidence(
    records: Sequence[Mapping[str, Any]],
    manifest: Mapping[str, Any],
    declared_protocol: str,
    findings: list[CaptureFinding],
) -> LifecycleEvidence:
    start = manifest.get("started_elapsed_realtime_ns")
    end = manifest.get("ended_elapsed_realtime_ns")
    if type(start) is not int or type(end) is not int or end <= start:
        findings.append(CaptureFinding("critical", "invalid-session-clock", "invalid start/end time"))
        start, end = 0, 0

    ordered = sorted(
        records,
        key=lambda record: int(record.get("elapsed_realtime_ns", -1))
        if type(record.get("elapsed_realtime_ns")) is int
        else -1,
    )
    screen_changes: list[tuple[int, bool]] = []
    activity_changes: list[tuple[int, bool]] = []
    hidden_seen = False
    notification_return = False
    for record in ordered:
        timestamp = record.get("elapsed_realtime_ns")
        payload = record.get("payload")
        if type(timestamp) is not int or not isinstance(payload, Mapping):
            continue
        event = record.get("event")
        if event == "screen_state" and type(payload.get("interactive")) is bool:
            screen_changes.append((timestamp, payload["interactive"]))
        elif type(payload.get("screen_interactive")) is bool:
            screen_changes.append((timestamp, payload["screen_interactive"]))
        if event == "activity_state" and payload.get("state") in {"visible", "hidden"}:
            visible = payload["state"] == "visible"
            activity_changes.append((timestamp, visible))
            if not visible:
                hidden_seen = True
            elif hidden_seen and payload.get("source") == "notification":
                notification_return = True

    screen_durations = _boolean_state_durations(screen_changes, start, end)
    activity_durations = _boolean_state_durations(activity_changes, start, end)
    screen_values = [value for _, value in screen_changes]
    on_to_off = any(
        left is True and right is False
        for index, left in enumerate(screen_values)
        for right in screen_values[index + 1 :]
    )
    satisfied = {
        "foreground-screen-on": screen_durations[True] > 0 and screen_durations[False] == 0,
        "foreground-service-screen-on-to-off": on_to_off,
        "foreground-service-screen-off": screen_durations[False] > 0,
        "foreground-service-app-background": activity_durations[False] > 0,
        "foreground-service-notification-return": notification_return,
    }.get(declared_protocol, False)
    if not satisfied:
        findings.append(
            CaptureFinding(
                "high",
                "declared-lifecycle-not-observed",
                declared_protocol or "missing lifecycle protocol",
                "diagnostic_events",
            )
        )
    return LifecycleEvidence(
        screen_on_s=screen_durations[True],
        screen_off_s=screen_durations[False],
        activity_visible_s=activity_durations[True],
        activity_hidden_s=activity_durations[False],
        notification_return_observed=notification_return,
        declared_protocol_satisfied=satisfied,
    )


def _boolean_state_durations(
    changes: Sequence[tuple[int, bool]],
    start_ns: int,
    end_ns: int,
) -> dict[bool, float]:
    durations = {True: 0.0, False: 0.0}
    if end_ns <= start_ns:
        return durations
    state: bool | None = None
    cursor = start_ns
    for timestamp, next_state in sorted(changes):
        timestamp = min(max(timestamp, start_ns), end_ns)
        if state is not None and timestamp >= cursor:
            durations[state] += (timestamp - cursor) / 1_000_000_000
        state = next_state
        cursor = timestamp
    if state is not None and end_ns >= cursor:
        durations[state] += (end_ns - cursor) / 1_000_000_000
    return durations


def _resource_quality(
    records: Sequence[Mapping[str, Any]],
    manifest: Mapping[str, Any],
) -> ResourceQuality:
    snapshots: list[tuple[int, Mapping[str, Any]]] = []
    thermal_changes: list[tuple[int, int]] = []
    temperatures: list[float] = []
    for record in records:
        timestamp = record.get("elapsed_realtime_ns")
        payload = record.get("payload")
        if type(timestamp) is not int or not isinstance(payload, Mapping):
            continue
        if type(payload.get("battery_fraction")) in {int, float}:
            snapshots.append((timestamp, payload))
        thermal = payload.get("thermal_status")
        if type(thermal) is int and thermal >= 0:
            thermal_changes.append((timestamp, thermal))
        temperature = payload.get("battery_temperature_tenths_c")
        if type(temperature) in {int, float} and temperature >= 0:
            temperatures.append(float(temperature) / 10.0)

    snapshots.sort(key=lambda item: item[0])
    battery_start = float(snapshots[0][1]["battery_fraction"]) if snapshots else None
    battery_end = float(snapshots[-1][1]["battery_fraction"]) if snapshots else None
    battery_span_s = (
        (snapshots[-1][0] - snapshots[0][0]) / 1_000_000_000 if len(snapshots) >= 2 else 0.0
    )
    unplugged = bool(snapshots) and all(payload.get("battery_plugged") == 0 for _, payload in snapshots)
    battery_eligible = (
        len(snapshots) >= 2
        and battery_span_s >= 1_800
        and unplugged
        and battery_start is not None
        and battery_end is not None
    )
    battery_rate = (
        (battery_start - battery_end) * 100.0 / (battery_span_s / 3_600.0)
        if battery_eligible and battery_span_s > 0
        else None
    )

    start_ns = manifest.get("started_elapsed_realtime_ns")
    end_ns = manifest.get("ended_elapsed_realtime_ns")
    thermal_durations = _categorical_state_durations(
        thermal_changes,
        start_ns if type(start_ns) is int else 0,
        end_ns if type(end_ns) is int else 0,
    )
    severe_seconds = sum(duration for state, duration in thermal_durations.items() if state >= 3)
    storage_values = [
        int(payload["storage_available_bytes"])
        for _, payload in snapshots
        if type(payload.get("storage_available_bytes")) is int
    ]
    storage_delta = storage_values[-1] - storage_values[0] if len(storage_values) >= 2 else None
    files = manifest.get("files")
    evidence_bytes = (
        sum(
            entry.get("bytes", 0)
            for entry in files
            if isinstance(entry, Mapping) and type(entry.get("bytes")) is int
        )
        if isinstance(files, list)
        else 0
    )
    return ResourceQuality(
        evidence_bytes=evidence_bytes,
        storage_available_delta_bytes=storage_delta,
        battery_start_fraction=battery_start,
        battery_end_fraction=battery_end,
        battery_drain_percentage_points_per_hour=battery_rate,
        battery_guardrail_eligible=battery_eligible,
        max_battery_temperature_c=max(temperatures) if temperatures else None,
        thermal_severe_or_worse_s=severe_seconds,
    )


def _categorical_state_durations(
    changes: Sequence[tuple[int, int]],
    start_ns: int,
    end_ns: int,
) -> dict[int, float]:
    durations: dict[int, float] = {}
    if end_ns <= start_ns:
        return durations
    state: int | None = None
    cursor = start_ns
    for timestamp, next_state in sorted(changes):
        timestamp = min(max(timestamp, start_ns), end_ns)
        if state is not None and timestamp >= cursor:
            durations[state] = durations.get(state, 0.0) + (timestamp - cursor) / 1_000_000_000
        state = next_state
        cursor = timestamp
    if state is not None and end_ns >= cursor:
        durations[state] = durations.get(state, 0.0) + (end_ns - cursor) / 1_000_000_000
    return durations


def _sensor_quality(
    records: Sequence[Mapping[str, Any]],
    session_duration_s: float,
    target_rate_hz: float,
    findings: list[CaptureFinding],
) -> dict[str, SensorQuality]:
    grouped: dict[str, list[Mapping[str, Any]]] = {}
    for record in records:
        grouped.setdefault(str(record.get("sensor_type")), []).append(record)
    result: dict[str, SensorQuality] = {}
    expected_period_s = 1 / max(target_rate_hz, 1.0)
    for sensor_type, sensor_records in grouped.items():
        ordered = sorted(
            sensor_records,
            key=lambda item: item.get("sequence_id", -1)
            if type(item.get("sequence_id")) is int
            else -1,
        )
        timestamps: list[int] = []
        latencies_ms: list[float] = []
        previous = -1
        for record in ordered:
            timestamp = record.get("sensor_timestamp_ns")
            callback = record.get("callback_elapsed_realtime_ns")
            if not isinstance(timestamp, int) or not isinstance(callback, int):
                findings.append(CaptureFinding("critical", "invalid-timestamp-type", sensor_type, "sensor_events"))
                continue
            if timestamp < previous:
                findings.append(CaptureFinding("critical", "timestamp-regression", sensor_type, "sensor_events"))
            elif timestamp == previous:
                findings.append(
                    CaptureFinding("critical", "duplicate-sensor-timestamp", sensor_type, "sensor_events")
                )
            if callback < timestamp:
                findings.append(CaptureFinding("critical", "callback-before-event", sensor_type, "sensor_events"))
            previous = timestamp
            timestamps.append(timestamp)
            latencies_ms.append((callback - timestamp) / 1_000_000)
        intervals_s = [
            (right - left) / 1_000_000_000
            for left, right in zip(timestamps, timestamps[1:])
            if right >= left
        ]
        observed_duration_s = intervals_s and (timestamps[-1] - timestamps[0]) / 1_000_000_000 or 0.0
        realized_rate_hz = (len(timestamps) - 1) / observed_duration_s if observed_duration_s > 0 else 0.0
        excess_gap_s = sum(max(0.0, interval - 2 * expected_period_s) for interval in intervals_s)
        span_coverage = min(observed_duration_s / session_duration_s, 1.0) if session_duration_s > 0 else 0.0
        continuity = max(0.0, 1.0 - excess_gap_s / session_duration_s) if session_duration_s > 0 else 0.0
        density = min(realized_rate_hz / min(target_rate_hz, 50.0), 1.0) if target_rate_hz > 0 else 0.0
        result[sensor_type] = SensorQuality(
            sensor_type=sensor_type,
            samples=len(timestamps),
            duration_s=observed_duration_s,
            realized_rate_hz=realized_rate_hz,
            interval_p50_ms=_quantile(intervals_s, 0.5) * 1000 if intervals_s else 0.0,
            interval_p95_ms=_quantile(intervals_s, 0.95) * 1000 if intervals_s else 0.0,
            callback_latency_p95_ms=_quantile(latencies_ms, 0.95) if latencies_ms else 0.0,
            max_gap_ms=max(intervals_s, default=0.0) * 1000,
            gaps_ge_100ms=sum(interval >= 0.1 for interval in intervals_s),
            gaps_ge_1000ms=sum(interval >= 1.0 for interval in intervals_s),
            effective_coverage=min(span_coverage, continuity, density),
        )
    return result


def _quantile(values: Sequence[float], probability: float) -> float:
    if not values:
        raise ValueError("Cannot calculate quantile of empty values")
    ordered = sorted(values)
    index = probability * (len(ordered) - 1)
    lower = int(math.floor(index))
    upper = int(math.ceil(index))
    if lower == upper:
        return float(ordered[lower])
    weight = index - lower
    return float(ordered[lower] * (1 - weight) + ordered[upper] * weight)
