from __future__ import annotations

import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from pdr_research.capture_quality import (  # noqa: E402
    aggregate_capture_program,
    load_field_contract,
    load_capture_program_plan,
    validate_capture_attempts,
    validate_capture_bundle,
)
from pdr_research.emulator_gate import evaluate_emulator_plumbing  # noqa: E402


CONTRACT = ROOT / "capture-schema" / "v1" / "field-contract.json"
PROGRAM_TEMPLATE = ROOT / "capture-schema" / "v1" / "capture-program.template.json"
TRUTH_CONTRACT = ROOT / "capture-schema" / "v1" / "truth-sidecar-contract.json"
SENSOR_LAYOUTS = ROOT / "capture-schema" / "v1" / "sensor-value-layouts.json"
ANDROID_CAPTURE = ROOT / "android-capture"


def _json_line(value: object) -> bytes:
    return (json.dumps(value, separators=(",", ":"), sort_keys=True) + "\n").encode()


def _make_bundle(
    root: Path,
    *,
    gap: bool = False,
    leak: bool = False,
    duration_s: int = 10,
    protocol_override: dict[str, object] | None = None,
    capture_config_override: dict[str, object] | None = None,
) -> Path:
    session_id = "capture-test-session"
    bundle = root / "capture-test-session.complete"
    bundle.mkdir()
    start_ns = 1_000_000_000
    target_rate_hz = 50
    sample_count = duration_s * target_rate_hz + 1
    streams: dict[str, tuple[str, bytes, int]] = {}

    protocol = {
        "program_id": "pdr-capture-readiness-v1-template",
        "program_revision": 1,
        "cell_id": "device-a__front-pocket__screen-on",
        "participant_code": "P-TEST",
        "device_pseudonym": "device-a",
        "placement": "front-right",
        "route_id": "route-test",
        "split": "development",
        "lifecycle": "foreground-screen-on",
        "motion_condition": "no-walking",
        "planned_duration_s": 60,
    }
    protocol.update(protocol_override or {})
    capture_config = {
        "mode": "live-50",
        "target_rate_hz": target_rate_hz,
        "sampling_period_us": 20_000,
        "max_report_latency_us": 0,
        "step_sensors_requested": False,
        "location_requested": False,
        "wake_lock_requested": True,
    }
    capture_config.update(capture_config_override or {})
    start = {
        "schema_version": "pdr-capture/v1",
        "session_id": session_id,
        "status": "recording",
        "protocol": protocol,
        "capture_config": {**capture_config, "location_enabled_actual": False},
        "app": {"research_revision": "capture-test-revision"},
    }
    streams["session_start.json"] = ("session_start", json.dumps(start, sort_keys=True).encode(), 1)

    capability_lines = []
    for sensor_type, sensor_type_id in (("TYPE_ACCELEROMETER", 1), ("TYPE_GYROSCOPE", 4)):
        capability_lines.append(
            _json_line(
                {
                    "schema_version": "pdr-capture/v1",
                    "record_type": "capability",
                    "session_id": session_id,
                    "sensor_type": sensor_type,
                    "sensor_type_id": sensor_type_id,
                    "name": sensor_type,
                    "vendor": "fixture",
                    "version": 1,
                    "resolution": 0.001,
                    "maximum_range": 20.0,
                    "power_ma": 0.1,
                    "min_delay_us": 5000,
                    "max_delay_us": 1000000,
                    "fifo_reserved_event_count": 0,
                    "fifo_max_event_count": 100,
                    "is_wake_up": False,
                    "reporting_mode": "continuous",
                }
            )
        )
    streams["capabilities-00000.jsonl"] = ("capabilities", b"".join(capability_lines), 2)

    sensor_lines = []
    sequence = 0
    for sample_index in range(sample_count):
        timestamp = start_ns + sample_index * 20_000_000
        if gap and sample_index >= 250:
            timestamp += 1_200_000_000
        for sensor_type in ("TYPE_ACCELEROMETER", "TYPE_GYROSCOPE"):
            record = {
                "schema_version": "pdr-capture/v1",
                "record_type": "sensor_event",
                "session_id": session_id,
                "sequence_id": sequence,
                "sensor_type": sensor_type,
                "sensor_timestamp_ns": timestamp,
                "callback_elapsed_realtime_ns": timestamp + 2_000_000,
                "accuracy": 3,
                "values": [0.0, 0.0, 9.81 if sensor_type == "TYPE_ACCELEROMETER" else 0.0],
                "value_count": 3,
            }
            if leak and sample_index == 0 and sensor_type == "TYPE_ACCELEROMETER":
                record["true_heading"] = 1.0
            sensor_lines.append(_json_line(record))
            sequence += 1
    streams["sensor_events-00000.jsonl"] = (
        "sensor_events",
        b"".join(sensor_lines),
        len(sensor_lines),
    )

    diagnostic_specs = [
        ("capability_probe", {"supports_imu6": True}),
        ("storage_preflight", {"available_bytes": 1_000_000_000}),
        (
            "sensor_registration",
            {
                "sensor_type": "TYPE_ACCELEROMETER",
                "registered": True,
                "name": "TYPE_ACCELEROMETER",
                "vendor": "fixture",
                "sampling_period_us": 20_000,
                "max_report_latency_us": 0,
            },
        ),
        (
            "sensor_registration",
            {
                "sensor_type": "TYPE_GYROSCOPE",
                "registered": True,
                "name": "TYPE_GYROSCOPE",
                "vendor": "fixture",
                "sampling_period_us": 20_000,
                "max_report_latency_us": 0,
            },
        ),
        (
            "capture_started",
            {
                "screen_interactive": True,
                "battery_fraction": 0.80,
                "battery_plugged": 0,
                "battery_temperature_tenths_c": 300,
                "thermal_status": 0,
                "storage_available_bytes": 900_000_000,
            },
        ),
        ("capture_stopping", {"reason": "fixture"}),
        (
            "final_resource_snapshot",
            {
                "screen_interactive": True,
                "battery_fraction": 0.79,
                "battery_plugged": 0,
                "battery_temperature_tenths_c": 310,
                "thermal_status": 0,
                "storage_available_bytes": 899_000_000,
            },
        ),
        (
            "sensor_flush_requested",
            {
                "accepted": True,
                "expected_sensor_types": ["TYPE_ACCELEROMETER", "TYPE_GYROSCOPE"],
            },
        ),
        ("sensor_flush_completed", {"sensor_type": "TYPE_ACCELEROMETER"}),
        ("sensor_flush_completed", {"sensor_type": "TYPE_GYROSCOPE"}),
    ]
    diagnostic_lines = []
    for sequence_id, (event, payload) in enumerate(diagnostic_specs):
        diagnostic_lines.append(
            _json_line(
                {
                    "schema_version": "pdr-capture/v1",
                    "record_type": "diagnostic_event",
                    "session_id": session_id,
                    "sequence_id": sequence_id,
                    "elapsed_realtime_ns": start_ns + sequence_id * duration_s * 100_000_000,
                    "event": event,
                    "payload": payload,
                }
            )
        )
    streams["diagnostic_events-00000.jsonl"] = (
        "diagnostic_events",
        b"".join(diagnostic_lines),
        len(diagnostic_lines),
    )

    files = []
    for name, (stream, content, records) in streams.items():
        (bundle / name).write_bytes(content)
        files.append(
            {
                "path": name,
                "stream": stream,
                "bytes": len(content),
                "records": records,
                "sha256": hashlib.sha256(content).hexdigest(),
            }
        )
    manifest = {
        "schema_version": "pdr-capture/v1",
        "session_id": session_id,
        "status": "complete",
        "started_elapsed_realtime_ns": start_ns,
        "ended_elapsed_realtime_ns": start_ns + duration_s * 1_000_000_000 + 10_000_000,
        "protocol": protocol,
        "capture_config": capture_config,
        "writer": {"dropped_records": 0, "fatal_error": None},
        "files": files,
    }
    (bundle / "session_manifest.json").write_text(json.dumps(manifest, sort_keys=True), encoding="utf-8")
    (bundle / "COMPLETED").write_bytes(b"")
    return bundle


