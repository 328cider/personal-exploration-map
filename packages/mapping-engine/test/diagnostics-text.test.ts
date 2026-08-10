import assert from "node:assert/strict";
import test from "node:test";

import {
  formatTrackingDiagnosticsSummary,
  type ExplorationTrackingDiagnostics,
  type TrackingEnvironmentSnapshot,
} from "../src/index.ts";

function environmentSnapshot(
  overrides: Partial<TrackingEnvironmentSnapshot> = {},
): TrackingEnvironmentSnapshot {
  return {
    capturedAtMs: 1_700_000_000_000,
    elapsedRealtimeMs: 10_000,
    manufacturer: "Google",
    brand: "google",
    model: "Pixel Test",
    device: "pixel-test",
    product: "pixel_test",
    androidVersion: "15",
    sdkInt: 35,
    buildId: "AP4A.test",
    buildFingerprintHash: "abc123",
    packageName: "com.cider328.personalexplorationmap.fieldtest",
    appVersionName: "0.1.0",
    appVersionCode: 1,
    isDebuggable: true,
    timezoneId: "Asia/Tokyo",
    timezoneOffsetMinutes: 540,
    localeTag: "ja-JP",
    batteryLevelPercent: 96,
    batteryStatus: "discharging",
    batteryPlugged: "none",
    batteryTemperatureCelsius: 31.5,
    batteryVoltageMillivolts: 4_050,
    batteryCurrentMicroamps: 250_000,
    batteryChargeCounterMicroampHours: 3_000_000,
    powerSaveMode: false,
    batteryOptimizationEnabled: false,
    thermalStatus: 0,
    fineLocationGranted: true,
    coarseLocationGranted: true,
    backgroundLocationGranted: true,
    notificationGranted: true,
    ...overrides,
  };
}

function emptyDistribution() {
  return {
    count: 0,
    minimum: null,
    median: null,
    p95: null,
    maximum: null,
  } as const;
}

function emptyGaps() {
  return {
    ...emptyDistribution(),
    atLeast30Seconds: 0,
    atLeast60Seconds: 0,
    atLeast120Seconds: 0,
  } as const;
}

function report(
  overrides: Partial<ExplorationTrackingDiagnostics> = {},
): ExplorationTrackingDiagnostics {
  return {
    version: 3,
    explorationId: "private-exploration-id",
    providerId: "gnss-background",
    startedAtMs: 1_700_000_000_000,
    endedAtMs: 1_700_000_060_000,
    durationMs: 60_000,
    rawSampleCount: 10,
    acceptedSampleCount: 8,
    rejectedSampleCount: 2,
    acceptanceRate: 0.8,
    rejectionReasons: [
      { reason: "accuracy-too-low", count: 2 },
    ],
    sampleGapsMs: {
      count: 9,
      minimum: 4_000,
      median: 5_000,
      p95: 35_000,
      maximum: 65_000,
      atLeast30Seconds: 2,
      atLeast60Seconds: 1,
      atLeast120Seconds: 0,
    },
    sampleWindow: {
      beforeStartCount: 1,
      beforeStartMaximumMs: 120_000,
      afterEndCount: 0,
      afterEndMaximumMs: null,
    },
    horizontalAccuracyMeters: {
      count: 10,
      minimum: 3,
      median: 8,
      p95: 40,
      maximum: 70,
    },
    callbacks: {
      receivedBatchCount: 4,
      receivedSampleCount: 11,
      persistedBatchCount: 4,
      persistedSampleCount: 10,
      duplicateSampleCount: 1,
      acceptedSampleCount: 8,
      rejectedSampleCount: 2,
      failedBatchCount: 0,
      largestBatchSize: 4,
      deliveryGapsMs: {
        count: 3,
        minimum: 4_000,
        median: 8_000,
        p95: 31_000,
        maximum: 31_000,
        atLeast30Seconds: 1,
        atLeast60Seconds: 0,
        atLeast120Seconds: 0,
      },
      oldestObservationAgeMs: {
        count: 4,
        minimum: 500,
        median: 1_000,
        p95: 120_000,
        maximum: 120_000,
      },
      newestObservationAgeMs: {
        count: 4,
        minimum: 100,
        median: 500,
        p95: 5_000,
        maximum: 5_000,
      },
      futureObservationBatchCount: 0,
      missingObservationTimestampBatchCount: 0,
    },
    markerInputMs: {
      count: 1,
      minimum: 4_500,
      median: 4_500,
      p95: 4_500,
      maximum: 4_500,
      completedCount: 1,
      cancelledCount: 0,
    },
    environment: {
      start: environmentSnapshot(),
      end: environmentSnapshot({
        capturedAtMs: 1_700_000_060_000,
        elapsedRealtimeMs: 70_000,
        batteryLevelPercent: 94,
      }),
      batteryConsumedPercentagePoints: 2,
      snapshotElapsedDurationMs: 60_000,
    },
    lastError: {
      kind: "callback.failed",
      occurredAtMs: 1_700_000_030_000,
      message: "database busy\nretry scheduled",
    },
    lifecycle: [
      {
        kind: "provider.started",
        occurredAtMs: 1_700_000_001_000,
        detail: "background",
      },
    ],
    ...overrides,
  };
}

