import {
  replayExploration,
  type RejectionReason,
  type ReplayExplorationInput,
} from "../../mapping-core/src/index.ts";

export type TrackingDiagnosticScalar = string | number | boolean | null;

export type TrackingDiagnosticPayload = Readonly<
  Record<string, TrackingDiagnosticScalar>
>;

export type TrackingDiagnosticEventKind =
  | "provider.start.requested"
  | "provider.started"
  | "provider.start.failed"
  | "provider.stop.requested"
  | "provider.stopped"
  | "provider.stop.failed"
  | "callback.received"
  | "callback.persisted"
  | "callback.failed"
  | "app.state.changed"
  | "app.session.recovered"
  | "marker.input.completed"
  | "marker.input.cancelled"
  | "environment.session.started"
  | "environment.session.ended"
  | "environment.snapshot.failed";

/**
 * Non-canonical operational evidence used to evaluate passive tracking.
 *
 * These events never decide map truth. Raw observations remain canonical and
 * all accepted/rejected counts are recomputed by replaying mapping-core.
 */
export interface TrackingDiagnosticEvent {
  readonly id: string;
  readonly personalMapId: string;
  readonly explorationId: string;
  readonly providerId: string;
  readonly kind: TrackingDiagnosticEventKind;
  readonly occurredAtMs: number;
  readonly payload?: TrackingDiagnosticPayload;
}

export interface NumericDistributionSummary {
  readonly count: number;
  readonly minimum: number | null;
  readonly median: number | null;
  readonly p95: number | null;
  readonly maximum: number | null;
}

export interface SampleGapSummary extends NumericDistributionSummary {
  readonly atLeast30Seconds: number;
  readonly atLeast60Seconds: number;
  readonly atLeast120Seconds: number;
}

export interface RejectionReasonCount {
  readonly reason: RejectionReason;
  readonly count: number;
}

export interface CallbackDiagnosticSummary {
  readonly receivedBatchCount: number;
  readonly receivedSampleCount: number;
  readonly persistedBatchCount: number;
  readonly persistedSampleCount: number;
  readonly duplicateSampleCount: number;
  readonly acceptedSampleCount: number;
  readonly rejectedSampleCount: number;
  readonly failedBatchCount: number;
  readonly largestBatchSize: number;
}

export interface TrackingDiagnosticError {
  readonly kind: TrackingDiagnosticEventKind;
  readonly occurredAtMs: number;
  readonly message: string;
}

export interface TrackingLifecycleTransition {
  readonly kind: TrackingDiagnosticEventKind;
  readonly occurredAtMs: number;
  readonly detail: string | null;
}

export interface MarkerInputSummary extends NumericDistributionSummary {
  readonly completedCount: number;
  readonly cancelledCount: number;
}

export interface TrackingEnvironmentSnapshot {
  readonly capturedAtMs: number | null;
  readonly elapsedRealtimeMs: number | null;
  readonly manufacturer: string | null;
  readonly brand: string | null;
  readonly model: string | null;
  readonly device: string | null;
  readonly product: string | null;
  readonly androidVersion: string | null;
  readonly sdkInt: number | null;
  readonly buildId: string | null;
  readonly buildFingerprintHash: string | null;
  readonly packageName: string | null;
  readonly appVersionName: string | null;
  readonly appVersionCode: number | null;
  readonly isDebuggable: boolean | null;
  readonly timezoneId: string | null;
  readonly timezoneOffsetMinutes: number | null;
  readonly localeTag: string | null;
  readonly batteryLevelPercent: number | null;
  readonly batteryStatus: string | null;
  readonly batteryPlugged: string | null;
  readonly batteryTemperatureCelsius: number | null;
  readonly batteryVoltageMillivolts: number | null;
  readonly batteryCurrentMicroamps: number | null;
  readonly batteryChargeCounterMicroampHours: number | null;
  readonly powerSaveMode: boolean | null;
  readonly batteryOptimizationEnabled: boolean | null;
  readonly thermalStatus: number | null;
  readonly fineLocationGranted: boolean | null;
  readonly coarseLocationGranted: boolean | null;
  readonly backgroundLocationGranted: boolean | null;
  readonly notificationGranted: boolean | null;
}

export interface TrackingEnvironmentSummary {
  readonly start: TrackingEnvironmentSnapshot | null;
  readonly end: TrackingEnvironmentSnapshot | null;
  readonly batteryConsumedPercentagePoints: number | null;
  readonly snapshotElapsedDurationMs: number | null;
}

