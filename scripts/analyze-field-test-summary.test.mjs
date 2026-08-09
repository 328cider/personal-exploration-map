import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  analyzeFieldTestBundle,
  parseCoordinateFreeSummary,
} from "./analyze-field-test-summary.mjs";

function baseValues(overrides = {}) {
  return {
    personal_exploration_map_diagnostics_format: 2,
    report_version: 2,
    provider: "gnss-background",
    session_started_at_ms: 1_000,
    session_started_at_iso_utc: "2026-08-09T00:00:00.000Z",
    session_ended_at_ms: 301_000,
    session_ended_at_iso_utc: "2026-08-09T00:05:00.000Z",
    duration_ms: 300_000,
    snapshot_elapsed_duration_ms: 299_500,
    device_manufacturer: "Google",
    device_brand: "google",
    device_model: "Pixel Test",
    device_codename: "pixel-test",
    device_product: "pixel-test",
    android_version: "17",
    android_sdk: 37,
    android_build_id: "TEST",
    build_fingerprint_sha256: "0".repeat(64),
    app_package: "com.cider328.personalexplorationmap.fieldtest",
    app_version_name: "0.1.0",
    app_version_code: 1,
    app_debuggable: true,
    timezone: "Asia/Tokyo",
    timezone_offset_minutes: 540,
    locale: "ja-JP",
    start_snapshot_at_ms: 1_500,
    start_snapshot_at_iso_utc: "2026-08-09T00:00:00.500Z",
    start_elapsed_realtime_ms: 10_000,
    start_battery_percent: 90,
    start_battery_status: "discharging",
    start_battery_plugged: "none",
    start_battery_temperature_c: 30,
    start_battery_voltage_mv: 4_000,
    start_battery_current_ua: -250_000,
    start_battery_charge_counter_uah: 3_000_000,
    start_power_save_mode: false,
    start_battery_optimization_enabled: false,
    start_thermal_status: 0,
    start_fine_location_granted: true,
    start_coarse_location_granted: true,
    start_background_location_granted: true,
    start_notification_granted: true,
    end_snapshot_at_ms: 301_500,
    end_snapshot_at_iso_utc: "2026-08-09T00:05:00.500Z",
    end_elapsed_realtime_ms: 309_500,
    end_battery_percent: 89,
    end_battery_status: "discharging",
    end_battery_plugged: "none",
    end_battery_temperature_c: 31,
    end_battery_voltage_mv: 3_990,
    end_battery_current_ua: -270_000,
    end_battery_charge_counter_uah: 2_995_000,
    end_power_save_mode: false,
    end_battery_optimization_enabled: false,
    end_thermal_status: 0,
    end_fine_location_granted: true,
    end_coarse_location_granted: true,
    end_background_location_granted: true,
    end_notification_granted: true,
    battery_consumed_percentage_points: 1,
    raw_samples: 10,
    accepted_samples: 9,
    rejected_samples: 1,
    acceptance_rate: 0.9,
    rejection_reasons: "low_accuracy:1",
    accuracy_m_count: 10,
    accuracy_m_min: 3,
    accuracy_m_median: 6,
    accuracy_m_p95: 12,
    accuracy_m_max: 15,
    sample_gap_ms_count: 9,
    sample_gap_ms_min: 5_000,
    sample_gap_ms_median: 8_000,
    sample_gap_ms_p95: 12_000,
    sample_gap_ms_max: 15_000,
    sample_gap_at_least_30s: 0,
    sample_gap_at_least_60s: 0,
    sample_gap_at_least_120s: 0,
    callback_received_batches: 10,
    callback_received_samples: 10,
    callback_persisted_batches: 10,
    callback_persisted_samples: 10,
    callback_duplicate_samples: 0,
    callback_accepted_samples: 9,
    callback_rejected_samples: 1,
    callback_failed_batches: 0,
    callback_largest_batch: 1,
    marker_input_ms_count: 1,
    marker_input_ms_min: 3_000,
    marker_input_ms_median: 3_000,
    marker_input_ms_p95: 3_000,
    marker_input_ms_max: 3_000,
    marker_input_completed: 1,
    marker_input_cancelled: 0,
    last_error_kind: "none",
    last_error_message: "none",
    lifecycle_count: 8,
    lifecycle_1_offset_ms: 0,
    lifecycle_1_kind: "provider.start.requested",
    lifecycle_1_detail: "none",
    lifecycle_2_offset_ms: 100,
    lifecycle_2_kind: "provider.started",
    lifecycle_2_detail: "none",
    lifecycle_3_offset_ms: 150,
    lifecycle_3_kind: "environment.session.started",
    lifecycle_3_detail: "none",
    lifecycle_4_offset_ms: 120_000,
    lifecycle_4_kind: "app.state.changed",
    lifecycle_4_detail: "background",
    lifecycle_5_offset_ms: 240_000,
    lifecycle_5_kind: "app.state.changed",
    lifecycle_5_detail: "active",
    lifecycle_6_offset_ms: 299_000,
    lifecycle_6_kind: "provider.stop.requested",
    lifecycle_6_detail: "none",
    lifecycle_7_offset_ms: 299_500,
    lifecycle_7_kind: "provider.stopped",
    lifecycle_7_detail: "none",
    lifecycle_8_offset_ms: 300_000,
    lifecycle_8_kind: "environment.session.ended",
    lifecycle_8_detail: "none",
    ...overrides,
  };
}