def _rewrite_jsonl(bundle: Path, name: str, mutate: object) -> None:
    path = bundle / name
    records = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]
    mutate(records)
    content = b"".join(_json_line(record) for record in records)
    path.write_bytes(content)
    manifest_path = bundle / "session_manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    entry = next(item for item in manifest["files"] if item["path"] == name)
    entry["records"] = len(records)
    entry["bytes"] = len(content)
    entry["sha256"] = hashlib.sha256(content).hexdigest()
    manifest_path.write_text(json.dumps(manifest, sort_keys=True), encoding="utf-8")


class CaptureQualityTests(unittest.TestCase):
    def test_every_inference_field_names_an_android_api(self) -> None:
        contract = load_field_contract(CONTRACT)
        inference_fields = [
            field
            for stream in contract["streams"].values()
            for field in stream["fields"].values()
            if field["role"] in {"live-input", "post-session-input"}
        ]
        self.assertGreater(len(inference_fields), 10)
        self.assertTrue(all(field["android_api"] for field in inference_fields))

    def test_complete_bundle_is_usable_from_directory_and_zip(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            bundle = _make_bundle(Path(directory))
            report = validate_capture_bundle(bundle, contract_path=CONTRACT)
            self.assertEqual(report.outcome, "usable", report.findings)
            self.assertGreaterEqual(report.mandatory_imu_coverage, 0.98)
            self.assertGreater(report.resources.evidence_bytes, 0)
            self.assertEqual(report.resources.storage_available_delta_bytes, -1_000_000)
            self.assertEqual(report.resources.max_battery_temperature_c, 31.0)
            self.assertFalse(report.resources.battery_guardrail_eligible)
            archive = Path(directory) / "capture.zip"
            with zipfile.ZipFile(archive, "w") as output:
                for path in bundle.iterdir():
                    output.write(path, f"export/{path.name}")
            zipped = validate_capture_bundle(archive, contract_path=CONTRACT)
            self.assertEqual(zipped.to_dict(), report.to_dict())
            attempts = validate_capture_attempts(Path(directory), contract_path=CONTRACT)
            self.assertEqual(len(attempts), 1, "an exported copy must not double-count one session")

    def test_hash_tampering_is_invalid(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            bundle = _make_bundle(Path(directory))
            with (bundle / "sensor_events-00000.jsonl").open("ab") as output:
                output.write(b"{}\n")
            report = validate_capture_bundle(bundle, contract_path=CONTRACT)
            self.assertEqual(report.outcome, "invalid")
            self.assertIn("hash-mismatch", {finding.code for finding in report.findings})

    def test_truth_like_field_is_rejected_before_estimator_replay(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            bundle = _make_bundle(Path(directory), leak=True)
            report = validate_capture_bundle(bundle, contract_path=CONTRACT)
            codes = {finding.code for finding in report.findings}
            self.assertIn("unknown-fields", codes)
            self.assertIn("truth-leakage", codes)
            self.assertEqual(report.outcome, "invalid")

    def test_rehashed_duplicate_sensor_timestamp_is_still_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            bundle = _make_bundle(Path(directory))

            def duplicate_timestamp(records: list[dict[str, object]]) -> None:
                records[2]["sensor_timestamp_ns"] = records[0]["sensor_timestamp_ns"]

            _rewrite_jsonl(bundle, "sensor_events-00000.jsonl", duplicate_timestamp)
            report = validate_capture_bundle(bundle, contract_path=CONTRACT)
            self.assertIn("duplicate-sensor-timestamp", {finding.code for finding in report.findings})
            self.assertEqual(report.outcome, "invalid")

    def test_rehashed_sequence_gap_and_wrong_type_are_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            bundle = _make_bundle(Path(directory))

            def corrupt(records: list[dict[str, object]]) -> None:
                records[1]["sequence_id"] = 99_999
                records[1]["accuracy"] = "HIGH"

            _rewrite_jsonl(bundle, "sensor_events-00000.jsonl", corrupt)
            report = validate_capture_bundle(bundle, contract_path=CONTRACT)
            codes = {finding.code for finding in report.findings}
            self.assertIn("sequence-gap", codes)
            self.assertIn("field-type-mismatch", codes)
            self.assertEqual(report.outcome, "invalid")

    def test_one_second_gap_is_a_catastrophic_capture_failure(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            bundle = _make_bundle(Path(directory), gap=True)
            report = validate_capture_bundle(bundle, contract_path=CONTRACT)
            self.assertIn("catastrophic-gap", {finding.code for finding in report.findings})
            self.assertEqual(report.outcome, "invalid")

    def test_program_kpis_require_usable_evidence_in_every_planned_cell(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            report = validate_capture_bundle(_make_bundle(Path(directory)), contract_path=CONTRACT)
            kpis = aggregate_capture_program(
                [report],
                planned_cell_ids={"device-a__front-pocket__screen-on"},
            )
            self.assertEqual(kpis.capture_usability_rate, 1.0)
            self.assertEqual(kpis.evidence_readiness_rate, 1.0)
            self.assertEqual(kpis.outcome, "capture-ready")

    def test_program_template_is_machine_checked_and_not_collection_authorization(self) -> None:
        raw = json.loads(PROGRAM_TEMPLATE.read_text(encoding="utf-8"))
        self.assertEqual(raw["authorization"], "desk-template-not-authorized-for-personal-collection")
        cells = load_capture_program_plan(PROGRAM_TEMPLATE)
        self.assertEqual({cell.stage for cell in cells}, {"E0", "C0", "C1"})
        with tempfile.TemporaryDirectory() as directory:
            report = validate_capture_bundle(_make_bundle(Path(directory)), contract_path=CONTRACT)
            # The synthetic fixture uses a different cell, so readiness is correctly zero.
            kpis = aggregate_capture_program([report], plan_cells=cells)
            self.assertEqual(kpis.evidence_readiness_rate, 0.0)

    def test_entity_split_leakage_is_rejected_in_program_plan(self) -> None:
        raw = json.loads(PROGRAM_TEMPLATE.read_text(encoding="utf-8"))
        raw["cells"][0]["split"] = "sealed-validation"
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "bad-plan.json"
            path.write_text(json.dumps(raw), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "split leakage"):
                load_capture_program_plan(path)

    def test_cell_id_cannot_relabel_a_different_device_or_placement(self) -> None:
        cells = load_capture_program_plan(PROGRAM_TEMPLATE)
        e0 = next(cell for cell in cells if cell.cell_id == "e0-api35-live50")
        matching_protocol = {
            "cell_id": e0.cell_id,
            "participant_code": e0.participant_code,
            "device_pseudonym": e0.device_pseudonym,
            "placement": e0.placement,
            "route_id": e0.route_id,
            "split": e0.split,
            "lifecycle": e0.lifecycle,
            "motion_condition": e0.motion_condition,
            "planned_duration_s": e0.planned_duration_s,
        }
        with tempfile.TemporaryDirectory() as directory:
            matching = validate_capture_bundle(
                _make_bundle(Path(directory), protocol_override=matching_protocol, duration_s=60),
                contract_path=CONTRACT,
            )
            self.assertEqual(matching.outcome, "usable", matching.findings)
            matched = aggregate_capture_program([matching], plan_cells=cells)
            self.assertEqual(matched.plan_contract_violations, 0)
            self.assertEqual(matched.ready_cells, 1)

        matching_protocol["placement"] = "bag"
        with tempfile.TemporaryDirectory() as directory:
            relabeled = validate_capture_bundle(
                _make_bundle(Path(directory), protocol_override=matching_protocol),
                contract_path=CONTRACT,
            )
            result = aggregate_capture_program([relabeled], plan_cells=cells)
            self.assertEqual(result.plan_contract_violations, 1)
            self.assertEqual(result.ready_cells, 0)
            self.assertEqual(result.outcome, "stop-or-redesign")

    def test_declared_screen_off_requires_observed_screen_off_evidence(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            bundle = _make_bundle(
                Path(directory),
                protocol_override={"lifecycle": "foreground-service-screen-off"},
            )
            report = validate_capture_bundle(bundle, contract_path=CONTRACT)
            self.assertEqual(report.outcome, "diagnostic-only")
            self.assertIn("declared-lifecycle-not-observed", {finding.code for finding in report.findings})

    def test_interrupted_partial_attempt_stays_in_usability_denominator(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            partial = Path(directory) / "interrupted.partial"
            partial.mkdir()
            (partial / "session_start.json").write_text(
                json.dumps(
                    {
                        "schema_version": "pdr-capture/v1",
                        "session_id": "interrupted",
                        "protocol": {"cell_id": "cell-interrupted"},
                    }
                ),
                encoding="utf-8",
            )
            reports = validate_capture_attempts(Path(directory), contract_path=CONTRACT)
            self.assertEqual(len(reports), 1)
            self.assertEqual(reports[0].outcome, "invalid")
            kpis = aggregate_capture_program(reports, planned_cell_ids={"cell-interrupted"})
            self.assertEqual(kpis.capture_usability_rate, 0.0)
            self.assertEqual(kpis.outcome, "stop-or-redesign")
            archive = Path(directory) / "interrupted.zip"
            with zipfile.ZipFile(archive, "w") as output:
                output.write(partial / "session_start.json", "interrupted.partial/session_start.json")
            exported = validate_capture_bundle(archive, contract_path=CONTRACT)
            self.assertEqual(exported.session_id, "interrupted")
            self.assertEqual(exported.outcome, "invalid")
            self.assertEqual(
                len(validate_capture_attempts(Path(directory), contract_path=CONTRACT)),
                1,
                "partial directory plus its ZIP export remains one start attempt",
            )

    def test_truth_sidecar_can_never_be_a_live_input_or_capture_bundle_stream(self) -> None:
        contract = json.loads(TRUTH_CONTRACT.read_text(encoding="utf-8"))
        self.assertFalse(contract["allowed_in_capture_bundle"])
        roles = {field["role"] for field in contract["fields"].values()}
        self.assertTrue(roles <= {"training-label", "evaluation-only"})

    def test_every_requested_sensor_has_an_explicit_value_layout(self) -> None:
        layouts = json.loads(SENSOR_LAYOUTS.read_text(encoding="utf-8"))["sensors"]
        expected = {
            "TYPE_ACCELEROMETER",
            "TYPE_GYROSCOPE",
            "TYPE_ACCELEROMETER_UNCALIBRATED",
            "TYPE_GYROSCOPE_UNCALIBRATED",
            "TYPE_MAGNETIC_FIELD",
            "TYPE_MAGNETIC_FIELD_UNCALIBRATED",
            "TYPE_ROTATION_VECTOR",
            "TYPE_GAME_ROTATION_VECTOR",
            "TYPE_GRAVITY",
            "TYPE_LINEAR_ACCELERATION",
            "TYPE_STEP_DETECTOR",
            "TYPE_STEP_COUNTER",
            "TYPE_PRESSURE",
        }
        self.assertEqual(set(layouts), expected)
        self.assertEqual({name for name, spec in layouts.items() if spec["required"]}, {"TYPE_ACCELEROMETER", "TYPE_GYROSCOPE"})
        for spec in layouts.values():
            self.assertEqual(len(spec["values"]), spec["max_values"])
            self.assertLessEqual(spec["min_values"], spec["max_values"])

    def test_rotation_vector_layout_matches_supported_android_api_contract(self) -> None:
        layouts = json.loads(SENSOR_LAYOUTS.read_text(encoding="utf-8"))["sensors"]
        rotation = layouts["TYPE_ROTATION_VECTOR"]
        game_rotation = layouts["TYPE_GAME_ROTATION_VECTOR"]
        # The capture app has minSdk 28. Android exposes x/y/z/w plus heading
        # accuracy for TYPE_ROTATION_VECTOR, and x/y/z/w for the game variant.
        self.assertEqual((rotation["min_values"], rotation["max_values"]), (5, 5))
        self.assertEqual((game_rotation["min_values"], game_rotation["max_values"]), (4, 4))

    def test_capture_apk_has_no_network_or_high_rate_sensor_permission(self) -> None:
        manifest = (ANDROID_CAPTURE / "app" / "src" / "main" / "AndroidManifest.xml").read_text(
            encoding="utf-8"
        )
        self.assertNotIn("android.permission.INTERNET", manifest)
        self.assertNotIn("android.permission.HIGH_SAMPLING_RATE_SENSORS", manifest)
        self.assertIn("android.permission.FOREGROUND_SERVICE", manifest)
        self.assertIn("android.permission.WAKE_LOCK", manifest)

    def test_capture_adapter_does_not_import_product_mapping_layers(self) -> None:
        kotlin_root = ANDROID_CAPTURE / "app" / "src" / "main" / "java"
        source = "\n".join(path.read_text(encoding="utf-8") for path in kotlin_root.rglob("*.kt"))
        forbidden = ("mapping-core", "mapping-engine", "TrackingProvider", "PersonalMap")
        for token in forbidden:
            self.assertNotIn(token, source)

    def test_emulator_evidence_extraction_uses_manifest_inventory(self) -> None:
        script = (ANDROID_CAPTURE / "scripts" / "run-emulator-e2e.sh").read_text(encoding="utf-8")
        self.assertIn('manifest["files"]', script)
        self.assertIn("unsafe or duplicate manifest evidence path", script)
        self.assertNotIn("ls files/pdr-captures", script)
        self.assertIn("validate_emulator_capture.py", script)

    def test_emulator_gate_exercises_install_lifecycle_export_and_relaunch(self) -> None:
        script = (ANDROID_CAPTURE / "scripts" / "run-emulator-e2e.sh").read_text(encoding="utf-8")
        required_steps = (
            'adb uninstall "$package"',
            'adb install --no-streaming "$app_apk"',
            'adb shell am start -W -n "$package/.MainActivity"',
            'adb shell pm revoke "$package" android.permission.ACCESS_FINE_LOCATION',
            'adb shell am force-stop "$package"',
            'cache/emulator-e2e.zip',
            'adb logcat -b crash',
            'pdr-emulator-device-readiness/v1',
        )
        for step in required_steps:
            self.assertIn(step, script)
        self.assertIn('"product_usable": False', script)
        self.assertIn('"counts_toward_capture_kpis": False', script)

    def test_capture_ui_defaults_to_stationary_c0_not_walking_c1(self) -> None:
        activity = (
            ANDROID_CAPTURE
            / "app"
            / "src"
            / "main"
            / "java"
            / "com"
            / "personalexplorationmap"
            / "pdrcapture"
            / "MainActivity.kt"
        ).read_text(encoding="utf-8")
        self.assertIn('"c0-screen-on-live50"', activity)
        self.assertIn('"stationary-device-probe"', activity)
        self.assertNotIn('textField(content, "Frozen protocol cell ID", "c1-', activity)
        self.assertIn("Start blocked: required IMU6 capability is unavailable", activity)
        self.assertIn("requiredStorageHeadroomBytes", activity)

    def test_emulator_plumbing_gate_does_not_promote_virtual_timing_to_usable(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            quality = validate_capture_bundle(
                _make_bundle(Path(temporary)), contract_path=CONTRACT
            ).to_dict()
        quality.update(
            {
                "session_id": "emulator-e2e",
                "protocol_cell_id": "e0-api35-batch100-250",
                "outcome": "invalid",
                "usable": False,
                "findings": [
                    {
                        "severity": "high",
                        "code": "continuity-gap",
                        "message": "virtual sensor scheduling",
                        "stream": "sensor_events",
                        "line": None,
                    },
                    {
                        "severity": "critical",
                        "code": "insufficient-imu-coverage",
                        "message": "virtual sensor scheduling",
                        "stream": None,
                        "line": None,
                    },
                ],
            }
        )
        quality["protocol"].update(
            {
                "participant_code": "P-EMULATOR",
                "device_pseudonym": "device-emulator",
                "placement": "hand",
                "route_id": "no-walking-emulator",
                "capture_mode": "batch-100-250",
                "request_location": False,
                "request_step_sensors": False,
            }
        )

        gate = evaluate_emulator_plumbing(quality)
        self.assertTrue(gate["accepted"])
        self.assertFalse(gate["product_usable"])
        self.assertFalse(gate["counts_toward_capture_kpis"])
        self.assertFalse(gate["physical_sensor_evidence"])
        self.assertIn("marginal-imu-coverage", gate["allowed_virtual_sensor_findings"])

        quality["findings"][1]["code"] = "marginal-imu-coverage"
        marginal_gate = evaluate_emulator_plumbing(quality)
        self.assertTrue(marginal_gate["accepted"])
        self.assertFalse(marginal_gate["product_usable"])

        quality["usable"] = True
        quality["outcome"] = "usable"
        quality["findings"] = []
        ordinary_pass_gate = evaluate_emulator_plumbing(quality)
        self.assertTrue(ordinary_pass_gate["accepted"])
        self.assertFalse(ordinary_pass_gate["product_usable"])
        self.assertTrue(ordinary_pass_gate["ordinary_validator_usable"])
        self.assertEqual(ordinary_pass_gate["ordinary_validator_outcome"], "usable")

    def test_emulator_plumbing_gate_rejects_non_timing_failure_and_long_gap(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            quality = validate_capture_bundle(
                _make_bundle(Path(temporary)), contract_path=CONTRACT
            ).to_dict()
        quality.update(
            {
                "session_id": "emulator-e2e",
                "protocol_cell_id": "e0-api35-batch100-250",
                "findings": [
                    {
                        "severity": "critical",
                        "code": "truth-leakage",
                        "message": "must never be tolerated",
                        "stream": "sensor_events",
                        "line": 1,
                    }
                ],
            }
        )
        quality["protocol"].update(
            {
                "participant_code": "P-EMULATOR",
                "device_pseudonym": "device-emulator",
                "placement": "hand",
                "route_id": "no-walking-emulator",
                "capture_mode": "batch-100-250",
                "request_location": False,
                "request_step_sensors": False,
            }
        )
        quality["sensors"]["TYPE_GYROSCOPE"]["gaps_ge_1000ms"] = 1

        gate = evaluate_emulator_plumbing(quality)
        self.assertFalse(gate["accepted"])
        self.assertTrue(any("truth-leakage" in failure for failure in gate["failures"]))
        self.assertTrue(any("one second" in failure for failure in gate["failures"]))


if __name__ == "__main__":
    unittest.main()