export interface ExplorationTrackingDiagnostics {
  readonly version: 2;
  readonly explorationId: string;
  readonly providerId: string;
  readonly startedAtMs: number;
  readonly endedAtMs: number | null;
  readonly durationMs: number;
  readonly rawSampleCount: number;
  readonly acceptedSampleCount: number;
  readonly rejectedSampleCount: number;
  readonly acceptanceRate: number | null;
  readonly rejectionReasons: readonly RejectionReasonCount[];
  readonly sampleGapsMs: SampleGapSummary;
  readonly horizontalAccuracyMeters: NumericDistributionSummary;
  readonly callbacks: CallbackDiagnosticSummary;
  readonly markerInputMs: MarkerInputSummary;
  readonly environment: TrackingEnvironmentSummary;
  readonly lastError: TrackingDiagnosticError | null;
  readonly lifecycle: readonly TrackingLifecycleTransition[];
}

const REJECTION_REASONS: readonly RejectionReason[] = [
  "invalid-coordinate",
  "invalid-confidence",
  "timestamp-not-increasing",
  "accuracy-too-low",
  "implausible-jump",
  "coordinate-frame-mismatch",
  "session-not-recording",
];

function finiteNonNegative(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function payloadNumber(
  event: TrackingDiagnosticEvent,
  key: string,
): number {
  return finiteNonNegative(event.payload?.[key]) ?? 0;
}

function payloadNullableNumber(
  event: TrackingDiagnosticEvent,
  key: string,
): number | null {
  return finiteNumber(event.payload?.[key]);
}

function payloadString(
  event: TrackingDiagnosticEvent,
  key: string,
): string | null {
  const value = event.payload?.[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function payloadBoolean(
  event: TrackingDiagnosticEvent,
  key: string,
): boolean | null {
  const value = event.payload?.[key];
  return typeof value === "boolean" ? value : null;
}

function nearestRank(
  sortedValues: readonly number[],
  percentile: number,
): number | null {
  if (sortedValues.length === 0) {
    return null;
  }
  const index = Math.max(
    0,
    Math.min(
      sortedValues.length - 1,
      Math.ceil(percentile * sortedValues.length) - 1,
    ),
  );
  return sortedValues[index] ?? null;
}

export function summarizeNumericDistribution(
  values: readonly number[],
): NumericDistributionSummary {
  const sorted = values
    .filter((value) => Number.isFinite(value) && value >= 0)
    .sort((first, second) => first - second);

  return {
    count: sorted.length,
    minimum: sorted[0] ?? null,
    median: nearestRank(sorted, 0.5),
    p95: nearestRank(sorted, 0.95),
    maximum: sorted.at(-1) ?? null,
  };
}

function summarizeSampleGaps(gapsMs: readonly number[]): SampleGapSummary {
  const distribution = summarizeNumericDistribution(gapsMs);
  return {
    ...distribution,
    atLeast30Seconds: gapsMs.filter((gap) => gap >= 30_000).length,
    atLeast60Seconds: gapsMs.filter((gap) => gap >= 60_000).length,
    atLeast120Seconds: gapsMs.filter((gap) => gap >= 120_000).length,
  };
}

function createRejectionSummary(
  rejectedSamples: readonly { readonly reason: RejectionReason }[],
): readonly RejectionReasonCount[] {
  const counts = new Map<RejectionReason, number>();
  for (const rejected of rejectedSamples) {
    counts.set(rejected.reason, (counts.get(rejected.reason) ?? 0) + 1);
  }
  return REJECTION_REASONS.flatMap((reason) => {
    const count = counts.get(reason) ?? 0;
    return count === 0 ? [] : [{ reason, count }];
  });
}

function createCallbackSummary(
  events: readonly TrackingDiagnosticEvent[],
): CallbackDiagnosticSummary {
  let receivedBatchCount = 0;
  let receivedSampleCount = 0;
  let persistedBatchCount = 0;
  let persistedSampleCount = 0;
  let duplicateSampleCount = 0;
  let acceptedSampleCount = 0;
  let rejectedSampleCount = 0;
  let failedBatchCount = 0;
  let largestBatchSize = 0;

  for (const event of events) {
    if (event.kind === "callback.received") {
      const sampleCount = payloadNumber(event, "sampleCount");
      receivedBatchCount += 1;
      receivedSampleCount += sampleCount;
      largestBatchSize = Math.max(largestBatchSize, sampleCount);
    } else if (event.kind === "callback.persisted") {
      persistedBatchCount += 1;
      persistedSampleCount += payloadNumber(event, "persistedSampleCount");
      duplicateSampleCount += payloadNumber(event, "duplicateSampleCount");
      acceptedSampleCount += payloadNumber(event, "acceptedSampleCount");
      rejectedSampleCount += payloadNumber(event, "rejectedSampleCount");
    } else if (event.kind === "callback.failed") {
      failedBatchCount += 1;
    }
  }

  return {
    receivedBatchCount,
    receivedSampleCount,
    persistedBatchCount,
    persistedSampleCount,
    duplicateSampleCount,
    acceptedSampleCount,
    rejectedSampleCount,
    failedBatchCount,
    largestBatchSize,
  };
}

function createMarkerInputSummary(
  events: readonly TrackingDiagnosticEvent[],
): MarkerInputSummary {
  const completed = events.filter(
    (event) => event.kind === "marker.input.completed",
  );
  const durations = completed.flatMap((event) => {
    const duration = finiteNonNegative(event.payload?.durationMs);
    return duration === null ? [] : [duration];
  });
  return {
    ...summarizeNumericDistribution(durations),
    completedCount: completed.length,
    cancelledCount: events.filter(
      (event) => event.kind === "marker.input.cancelled",
    ).length,
  };
}

function createEnvironmentSnapshot(
  event: TrackingDiagnosticEvent,
): TrackingEnvironmentSnapshot {
  return {
    capturedAtMs: payloadNullableNumber(event, "capturedAtMs"),
    elapsedRealtimeMs: payloadNullableNumber(event, "elapsedRealtimeMs"),
    manufacturer: payloadString(event, "manufacturer"),
    brand: payloadString(event, "brand"),
    model: payloadString(event, "model"),
    device: payloadString(event, "device"),
    product: payloadString(event, "product"),
    androidVersion: payloadString(event, "androidVersion"),
    sdkInt: payloadNullableNumber(event, "sdkInt"),
    buildId: payloadString(event, "buildId"),
    buildFingerprintHash: payloadString(event, "buildFingerprintHash"),
    packageName: payloadString(event, "packageName"),
    appVersionName: payloadString(event, "appVersionName"),
    appVersionCode: payloadNullableNumber(event, "appVersionCode"),
    isDebuggable: payloadBoolean(event, "isDebuggable"),
    timezoneId: payloadString(event, "timezoneId"),
    timezoneOffsetMinutes: payloadNullableNumber(
      event,
      "timezoneOffsetMinutes",
    ),
    localeTag: payloadString(event, "localeTag"),
    batteryLevelPercent: payloadNullableNumber(event, "batteryLevelPercent"),
    batteryStatus: payloadString(event, "batteryStatus"),
    batteryPlugged: payloadString(event, "batteryPlugged"),
    batteryTemperatureCelsius: payloadNullableNumber(
      event,
      "batteryTemperatureCelsius",
    ),
    batteryVoltageMillivolts: payloadNullableNumber(
      event,
      "batteryVoltageMillivolts",
    ),
    batteryCurrentMicroamps: payloadNullableNumber(
      event,
      "batteryCurrentMicroamps",
    ),
    batteryChargeCounterMicroampHours: payloadNullableNumber(
      event,
      "batteryChargeCounterMicroampHours",
    ),
    powerSaveMode: payloadBoolean(event, "powerSaveMode"),
    batteryOptimizationEnabled: payloadBoolean(
      event,
      "batteryOptimizationEnabled",
    ),
    thermalStatus: payloadNullableNumber(event, "thermalStatus"),
    fineLocationGranted: payloadBoolean(event, "fineLocationGranted"),
    coarseLocationGranted: payloadBoolean(event, "coarseLocationGranted"),
    backgroundLocationGranted: payloadBoolean(
      event,
      "backgroundLocationGranted",
    ),
    notificationGranted: payloadBoolean(event, "notificationGranted"),
  };
}

function createEnvironmentSummary(
  events: readonly TrackingDiagnosticEvent[],
): TrackingEnvironmentSummary {
  const startEvent = events.find(
    (event) => event.kind === "environment.session.started",
  );
  const endEvent = events
    .filter((event) => event.kind === "environment.session.ended")
    .at(-1);
  const start = startEvent === undefined ? null : createEnvironmentSnapshot(startEvent);
  const end = endEvent === undefined ? null : createEnvironmentSnapshot(endEvent);

  const batteryConsumedPercentagePoints =
    start?.batteryLevelPercent !== null &&
    start?.batteryLevelPercent !== undefined &&
    end?.batteryLevelPercent !== null &&
    end?.batteryLevelPercent !== undefined
      ? start.batteryLevelPercent - end.batteryLevelPercent
      : null;
  const snapshotElapsedDurationMs =
    start?.elapsedRealtimeMs !== null &&
    start?.elapsedRealtimeMs !== undefined &&
    end?.elapsedRealtimeMs !== null &&
    end?.elapsedRealtimeMs !== undefined
      ? Math.max(0, end.elapsedRealtimeMs - start.elapsedRealtimeMs)
      : null;

  return {
    start,
    end,
    batteryConsumedPercentagePoints,
    snapshotElapsedDurationMs,
  };
}

function createLifecycle(
  events: readonly TrackingDiagnosticEvent[],
): readonly TrackingLifecycleTransition[] {
  const lifecycleKinds = new Set<TrackingDiagnosticEventKind>([
    "provider.start.requested",
    "provider.started",
    "provider.start.failed",
    "provider.stop.requested",
    "provider.stopped",
    "provider.stop.failed",
    "app.state.changed",
    "app.session.recovered",
    "environment.session.started",
    "environment.session.ended",
    "environment.snapshot.failed",
  ]);

  return events.flatMap((event) => {
    if (!lifecycleKinds.has(event.kind)) {
      return [];
    }
    return [
      {
        kind: event.kind,
        occurredAtMs: event.occurredAtMs,
        detail:
          payloadString(event, "state") ??
          payloadString(event, "phase") ??
          payloadString(event, "message") ??
          payloadString(event, "reason"),
      },
    ];
  });
}

function findLastError(
  events: readonly TrackingDiagnosticEvent[],
): TrackingDiagnosticError | null {
  const failures = events.filter(
    (event) =>
      event.kind === "provider.start.failed" ||
      event.kind === "provider.stop.failed" ||
      event.kind === "callback.failed" ||
      event.kind === "environment.snapshot.failed",
  );
  const last = failures.at(-1);
  if (last === undefined) {
    return null;
  }
  return {
    kind: last.kind,
    occurredAtMs: last.occurredAtMs,
    message: payloadString(last, "message") ?? "Unknown tracking error",
  };
}

export function createExplorationTrackingDiagnostics(input: {
  readonly exploration: ReplayExplorationInput;
  readonly providerId: string;
  readonly events: readonly TrackingDiagnosticEvent[];
}): ExplorationTrackingDiagnostics {
  const session = replayExploration(input.exploration);
  const samples = [...input.exploration.samples].sort(
    (first, second) => first.recordedAtMs - second.recordedAtMs,
  );
  const gapsMs: number[] = [];
  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1];
    const current = samples[index];
    if (previous === undefined || current === undefined) {
      continue;
    }
    gapsMs.push(Math.max(0, current.recordedAtMs - previous.recordedAtMs));
  }

  const horizontalAccuracyMeters = samples.flatMap((sample) => {
    const accuracy = finiteNonNegative(sample.horizontalAccuracyMeters);
    return accuracy === null ? [] : [accuracy];
  });

  const events = input.events
    .filter((event) => event.explorationId === input.exploration.id)
    .sort((first, second) => first.occurredAtMs - second.occurredAtMs);
  const endedAtMs = input.exploration.endedAtMs ?? null;
  const effectiveEndMs =
    endedAtMs ?? samples.at(-1)?.recordedAtMs ?? input.exploration.startedAtMs;

  return {
    version: 2,
    explorationId: input.exploration.id,
    providerId: input.providerId,
    startedAtMs: input.exploration.startedAtMs,
    endedAtMs,
    durationMs: Math.max(0, effectiveEndMs - input.exploration.startedAtMs),
    rawSampleCount: session.rawSamples.length,
    acceptedSampleCount: session.track.length,
    rejectedSampleCount: session.rejectedSamples.length,
    acceptanceRate:
      session.rawSamples.length === 0
        ? null
        : session.track.length / session.rawSamples.length,
    rejectionReasons: createRejectionSummary(session.rejectedSamples),
    sampleGapsMs: summarizeSampleGaps(gapsMs),
    horizontalAccuracyMeters:
      summarizeNumericDistribution(horizontalAccuracyMeters),
    callbacks: createCallbackSummary(events),
    markerInputMs: createMarkerInputSummary(events),
    environment: createEnvironmentSummary(events),
    lastError: findLastError(events),
    lifecycle: createLifecycle(events),
  };
}