function scalar(value) {
  if (value === null) {
    return "null";
  }
  return String(value);
}

function summary(values = baseValues(), extraLines = []) {
  return [
    "Personal Exploration Map / USB field-test diagnostics",
    "privacy=no_coordinates_no_map_names_no_ids_no_marker_text_no_map_images",
    "contains=device_time_battery_permissions_and_aggregate_tracking_metrics",
    "exploration_count=1",
    "",
    "[exploration_1]",
    ...Object.entries(values).map(([key, value]) => `${key}=${scalar(value)}`),
    ...extraLines,
    "",
  ].join("\n");
}

async function sha256(filePath) {
  return createHash("sha256").update(await fs.readFile(filePath)).digest("hex");
}

async function createBundle(root, name, options = {}) {
  const bundle = path.join(root, name);
  await fs.mkdir(path.join(bundle, "app"), { recursive: true });
  const summaryPath = path.join(bundle, "coordinate-free-diagnostics.txt");
  const manifestPath = path.join(bundle, "manifest.json");
  const dataPath = path.join(bundle, "app", "app-private-data.tar");
  await fs.writeFile(
    summaryPath,
    options.summary ?? summary(options.values ?? baseValues(), options.extraLines ?? []),
    "utf8",
  );
  await fs.writeFile(
    manifestPath,
    JSON.stringify({
      formatVersion: 1,
      packageName: "com.cider328.personalexplorationmap.fieldtest",
      containsRawLocation: true,
      autoUpload: false,
      warning: "Raw location stays local.",
      ...(options.manifest ?? {}),
    }),
    "utf8",
  );
  await fs.writeFile(dataPath, options.data ?? "private-test-data", "utf8");
  const entries = [summaryPath, manifestPath, dataPath];
  const checksumLines = [];
  for (const filePath of entries) {
    const relative = path.relative(bundle, filePath).replaceAll(path.sep, "/");
    checksumLines.push(`${await sha256(filePath)}  ${relative}`);
  }
  await fs.writeFile(
    path.join(bundle, "SHA256SUMS.txt"),
    `${checksumLines.join("\n")}\n`,
    "utf8",
  );
  return bundle;
}

