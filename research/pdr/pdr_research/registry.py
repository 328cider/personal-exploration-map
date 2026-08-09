"""Load the reviewable JSON dataset registry into typed contracts."""

from __future__ import annotations

import json
from pathlib import Path

from .contracts import (
    AndroidFieldMapping,
    CompatibilityDecision,
    DatasetCompatibilityReport,
    DatasetField,
    FieldRole,
)


def load_registry(path: Path) -> tuple[DatasetCompatibilityReport, ...]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    reports: list[DatasetCompatibilityReport] = []
    for item in payload["datasets"]:
        fields: list[DatasetField] = []
        for raw_field in item["fields"]:
            fields.append(
                DatasetField(
                    name=raw_field["name"],
                    availability=raw_field["availability"],
                    notes=raw_field.get("notes", ""),
                    mapping=AndroidFieldMapping(
                        field_name=raw_field["name"],
                        role=FieldRole(raw_field["role"]),
                        android_api=raw_field.get("android_api"),
                        sensor_type=raw_field.get("sensor_type"),
                        unit=raw_field["unit"],
                        axes_or_frame=raw_field["axes_or_frame"],
                        timestamp_basis=raw_field["timestamp_basis"],
                        required_rate_hz=raw_field.get("required_rate_hz"),
                        reproducible_from_android_raw=raw_field[
                            "reproducible_from_android_raw"
                        ],
                        transformation=raw_field.get("transformation", "identity"),
                    ),
                )
            )
        reports.append(
            DatasetCompatibilityReport(
                dataset=item["dataset"],
                source_url=item["source_url"],
                platform=item["platform"],
                fields=tuple(fields),
                split_keys=tuple(item["split_keys"]),
                research_license=item["license"]["research"],
                redistribution_license=item["license"]["redistribution"],
                product_license=item["license"]["product"],
                declared_decision=CompatibilityDecision(item["decision"]),
                decision_reasons=tuple(item["decision_reasons"]),
                content_hash=item.get("content_hash"),
            )
        )
    return tuple(reports)
