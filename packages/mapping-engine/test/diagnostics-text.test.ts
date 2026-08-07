import assert from "node:assert/strict";
import test from "node:test";

import {
  formatTrackingDiagnosticsSummary,
  type ExplorationTrackingDiagnostics,
} from "../src/index.ts";

function report(
  overrides: Partial<ExplorationTrackingDiagnostics> = {},
): ExplorationTrackingDiagnostics {
  return {
    version: 1,
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

test("aggregate text excludes ids and absolute timestamps", () => {
  const text = formatTrackingDiagnosticsSummary(report());

  assert.match(text, /provider=gnss-background/u);
  assert.match(text, /raw_samples=10/u);
  assert.match(text, /acceptance_rate=0.8/u);
  assert.match(text, /accuracy_m_p95=40/u);
  assert.match(text, /sample_gap_at_least_60s=1/u);
  assert.match(text, /callback_duplicate_samples=1/u);
  assert.match(text, /marker_input_median=4500/u);
  assert.match(text, /last_error_message=database busy retry scheduled/u);
  assert.match(text, /lifecycle_1_offset_ms=1000/u);

  assert.equal(text.includes("private-exploration-id"), false);
  assert.equal(text.includes("1700000000000"), false);
  assert.equal(text.includes("1700000060000"), false);
  assert.equal(text.includes("latitude"), false);
  assert.equal(text.includes("longitude"), false);
});

test("empty diagnostics remain explicit and stable", () => {
  const text = formatTrackingDiagnosticsSummary(
    report({
      rawSampleCount: 0,
      acceptedSampleCount: 0,
      rejectedSampleCount: 0,
      acceptanceRate: null,
      rejectionReasons: [],
      sampleGapsMs: {
        count: 0,
        minimum: null,
        median: null,
        p95: null,
        maximum: null,
        atLeast30Seconds: 0,
        atLeast60Seconds: 0,
        atLeast120Seconds: 0,
      },
      horizontalAccuracyMeters: {
        count: 0,
        minimum: null,
        median: null,
        p95: null,
        maximum: null,
      },
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
      },
      markerInputMs: {
        count: 0,
        minimum: null,
        median: null,
        p95: null,
        maximum: null,
        completedCount: 0,
        cancelledCount: 0,
      },
      lastError: null,
      lifecycle: [],
    }),
  );

  assert.match(text, /acceptance_rate=null/u);
  assert.match(text, /rejection_reasons=none/u);
  assert.match(text, /accuracy_m_median=null/u);
  assert.match(text, /last_error_kind=none/u);
  assert.match(text, /lifecycle_count=0/u);
});
