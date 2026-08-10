import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { analyzeFieldTestEvidence } from "./analyze-field-test-evidence.mjs";

function values(overrides = {}) {
  return {
    personal_exploration_map_diagnostics_format: 3,
    report_version: 3,
    provider: "gnss-background",
    session_started_at_ms: 1_000,
    session_started_at_iso_utc: "2026-08-10T00:00:01.000Z",
    session_ended_at_ms: 3_967_618,
    session_ended_at_iso_utc: "2026-08-10T01:06:07.618Z",
    duration_ms: 3_966_618,
    snapshot_elapsed_duration_ms: 3_966_437,
    device_manufacturer: "Google",
    device_model: "Pixel Test",
    android_version: "17",
    android_sdk: 37,
    app_package: "com.cider328.personalexplorationmap.fieldtest",
    app_version_name: "0.1.0",
    app_version_code: 1,
    app_debuggable: true,
    timezone: "Asia/Tokyo",
    locale: "ja-JP",
    start_elapsed_realtime_ms: 10_000,
    end_elapsed_realtime_ms: 3_976_437,
    start_battery_percent: 93,
    end_battery_percent: 78,
    battery_consumed_percentage_points: 15,
    start_battery_status: "discharging",
    end_battery_status: "discharging",
    start_battery_plugged: "none",
    end_battery_plugged: "none",
    start_battery_temperature_c: 35.3,
    end_battery_temperature_c: 36.3,
    start_power_save_mode: false,
    end_power_save_mode: false,
    start_battery_optimization_enabled: true,
    end_battery_optimization_enabled: true,
    start_thermal_status: 0,
    end_thermal_status: 0,
    start_fine_location_granted: true,
    end_fine_location_granted: true,
    start_background_location_granted: true,
    end_background_location_granted: true,
    start_notification_granted: true,
    end_notification_granted: true,
    raw_samples: 662,
    accepted_samples: 650,
    rejected_samples: 12,
    acceptance_rate: 650 / 662,
    rejection_reasons: "timestamp-not-increasing:1,accuracy-too-low:11",
    accuracy_m_count: 662,
    accuracy_m_min: 3.5,
    accuracy_m_median: 8.2,
    accuracy_m_p95: 70.9,
    accuracy_m_max: 292.7,
    sample_gap_ms_count: 661,
    sample_gap_ms_min: 23,
    sample_gap_ms_median: 5_036,
    sample_gap_ms_p95: 8_590,
    sample_gap_ms_max: 27_774,
    sample_gap_at_least_30s: 0,
    sample_gap_at_least_60s: 0,
    sample_gap_at_least_120s: 0,
    sample_before_start_count: 1,
    sample_before_start_max_ms: 12_423,
    sample_after_end_count: 0,
    sample_after_end_max_ms: null,
    callback_received_batches: 264,
    callback_received_samples: 662,
    callback_persisted_batches: 264,
    callback_persisted_samples: 662,
    callback_duplicate_samples: 0,
    callback_accepted_samples: 650,
    callback_rejected_samples: 12,
    callback_failed_batches: 0,
    callback_largest_batch: 107,
    callback_gap_ms_count: 263,
    callback_gap_ms_min: 1,
    callback_gap_ms_median: 5_087,
    callback_gap_ms_p95: 27_772,
    callback_gap_ms_max: 759_725,
    callback_gap_at_least_30s: 12,
    callback_gap_at_least_60s: 4,
    callback_gap_at_least_120s: 2,
    callback_oldest_observation_age_ms_count: 264,
    callback_oldest_observation_age_ms_min: 33,
    callback_oldest_observation_age_ms_median: 183,
    callback_oldest_observation_age_ms_p95: 20_301,
    callback_oldest_observation_age_ms_max: 753_019,
    callback_newest_observation_age_ms_count: 264,
    callback_newest_observation_age_ms_min: 33,
    callback_newest_observation_age_ms_median: 160,
    callback_newest_observation_age_ms_p95: 2_452,
    callback_newest_observation_age_ms_max: 19_381,
    callback_future_observation_batches: 0,
    callback_missing_observation_timestamp_batches: 0,
    marker_input_ms_count: 5,
    marker_input_ms_min: 11_882,
    marker_input_ms_median: 15_463,
    marker_input_ms_p95: 20_723,
    marker_input_ms_max: 20_723,
    marker_input_completed: 5,
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
    lifecycle_4_offset_ms: 60_000,
    lifecycle_4_kind: "app.state.changed",
    lifecycle_4_detail: "background",
    lifecycle_5_offset_ms: 3_000_000,
    lifecycle_5_kind: "app.state.changed",
    lifecycle_5_detail: "active",
    lifecycle_6_offset_ms: 3_966_000,
    lifecycle_6_kind: "provider.stop.requested",
    lifecycle_6_detail: "none",
    lifecycle_7_offset_ms: 3_966_100,
    lifecycle_7_kind: "provider.stopped",
    lifecycle_7_detail: "none",
    lifecycle_8_offset_ms: 3_966_200,
    lifecycle_8_kind: "environment.session.ended",
    lifecycle_8_detail: "none",
    ...overrides,
  };
}