async function withTempDirectory(callback) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pem-field-analysis-"));
  try {
    return await callback(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

test("parser keeps metadata and exploration sections separate", () => {
  const parsed = parseCoordinateFreeSummary(summary());
  assert.equal(parsed.metadata.exploration_count, 1);
  assert.equal(parsed.explorations.length, 1);
  assert.equal(parsed.explorations[0].values.device_model, "Pixel Test");
  assert.deepEqual(parsed.duplicateKeys, []);
});

test("valid S0 bundle produces PASS reports", async () => {
  await withTempDirectory(async (root) => {
    const bundle = await createBundle(root, "pem-field-test-20260809T000000Z");
    const result = await analyzeFieldTestBundle(bundle, {
      generatedAt: "2026-08-09T00:10:00.000Z",
    });
    assert.equal(result.report.status, "PASS");
    assert.equal(result.report.integrity.valid, true);
    assert.equal(result.report.subjectiveReviewRequired, true);
    assert.equal(result.report.productDecisionAutomated, false);
    assert.equal(result.report.findings.length, 0);
    assert.match(await fs.readFile(result.markdownPath, "utf8"), /Objective status: \*\*PASS\*\*/);
  });
});

test("latest bundle is selected from a device-bundles directory", async () => {
  await withTempDirectory(async (root) => {
    await createBundle(root, "pem-field-test-20260809T000000Z");
    await createBundle(root, "pem-field-test-20260809T010000Z");
    const result = await analyzeFieldTestBundle(root, {
      generatedAt: "2026-08-09T01:10:00.000Z",
    });
    assert.equal(result.report.bundleName, "pem-field-test-20260809T010000Z");
    assert.equal(result.report.status, "PASS");
  });
});

test("power and gap concerns produce WARN without pretending to fail product value", async () => {
  await withTempDirectory(async (root) => {
    const bundle = await createBundle(root, "pem-field-test-20260809T020000Z", {
      values: baseValues({
        sample_gap_at_least_30s: 1,
        start_power_save_mode: true,
        start_battery_optimization_enabled: true,
      }),
    });
    const result = await analyzeFieldTestBundle(bundle);
    assert.equal(result.report.status, "WARN");
    assert.ok(result.report.findings.some((item) => item.code === "sample_gap_30s"));
    assert.ok(result.report.findings.some((item) => item.code === "power_save_enabled"));
    assert.equal(result.report.productDecisionAutomated, false);
  });
});

test("blocking S0 conditions produce FAIL and no-rewalk next action", async () => {
  await withTempDirectory(async (root) => {
    const bundle = await createBundle(root, "pem-field-test-20260809T030000Z", {
      values: baseValues({
        raw_samples: 0,
        accepted_samples: 0,
        sample_gap_at_least_120s: 1,
        marker_input_completed: 0,
        callback_failed_batches: 1,
        last_error_kind: "callback.persistence.failed",
        last_error_message: "database unavailable",
      }),
    });
    const result = await analyzeFieldTestBundle(bundle);
    assert.equal(result.report.status, "FAIL");
    assert.match(result.report.nextAction, /再度歩かず/);
    const codes = new Set(result.report.findings.map((item) => item.code));
    assert.ok(codes.has("no_raw_samples"));
    assert.ok(codes.has("sample_gap_120s"));
    assert.ok(codes.has("marker_not_completed"));
    assert.ok(codes.has("operational_error"));
  });
});

test("checksum mismatch is a hard failure", async () => {
  await withTempDirectory(async (root) => {
    const bundle = await createBundle(root, "pem-field-test-20260809T040000Z");
    await fs.appendFile(path.join(bundle, "coordinate-free-diagnostics.txt"), "tampered=true\n");
    const result = await analyzeFieldTestBundle(bundle);
    assert.equal(result.report.status, "FAIL");
    assert.ok(result.report.findings.some((item) => item.code === "checksum_mismatch"));
  });
});

test("coordinate-bearing keys are rejected from the coordinate-free report", async () => {
  await withTempDirectory(async (root) => {
    const bundle = await createBundle(root, "pem-field-test-20260809T050000Z", {
      extraLines: ["latitude=35.0"],
    });
    const result = await analyzeFieldTestBundle(bundle);
    assert.equal(result.report.status, "FAIL");
    assert.ok(result.report.findings.some((item) => item.code === "coordinate_key_present"));
  });
});

test("manifest cannot enable upload or hide raw-location presence", async () => {
  await withTempDirectory(async (root) => {
    const bundle = await createBundle(root, "pem-field-test-20260809T060000Z", {
      manifest: { autoUpload: true, containsRawLocation: false },
    });
    const result = await analyzeFieldTestBundle(bundle);
    assert.equal(result.report.status, "FAIL");
    const codes = new Set(result.report.findings.map((item) => item.code));
    assert.ok(codes.has("automatic_upload_not_disabled"));
    assert.ok(codes.has("raw_location_warning_missing"));
  });
});
