"""Strict E0 plumbing gate for Android emulator capture evidence.

The normal capture-quality verdict remains authoritative for physical evidence.
This gate may accept only timing deficiencies attributable to a virtual sensor;
it never converts an unusable bundle into a product-usable session.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any


ALLOWED_VIRTUAL_SENSOR_FINDINGS = frozenset(
    {"continuity-gap", "marginal-imu-coverage", "insufficient-imu-coverage"}
)
MANDATORY_SENSORS = ("TYPE_ACCELEROMETER", "TYPE_GYROSCOPE")


def evaluate_emulator_plumbing(report: Mapping[str, Any]) -> dict[str, Any]:
    """Return an explicit E0 verdict without weakening physical capture gates."""

    failures: list[str] = []
    protocol = report.get("protocol", {})
    lifecycle = report.get("lifecycle_evidence", {})
    sensors = report.get("sensors", {})
    findings = report.get("findings", [])

    expected_protocol = {
        "program_id": "pdr-capture-readiness-v1-template",
        "program_revision": 1,
        "participant_code": "P-EMULATOR",
        "device_pseudonym": "device-emulator",
        "placement": "hand",
        "route_id": "no-walking-emulator",
        "split": "development",
        "lifecycle": "foreground-screen-on",
        "motion_condition": "no-walking",
        "planned_duration_s": 60,
        "capture_mode": "batch-100-250",
        "request_location": False,
        "request_step_sensors": False,
        "hold_wake_lock": True,
    }
    for key, expected in expected_protocol.items():
        if protocol.get(key) != expected:
            failures.append(f"protocol.{key} must be {expected!r}")

    if report.get("schema_version") != "pdr-capture-quality/v1":
        failures.append("schema_version must be pdr-capture-quality/v1")
    if report.get("session_id") != "emulator-e2e":
        failures.append("session_id must be emulator-e2e")
    if report.get("protocol_cell_id") != "e0-api35-batch100-250":
        failures.append("protocol_cell_id must be e0-api35-batch100-250")
    if report.get("integrity_rate") != 1.0:
        failures.append("integrity_rate must be 1.0")
    if report.get("writer_drop_count") != 0:
        failures.append("writer_drop_count must be zero")
    if float(report.get("session_duration_s", 0.0)) < 10.0:
        failures.append("session_duration_s must be at least 10 seconds")
    if lifecycle.get("declared_protocol_satisfied") is not True:
        failures.append("declared lifecycle protocol must be observed")

    unexpected_findings = sorted(
        {
            str(finding.get("code"))
            for finding in findings
            if finding.get("code") not in ALLOWED_VIRTUAL_SENSOR_FINDINGS
        }
    )
    if unexpected_findings:
        failures.append(f"unexpected capture findings: {unexpected_findings}")

    for sensor_type in MANDATORY_SENSORS:
        sensor = sensors.get(sensor_type)
        if not isinstance(sensor, Mapping):
            failures.append(f"missing mandatory sensor: {sensor_type}")
            continue
        if float(sensor.get("duration_s", 0.0)) < 10.0:
            failures.append(f"{sensor_type} duration must be at least 10 seconds")
        if float(sensor.get("realized_rate_hz", 0.0)) < 45.0:
            failures.append(f"{sensor_type} realized rate must be at least 45 Hz")
        if float(sensor.get("interval_p50_ms", float("inf"))) > 25.0:
            failures.append(f"{sensor_type} median interval must be at most 25 ms")
        if int(sensor.get("gaps_ge_1000ms", 1)) != 0:
            failures.append(f"{sensor_type} must have no gap of one second or more")

    ordinary_validator_usable = report.get("usable") is True
    return {
        "schema_version": "pdr-emulator-plumbing-gate/v1",
        "accepted": not failures,
        "product_usable": False,
        "ordinary_validator_usable": ordinary_validator_usable,
        "ordinary_validator_outcome": str(report.get("outcome", "unknown")),
        "counts_toward_capture_kpis": False,
        "physical_sensor_evidence": False,
        "allowed_virtual_sensor_findings": sorted(ALLOWED_VIRTUAL_SENSOR_FINDINGS),
        "failures": failures,
    }
