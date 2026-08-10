import assert from "node:assert/strict";
import test from "node:test";

import {
  createExplorationTrackingDiagnostics,
  formatTrackingDiagnosticsSummary,
  summarizeNumericDistribution,
  type TrackingDiagnosticEvent,
} from "../src/index.ts";
import type { RawPositionSample } from "../../mapping-core/src/index.ts";

function sample(
  id: string,
  recordedAtMs: number,
  latitude: number,
  accuracy: number,
): RawPositionSample {
  return {
    id,
    recordedAtMs,
    source: "gnss",
    position: {
      kind: "geographic",
      latitude,
      longitude: 139,
    },
    horizontalAccuracyMeters: accuracy,
    confidence: 0.95,
  };
}

function event(
  id: string,
  kind: TrackingDiagnosticEvent["kind"],
  occurredAtMs: number,
  payload?: TrackingDiagnosticEvent["payload"],
): TrackingDiagnosticEvent {
  return {
    id,
    personalMapId: "map-1",
    explorationId: "exploration-1",
    providerId: "gnss-background",
    kind,
    occurredAtMs,
    ...(payload === undefined ? {} : { payload }),
  };
}

function environmentPayload(input: {
  readonly capturedAtMs: number;
  readonly elapsedRealtimeMs: number;
  readonly batteryLevelPercent: number;
  readonly powerSaveMode: boolean;
}) {
  return {
    capturedAtMs: input.capturedAtMs,
    elapsedRealtimeMs: input.elapsedRealtimeMs,
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
    batteryLevelPercent: input.batteryLevelPercent,
    batteryStatus: "discharging",
    batteryPlugged: "none",
    batteryTemperatureCelsius: 31.5,
    batteryVoltageMillivolts: 4_050,
    batteryCurrentMicroamps: 250_000,
    batteryChargeCounterMicroampHours: 3_000_000,
    powerSaveMode: input.powerSaveMode,
    batteryOptimizationEnabled: false,
    thermalStatus: 0,
    fineLocationGranted: true,
    coarseLocationGranted: true,
    backgroundLocationGranted: true,
    notificationGranted: true,
  } as const;
}

test("numeric summaries use deterministic nearest-rank percentiles", () => {
  assert.deepEqual(summarizeNumericDistribution([]), {
    count: 0,
    minimum: null,
    median: null,
    p95: null,
    maximum: null,
  });

  assert.deepEqual(
    summarizeNumericDistribution([100, 10, 20, 30, 40, Number.NaN, -1]),
    {
      count: 5,
      minimum: 10,
      median: 30,
      p95: 100,
      maximum: 100,
    },
  );
});

