"""Bounded, row-safe preflight checks for mounted public dataset sequences."""

from __future__ import annotations

import csv
from dataclasses import asdict, dataclass
import json
from pathlib import Path
import statistics
from typing import Any

from .contracts import FieldRole


@dataclass(frozen=True)
class SequenceFinding:
    severity: str
    code: str
    detail: str


@dataclass(frozen=True)
class SequenceAudit:
    dataset: str
    adapter: str
    sequence: str
    row_count: int
    columns: tuple[str, ...]
    start_time_s: float | None
    end_time_s: float | None
    estimated_rate_hz: float | None
    duplicate_timestamp_count: int
    non_monotonic_timestamp_count: int
    null_inference_value_count: int
    findings: tuple[SequenceFinding, ...]

    def to_json(self) -> str:
        return json.dumps(asdict(self), indent=2, ensure_ascii=False)


def load_adapter_specs(path: Path) -> dict[str, dict[str, Any]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    return {adapter["id"]: adapter for adapter in payload["adapters"]}


def adapter_roles_by_dataset(specs: dict[str, dict[str, Any]]) -> dict[str, dict[str, FieldRole]]:
    result: dict[str, dict[str, FieldRole]] = {}
    for spec in specs.values():
        dataset_roles = result.setdefault(spec["dataset"], {})
        for field, metadata in spec["fields"].items():
            role = FieldRole(metadata["role"])
            existing = dataset_roles.get(field)
            if existing is not None and existing is not role:
                raise ValueError(f"Conflicting role for {spec['dataset']}.{field}")
            dataset_roles[field] = role
    return result


def validate_adapter_specs(specs: dict[str, dict[str, Any]]) -> tuple[str, ...]:
    errors: list[str] = []
    for adapter_id, spec in specs.items():
        fields = spec.get("fields", {})
        required = set(spec.get("required_fields", []))
        inference = set(spec.get("inference_fields", []))
        unknown = sorted((required | inference) - set(fields))
        if unknown:
            errors.append(f"{adapter_id}: unknown declared fields {unknown}")
        for field in inference:
            role = FieldRole(fields[field]["role"])
            if role not in {FieldRole.LIVE_INPUT, FieldRole.POST_SESSION_INPUT}:
                errors.append(f"{adapter_id}: inference field {field} has role {role.value}")
            if not fields[field].get("android_api"):
                errors.append(f"{adapter_id}: inference field {field} lacks Android API")
        required_rate = spec.get("product_required_rate_hz", spec.get("source_rate_hz", 0))
        if required_rate is not None and required_rate > 200:
            errors.append(f"{adapter_id}: product-required rate exceeds 200 Hz")
    return tuple(errors)


def audit_csv_sequence(path: Path, spec: dict[str, Any]) -> SequenceAudit:
    timestamp_field = spec["timestamp_field"]
    timestamp_scale = float(spec["timestamp_scale_to_seconds"])
    required_fields = set(spec["required_fields"])
    inference_fields = set(spec["inference_fields"])
    timestamps: list[float] = []
    duplicate_count = 0
    non_monotonic_count = 0
    null_inference_count = 0
    findings: list[SequenceFinding] = []
    row_count = 0

    with path.open(newline="", encoding="utf-8-sig") as stream:
        reader = csv.DictReader(stream)
        columns = tuple(reader.fieldnames or ())
        missing = sorted(required_fields - set(columns))
        if missing:
            findings.append(SequenceFinding("critical", "missing-required-fields", str(missing)))
        if timestamp_field not in columns:
            findings.append(SequenceFinding("critical", "missing-timestamp", timestamp_field))
            return SequenceAudit(
                spec["dataset"], spec["id"], path.stem, 0, columns, None, None,
                None, 0, 0, 0, tuple(findings)
            )
        previous: float | None = None
        seen: set[float] = set()
        for row in reader:
            row_count += 1
            raw_timestamp = row.get(timestamp_field, "").strip()
            if not raw_timestamp:
                findings.append(SequenceFinding("critical", "null-timestamp", f"row {row_count}"))
                continue
            try:
                timestamp = float(raw_timestamp) * timestamp_scale
            except ValueError:
                findings.append(SequenceFinding("critical", "invalid-timestamp", f"row {row_count}"))
                continue
            if timestamp in seen:
                duplicate_count += 1
            seen.add(timestamp)
            if previous is not None and timestamp < previous:
                non_monotonic_count += 1
            previous = timestamp
            timestamps.append(timestamp)
            for field in inference_fields:
                if field in row and not row[field].strip():
                    null_inference_count += 1

    positive_deltas = [right - left for left, right in zip(timestamps, timestamps[1:]) if right > left]
    estimated_rate = None
    if positive_deltas:
        estimated_rate = 1.0 / statistics.median(positive_deltas)
    if duplicate_count:
        findings.append(SequenceFinding("high", "duplicate-timestamps", str(duplicate_count)))
    if non_monotonic_count:
        findings.append(SequenceFinding("critical", "non-monotonic-time", str(non_monotonic_count)))
    if null_inference_count:
        findings.append(SequenceFinding("high", "null-inference-values", str(null_inference_count)))
    if estimated_rate is not None and estimated_rate > 200.5:
        findings.append(SequenceFinding("critical", "rate-above-product-limit", f"{estimated_rate:.3f}"))
    elif estimated_rate is not None and estimated_rate > 100.5:
        findings.append(SequenceFinding("medium", "downsample-required", f"{estimated_rate:.3f}"))

    return SequenceAudit(
        dataset=spec["dataset"],
        adapter=spec["id"],
        sequence=path.stem,
        row_count=row_count,
        columns=columns,
        start_time_s=timestamps[0] if timestamps else None,
        end_time_s=timestamps[-1] if timestamps else None,
        estimated_rate_hz=estimated_rate,
        duplicate_timestamp_count=duplicate_count,
        non_monotonic_timestamp_count=non_monotonic_count,
        null_inference_value_count=null_inference_count,
        findings=tuple(findings),
    )


def audit_hdf_inventory(path: Path, spec: dict[str, Any]) -> SequenceAudit:
    manifest = json.loads(path.read_text(encoding="utf-8"))
    datasets = manifest.get("datasets", {})
    required = set(spec["required_fields"])
    missing = sorted(required - set(datasets))
    findings: list[SequenceFinding] = []
    if missing:
        findings.append(SequenceFinding("critical", "missing-required-fields", str(missing)))
    timestamp = datasets.get(spec["timestamp_field"], {})
    duplicate_count = int(timestamp.get("duplicate_timestamp_count", 0))
    non_monotonic_count = int(timestamp.get("non_monotonic_timestamp_count", 0))
    estimated_rate = timestamp.get("estimated_rate_hz")
    if duplicate_count:
        findings.append(SequenceFinding("high", "duplicate-timestamps", str(duplicate_count)))
    if non_monotonic_count:
        findings.append(SequenceFinding("critical", "non-monotonic-time", str(non_monotonic_count)))
    if estimated_rate is not None and float(estimated_rate) > 100.5:
        findings.append(SequenceFinding("medium", "downsample-required", f"{float(estimated_rate):.3f}"))
    return SequenceAudit(
        dataset=spec["dataset"],
        adapter=spec["id"],
        sequence=manifest.get("sequence", path.stem),
        row_count=int(timestamp.get("shape", [0])[0]),
        columns=tuple(sorted(datasets)),
        start_time_s=timestamp.get("start_time_s"),
        end_time_s=timestamp.get("end_time_s"),
        estimated_rate_hz=float(estimated_rate) if estimated_rate is not None else None,
        duplicate_timestamp_count=duplicate_count,
        non_monotonic_timestamp_count=non_monotonic_count,
        null_inference_value_count=0,
        findings=tuple(findings),
    )
