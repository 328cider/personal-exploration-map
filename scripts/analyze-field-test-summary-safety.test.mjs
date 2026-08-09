import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  analyzeFieldTestBundle,
  evaluateExploration,
} from "./analyze-field-test-summary.mjs";

function validS0Values(overrides = {}) {
  return {
    provider: "gnss-background",
    session_started_at_iso_utc: "2026-08-09T00:00:00.000Z",
    session_ended_at_iso_utc: "2026-08-09T00:05:00.000Z",
    duration_ms: 300_000,
    snapshot_elapsed_duration_ms: 300_000,
    device_model: "Pixel Test",
    android_version: "17",
    app_package: "com.cider328.personalexplorationmap.fieldtest",
    app_version_name: "0.1.0",
    app_debuggable: true,
    start_elapsed_realtime_ms: 10_000,
    end_elapsed_realtime_ms: 310_000,
    start_fine_location_granted: true,
    end_fine_location_granted: true,
    start_background_location_granted: true,
    end_background_location_granted: true,
    start_notification_granted: true,
    end_notification_granted: true,
    start_battery_percent: 90,
    end_battery_percent: 89,
    start_power_save_mode: false,
    start_battery_optimization_enabled: false,
    end_thermal_status: 0,
    raw_samples: 10,
    accepted_samples: 9,
    callback_received_samples: 10,
    callback_persisted_samples: 9,
    callback_duplicate_samples: 1,
    callback_failed_batches: 0,
    marker_input_completed: 1,
    last_error_kind: "none",
    lifecycle_count: 8,
    lifecycle_1_kind: "provider.start.requested",
    lifecycle_1_detail: "none",
    lifecycle_1_offset_ms: 0,
    lifecycle_2_kind: "provider.started",
    lifecycle_2_detail: "none",
    lifecycle_2_offset_ms: 10,
    lifecycle_3_kind: "environment.session.started",
    lifecycle_3_detail: "none",
    lifecycle_3_offset_ms: 20,
    lifecycle_4_kind: "app.state.changed",
    lifecycle_4_detail: "background",
    lifecycle_4_offset_ms: 100_000,
    lifecycle_5_kind: "app.state.changed",
    lifecycle_5_detail: "active",
    lifecycle_5_offset_ms: 200_000,
    lifecycle_6_kind: "provider.stop.requested",
    lifecycle_6_detail: "none",
    lifecycle_6_offset_ms: 299_000,
    lifecycle_7_kind: "provider.stopped",
    lifecycle_7_detail: "none",
    lifecycle_7_offset_ms: 299_500,
    lifecycle_8_kind: "environment.session.ended",
    lifecycle_8_detail: "none",
    lifecycle_8_offset_ms: 300_000,
    ...overrides,
  };
}

function summary(values, extraLines = []) {
  return [
    "Personal Exploration Map / USB field-test diagnostics",
    "privacy=no_coordinates_no_map_names_no_ids_no_marker_text_no_map_images",
    "contains=device_time_battery_permissions_and_aggregate_tracking_metrics",
    "exploration_count=1",
    "",
    "[exploration_1]",
    ...Object.entries(values).map(([key, value]) => `${key}=${value === null ? "null" : value}`),
    ...extraLines,
    "",
  ].join("\n");
}

async function sha256(filePath) {
  return createHash("sha256").update(await fs.readFile(filePath)).digest("hex");
}

async function makeBundle(root, summaryText) {
  const bundle = path.join(root, "pem-field-test-20260809T000000Z");
  await fs.mkdir(path.join(bundle, "app"), { recursive: true });
  const files = {
    "coordinate-free-diagnostics.txt": summaryText,
    "manifest.json": JSON.stringify({
      formatVersion: 1,
      packageName: "com.cider328.personalexplorationmap.fieldtest",
      containsRawLocation: true,
      autoUpload: false,
      warning: "Raw location stays local.",
    }),
    "app/app-private-data.tar": "private-test-data",
  };
  for (const [relative, content] of Object.entries(files)) {
    await fs.writeFile(path.join(bundle, relative), content, "utf8");
  }
  const checksumLines = [];
  for (const relative of Object.keys(files)) {
    checksumLines.push(`${await sha256(path.join(bundle, relative))}  ${relative}`);
  }
  await fs.writeFile(
    path.join(bundle, "SHA256SUMS.txt"),
    `${checksumLines.join("\n")}\n`,
    "utf8",
  );
  return bundle;
}

test("received samples may be accounted for by persisted plus duplicates", () => {
  const result = evaluateExploration(validS0Values());
  const codes = new Set(result.findings.map((item) => item.code));
  assert.equal(codes.has("callback_samples_unaccounted"), false);
  assert.equal(codes.has("callback_accounting_inconsistent"), false);
});

test("unaccounted callback samples remain a hard failure", () => {
  const result = evaluateExploration(
    validS0Values({
      callback_received_samples: 10,
      callback_persisted_samples: 8,
      callback_duplicate_samples: 1,
    }),
  );
  assert.ok(
    result.findings.some(
      (item) => item.severity === "FAIL" && item.code === "callback_samples_unaccounted",
    ),
  );
});

test("unexpected coordinate values are never projected into generated reports", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pem-field-safe-report-"));
  try {
    const secretCoordinate = "35.123456789";
    const bundle = await makeBundle(
      root,
      summary(validS0Values(), [`latitude=${secretCoordinate}`]),
    );
    const result = await analyzeFieldTestBundle(bundle, {
      generatedAt: "2026-08-09T00:10:00.000Z",
    });
    assert.equal(result.report.status, "FAIL");
    assert.ok(result.report.findings.some((item) => item.code === "coordinate_key_present"));

    const json = await fs.readFile(result.jsonPath, "utf8");
    const markdown = await fs.readFile(result.markdownPath, "utf8");
    assert.equal(json.includes(secretCoordinate), false);
    assert.equal(markdown.includes(secretCoordinate), false);
    assert.equal(Object.hasOwn(result.report.latestExploration.values, "latitude"), false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