test("tracking diagnostics separate delivery, observation, and marker freshness", () => {
  const report = createExplorationTrackingDiagnostics({
    providerId: "gnss-background",
    exploration: {
      id: "exploration-1",
      name: "Pocket walk",
      startedAtMs: 1_000,
      endedAtMs: 201_000,
      samples: [
        sample("sample-1", 2_000, 35, 4),
        sample("sample-2", 7_000, 35.00001, 8),
        sample("sample-3", 42_000, 35.00002, 20),
        sample("sample-4", 107_000, 35.00003, 120),
        sample("sample-5", 197_000, 35.00004, 12),
      ],
      markers: [],
    },
    events: [
      event("event-1", "provider.start.requested", 1_000),
      event("event-2", "provider.started", 1_100),
      event(
        "environment-start",
        "environment.session.started",
        1_150,
        environmentPayload({
          capturedAtMs: 1_150,
          elapsedRealtimeMs: 10_000,
          batteryLevelPercent: 96,
          powerSaveMode: false,
        }),
      ),
      event("event-3", "app.state.changed", 1_200, {
        state: "background",
      }),
      event("event-4", "callback.received", 8_000, {
        sampleCount: 3,
        delivery: "background",
        firstSampleAtMs: 2_000,
        lastSampleAtMs: 7_000,
        callbackReceivedAtMs: 8_000,
      }),
      event("event-5", "callback.persisted", 8_100, {
        persistedSampleCount: 2,
        duplicateSampleCount: 1,
        acceptedSampleCount: 2,
        rejectedSampleCount: 0,
      }),
      event("event-6", "callback.received", 43_000, {
        sampleCount: 2,
        delivery: "background",
        firstSampleAtMs: 42_000,
        lastSampleAtMs: 42_000,
        callbackReceivedAtMs: 43_000,
      }),
      event("event-7", "callback.persisted", 43_100, {
        persistedSampleCount: 2,
        duplicateSampleCount: 0,
        acceptedSampleCount: 1,
        rejectedSampleCount: 1,
      }),
      event("event-8", "callback.failed", 150_000, {
        message: "database busy",
      }),
      event("event-9", "marker.input.completed", 160_000, {
        durationMs: 4_500,
        latestObservationAgeMs: 5_000,
        latestObservationMissing: false,
        latestObservationFuture: false,
      }),
      event("event-10", "marker.input.completed", 170_000, {
        durationMs: 7_000,
        latestObservationAgeMs: 20_000,
        latestObservationMissing: false,
        latestObservationFuture: false,
      }),
      event("event-11", "marker.input.cancelled", 180_000, {
        durationMs: 2_000,
      }),
      event(
        "environment-end",
        "environment.session.ended",
        199_900,
        environmentPayload({
          capturedAtMs: 199_900,
          elapsedRealtimeMs: 208_750,
          batteryLevelPercent: 93,
          powerSaveMode: true,
        }),
      ),
      event("event-12", "provider.stop.requested", 200_000),
      event("event-13", "provider.stopped", 200_100),
      {
        ...event("other", "callback.received", 10_000, {
          sampleCount: 99,
        }),
        explorationId: "other-exploration",
      },
    ],
  });

  assert.equal(report.version, 3);
  assert.equal(report.durationMs, 200_000);
  assert.equal(report.rawSampleCount, 5);
  assert.equal(report.acceptedSampleCount, 4);
  assert.equal(report.rejectedSampleCount, 1);
  assert.equal(report.acceptanceRate, 0.8);
  assert.deepEqual(report.rejectionReasons, [
    { reason: "accuracy-too-low", count: 1 },
  ]);

  assert.deepEqual(report.sampleGapsMs, {
    count: 4,
    minimum: 5_000,
    median: 35_000,
    p95: 90_000,
    maximum: 90_000,
    atLeast30Seconds: 3,
    atLeast60Seconds: 2,
    atLeast120Seconds: 0,
  });
  assert.deepEqual(report.sampleWindow, {
    beforeStartCount: 0,
    beforeStartMaximumMs: null,
    afterEndCount: 0,
    afterEndMaximumMs: null,
  });
  assert.deepEqual(report.horizontalAccuracyMeters, {
    count: 5,
    minimum: 4,
    median: 12,
    p95: 120,
    maximum: 120,
  });
  assert.deepEqual(report.callbacks, {
    receivedBatchCount: 2,
    receivedSampleCount: 5,
    persistedBatchCount: 2,
    persistedSampleCount: 4,
    duplicateSampleCount: 1,
    acceptedSampleCount: 3,
    rejectedSampleCount: 1,
    failedBatchCount: 1,
    largestBatchSize: 3,
    deliveryGapsMs: {
      count: 1,
      minimum: 35_000,
      median: 35_000,
      p95: 35_000,
      maximum: 35_000,
      atLeast30Seconds: 1,
      atLeast60Seconds: 0,
      atLeast120Seconds: 0,
    },
    oldestObservationAgeMs: {
      count: 2,
      minimum: 1_000,
      median: 1_000,
      p95: 6_000,
      maximum: 6_000,
    },
    newestObservationAgeMs: {
      count: 2,
      minimum: 1_000,
      median: 1_000,
      p95: 1_000,
      maximum: 1_000,
    },
    futureObservationBatchCount: 0,
    missingObservationTimestampBatchCount: 0,
  });
  assert.deepEqual(report.markerInputMs, {
    count: 2,
    minimum: 4_500,
    median: 4_500,
    p95: 7_000,
    maximum: 7_000,
    completedCount: 2,
    cancelledCount: 1,
    latestObservationAgeMs: {
      count: 2,
      minimum: 5_000,
      median: 5_000,
      p95: 20_000,
      maximum: 20_000,
    },
    missingLatestObservationCount: 0,
    futureLatestObservationCount: 0,
  });
  assert.equal(report.environment.start?.model, "Pixel Test");
  assert.equal(report.environment.start?.batteryLevelPercent, 96);
  assert.equal(report.environment.end?.batteryLevelPercent, 93);
  assert.equal(report.environment.end?.powerSaveMode, true);
  assert.equal(report.environment.batteryConsumedPercentagePoints, 3);
  assert.equal(report.environment.snapshotElapsedDurationMs, 198_750);
  assert.deepEqual(report.lastError, {
    kind: "callback.failed",
    occurredAtMs: 150_000,
    message: "database busy",
  });
  assert.deepEqual(
    report.lifecycle.map((transition) => transition.kind),
    [
      "provider.start.requested",
      "provider.started",
      "environment.session.started",
      "app.state.changed",
      "environment.session.ended",
      "provider.stop.requested",
      "provider.stopped",
    ],
  );

  const formatted = formatTrackingDiagnosticsSummary(report);
  assert.match(formatted, /personal_exploration_map_diagnostics_format=3/u);
  assert.match(formatted, /device_model=Pixel Test/u);
  assert.match(formatted, /android_version=15/u);
  assert.match(formatted, /start_battery_percent=96/u);
  assert.match(formatted, /end_battery_percent=93/u);
  assert.match(formatted, /battery_consumed_percentage_points=3/u);
  assert.match(formatted, /background_location_granted=true/u);
  assert.match(formatted, /callback_gap_ms_max=35000/u);
  assert.match(formatted, /callback_newest_observation_age_ms_p95=1000/u);
  assert.match(formatted, /sample_before_start_count=0/u);
  assert.match(formatted, /marker_latest_observation_age_ms_p95=20000/u);
  assert.match(formatted, /marker_latest_observation_missing_count=0/u);
  assert.doesNotMatch(formatted, /latitude|longitude/u);
});