test("coordinate-free text separates callback delivery and observation timing", () => {
  const formatted = formatTrackingDiagnosticsSummary(report());

  assert.match(formatted, /personal_exploration_map_diagnostics_format=3/u);
  assert.match(formatted, /report_version=3/u);
  assert.match(formatted, /provider=gnss-background/u);
  assert.match(formatted, /session_started_at_iso_utc=/u);
  assert.match(formatted, /device_model=Pixel Test/u);
  assert.match(formatted, /start_battery_percent=96/u);
  assert.match(formatted, /end_battery_percent=94/u);
  assert.match(formatted, /battery_consumed_percentage_points=2/u);
  assert.match(formatted, /raw_samples=10/u);
  assert.match(formatted, /acceptance_rate=0.8/u);
  assert.match(formatted, /accuracy_m_p95=40/u);
  assert.match(formatted, /sample_gap_at_least_60s=1/u);
  assert.match(formatted, /sample_before_start_count=1/u);
  assert.match(formatted, /sample_before_start_max_ms=120000/u);
  assert.match(formatted, /sample_after_end_count=0/u);
  assert.match(formatted, /callback_duplicate_samples=1/u);
  assert.match(formatted, /callback_gap_ms_p95=31000/u);
  assert.match(formatted, /callback_gap_at_least_30s=1/u);
  assert.match(formatted, /callback_oldest_observation_age_ms_max=120000/u);
  assert.match(formatted, /callback_newest_observation_age_ms_p95=5000/u);
  assert.match(formatted, /callback_future_observation_batches=0/u);
  assert.match(
    formatted,
    /callback_missing_observation_timestamp_batches=0/u,
  );
  assert.match(formatted, /marker_input_ms_median=4500/u);
  assert.match(formatted, /last_error_message=database busy retry scheduled/u);
  assert.match(formatted, /lifecycle_1_offset_ms=1000/u);

  assert.equal(formatted.includes("private-exploration-id"), false);
  assert.equal(formatted.includes("latitude"), false);
  assert.equal(formatted.includes("longitude"), false);
});

test("empty diagnostics remain explicit and stable", () => {
  const formatted = formatTrackingDiagnosticsSummary(
    report({
      rawSampleCount: 0,
      acceptedSampleCount: 0,
      rejectedSampleCount: 0,
      acceptanceRate: null,
      rejectionReasons: [],
      sampleGapsMs: emptyGaps(),
      sampleWindow: {
        beforeStartCount: 0,
        beforeStartMaximumMs: null,
        afterEndCount: 0,
        afterEndMaximumMs: null,
      },
      horizontalAccuracyMeters: emptyDistribution(),
      callbacks: {
        receivedBatchCount: 0,
        receivedSampleCount: 0,
        persistedBatchCount: 0,
        persistedSampleCount: 0,
        duplicateSampleCount: 0,
        acceptedSampleCount: 0,
        rejectedSampleCount: 0,
        failedBatchCount: 0,
        largestBatchSize: 0,
        deliveryGapsMs: emptyGaps(),
        oldestObservationAgeMs: emptyDistribution(),
        newestObservationAgeMs: emptyDistribution(),
        futureObservationBatchCount: 0,
        missingObservationTimestampBatchCount: 0,
      },
      markerInputMs: {
        ...emptyDistribution(),
        completedCount: 0,
        cancelledCount: 0,
      },
      environment: {
        start: null,
        end: null,
        batteryConsumedPercentagePoints: null,
        snapshotElapsedDurationMs: null,
      },
      lastError: null,
      lifecycle: [],
    }),
  );

  assert.match(formatted, /acceptance_rate=null/u);
  assert.match(formatted, /rejection_reasons=none/u);
  assert.match(formatted, /accuracy_m_median=null/u);
  assert.match(formatted, /sample_before_start_max_ms=null/u);
  assert.match(formatted, /callback_gap_ms_median=null/u);
  assert.match(formatted, /callback_newest_observation_age_ms_max=null/u);
  assert.match(formatted, /device_model=null/u);
  assert.match(formatted, /start_battery_percent=null/u);
  assert.match(formatted, /last_error_kind=none/u);
  assert.match(formatted, /lifecycle_count=0/u);
});