function scalar(value) {
  return value === null ? "null" : String(value);
}

function summary(inputValues) {
  return [
    "Personal Exploration Map / USB field-test diagnostics",
    "privacy=no_coordinates_no_map_names_no_ids_no_marker_text_no_map_images",
    "contains=device_time_battery_permissions_callback_delivery_gaps_observation_freshness_and_aggregate_tracking_metrics",
    "exploration_count=1",
    "",
    "[exploration_1]",
    ...Object.entries(inputValues).map(([key, value]) => `${key}=${scalar(value)}`),
    "",
  ].join("\n");
}

async function sha256(filePath) {
  return createHash("sha256").update(await fs.readFile(filePath)).digest("hex");
}

async function createBundle(root, inputValues) {
  const bundle = path.join(root, "pem-field-test-20260810T000000Z");
  const appDirectory = path.join(bundle, "app");
  await fs.mkdir(appDirectory, { recursive: true });
  const summaryPath = path.join(bundle, "coordinate-free-diagnostics.txt");
  const manifestPath = path.join(bundle, "manifest.json");
  const privatePath = path.join(appDirectory, "app-private-data.tar");
  await fs.writeFile(summaryPath, summary(inputValues), "utf8");
  await fs.writeFile(
    manifestPath,
    JSON.stringify({
      formatVersion: 1,
      packageName: "com.cider328.personalexplorationmap.fieldtest",
      containsRawLocation: true,
      autoUpload: false,
      warning: "Raw location stays local.",
    }),
    "utf8",
  );
  await fs.writeFile(privatePath, "private fixture", "utf8");
  const entries = [summaryPath, manifestPath, privatePath];
  const checksums = [];
  for (const filePath of entries) {
    const relative = path.relative(bundle, filePath).replaceAll(path.sep, "/");
    checksums.push(`${await sha256(filePath)}  ${relative}`);
  }
  await fs.writeFile(
    path.join(bundle, "SHA256SUMS.txt"),
    `${checksums.join("\n")}\n`,
    "utf8",
  );
  return bundle;
}

async function withBundle(inputValues, operation) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pem-buffered-delivery-"));
  try {
    const bundle = await createBundle(root, inputValues);
    await operation(bundle);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

function codes(report) {
  return new Set(report.findings.map((item) => item.code));
}

test("generic catch-up delivery is WARN rather than raw-loss FAIL", async () => {
  await withBundle(values(), async (bundle) => {
    const result = await analyzeFieldTestEvidence(bundle, {
      mode: "generic",
      generatedAt: "2026-08-10T02:00:00.000Z",
    });
    assert.equal(result.report.schemaVersion, 3);
    assert.equal(result.report.status, "WARN");
    assert.equal(codes(result.report).has("callback_gap_120s"), false);
    assert.equal(codes(result.report).has("callback_delivery_batched"), true);
    assert.equal(codes(result.report).has("live_freshness_degraded"), true);
    assert.equal(
      result.report.evaluatedExploration.values.callback_largest_batch,
      107,
    );
    assert.equal(
      result.report.evaluatedExploration.values
        .callback_oldest_observation_age_ms_max,
      753_019,
    );
    const markdown = await fs.readFile(result.markdownPath, "utf8");
    assert.match(markdown, /delayed buffered delivery/u);
    assert.doesNotMatch(markdown, /latitude|longitude|personal_map_id/u);
  });
});

test("S0 keeps the hard live-freshness gate", async () => {
  await withBundle(values(), async (bundle) => {
    const result = await analyzeFieldTestEvidence(bundle, { mode: "s0" });
    assert.equal(result.report.status, "FAIL");
    assert.equal(codes(result.report).has("callback_gap_120s"), true);
    assert.equal(codes(result.report).has("callback_delivery_batched"), false);
  });
});

test("generic mode remains FAIL when observation continuity is broken", async () => {
  await withBundle(
    values({
      sample_gap_ms_max: 180_000,
      sample_gap_at_least_30s: 1,
      sample_gap_at_least_60s: 1,
      sample_gap_at_least_120s: 1,
    }),
    async (bundle) => {
      const result = await analyzeFieldTestEvidence(bundle, { mode: "generic" });
      assert.equal(result.report.status, "FAIL");
      assert.equal(codes(result.report).has("callback_gap_120s"), true);
      assert.equal(codes(result.report).has("callback_delivery_batched"), false);
    },
  );
});

test("generic mode remains FAIL when received samples are unaccounted", async () => {
  await withBundle(
    values({ callback_persisted_samples: 650 }),
    async (bundle) => {
      const result = await analyzeFieldTestEvidence(bundle, { mode: "generic" });
      assert.equal(result.report.status, "FAIL");
      assert.equal(codes(result.report).has("callback_samples_unaccounted"), true);
      assert.equal(codes(result.report).has("callback_gap_120s"), true);
    },
  );
});