test("sample-window and future timing remain coordinate-free and fail closed", () => {
  const report = createExplorationTrackingDiagnostics({
    providerId: "gnss-background",
    exploration: {
      id: "exploration-1",
      name: "Pocket walk",
      startedAtMs: 100_000,
      endedAtMs: 200_000,
      samples: [
        sample("cached", 40_000, 35, 10),
        sample("inside", 150_000, 35.00001, 8),
        sample("late", 215_000, 35.00002, 7),
      ],
      markers: [],
    },
    events: [
      event("callback-1", "callback.received", 100_500, {
        sampleCount: 1,
        firstSampleAtMs: 101_000,
        lastSampleAtMs: 101_000,
        callbackReceivedAtMs: 100_500,
      }),
      event("callback-2", "callback.received", 130_500, {
        sampleCount: 1,
      }),
      event("marker-missing", "marker.input.completed", 180_000, {
        durationMs: 1_000,
        latestObservationAgeMs: null,
        latestObservationMissing: true,
        latestObservationFuture: false,
      }),
      event("marker-future", "marker.input.completed", 190_000, {
        durationMs: 1_500,
        latestObservationAgeMs: null,
        latestObservationMissing: false,
        latestObservationFuture: true,
      }),
    ],
  });

  assert.deepEqual(report.sampleWindow, {
    beforeStartCount: 1,
    beforeStartMaximumMs: 60_000,
    afterEndCount: 1,
    afterEndMaximumMs: 15_000,
  });
  assert.deepEqual(report.rejectionReasons, [
    { reason: "sample-before-session-start", count: 1 },
    { reason: "session-not-recording", count: 1 },
  ]);
  assert.equal(report.acceptedSampleCount, 1);
  assert.equal(report.callbacks.futureObservationBatchCount, 1);
  assert.equal(report.callbacks.missingObservationTimestampBatchCount, 1);
  assert.deepEqual(report.callbacks.deliveryGapsMs, {
    count: 1,
    minimum: 30_000,
    median: 30_000,
    p95: 30_000,
    maximum: 30_000,
    atLeast30Seconds: 1,
    atLeast60Seconds: 0,
    atLeast120Seconds: 0,
  });
  assert.equal(report.markerInputMs.missingLatestObservationCount, 1);
  assert.equal(report.markerInputMs.futureLatestObservationCount, 1);
  assert.deepEqual(report.markerInputMs.latestObservationAgeMs, {
    count: 0,
    minimum: null,
    median: null,
    p95: null,
    maximum: null,
  });
});
