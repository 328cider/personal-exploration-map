import type * as Location from "expo-location";
import {
  replayExploration,
  type MarkerCategory,
  type PersonalMapSnapshot,
  type RawPositionSample,
} from "@exploration-map/mapping-core";
import {
  createMappingEngine,
  type MappingEngine,
  type MappingEntityKind,
  type PersonalMapListItem,
  type TrackingProviderPort,
} from "@exploration-map/mapping-engine";

import { recordTrackingDiagnosticBestEffort } from "../diagnostics/trackingDiagnostics";
import {
  clearActiveTrackingContext,
  getActiveTrackingContext,
  setActiveTrackingContext,
} from "../storage/activeTrackingState";
import { sqliteMappingRepository } from "../storage/sqliteMappingRepository";
import {
  BACKGROUND_GNSS_PROVIDER_ID,
  createGnssTrackingProviderSet,
  FOREGROUND_GNSS_PROVIDER_ID,
} from "../tracking/locationRecorder";
import {
  classifyLocationFreshness,
  type LocationFreshness,
} from "../tracking/locationFreshness";
import { locationBatchToRawSamples } from "../tracking/locationSamples";
import type {
  ActiveLocationRefreshReason,
  GnssTrackingProviderSet,
  MobileTrackingDelivery,
  MobileTrackingMode,
  MobileTrackingRuntimeStatus,
} from "../tracking/types";
import { createId } from "../utils/id";

const SIMULATION_PROVIDER_ID = "simulation";

let runtime:
  | {
      readonly engine: MappingEngine;
      readonly gnss: GnssTrackingProviderSet;
    }
  | undefined;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function idFactory(kind: MappingEntityKind): string {
  switch (kind) {
    case "personal-map":
      return createId("map");
    case "exploration":
      return createId("exploration");
    case "marker":
      return createId("marker");
  }
}

const simulationProvider: TrackingProviderPort = {
  id: SIMULATION_PROVIDER_ID,
  coordinateKind: "local",
  async start() {
    // Demo and deterministic replay observations are explicitly ingested by
    // the caller; no OS tracking runtime is started.
  },
  async stop() {
    // No platform resource to stop.
  },
  async status() {
    return {
      running: false,
      providerId: null,
      explorationId: null,
    };
  },
};

function ensureRuntime() {
  if (runtime !== undefined) {
    return runtime;
  }

  const gnss = createGnssTrackingProviderSet(ingestActiveLocationBatch);
  const engine = createMappingEngine({
    repository: sqliteMappingRepository,
    trackingProviders: [...gnss.providers, simulationProvider],
    idFactory,
  });
  runtime = { engine, gnss };
  return runtime;
}

export function getMobileMappingEngine(): MappingEngine {
  return ensureRuntime().engine;
}

export async function listMobilePersonalMaps(): Promise<
  readonly PersonalMapListItem[]
> {
  return getMobileMappingEngine().listPersonalMaps();
}

export async function loadMobilePersonalMap(
  personalMapId: string,
): Promise<PersonalMapSnapshot | null> {
  return getMobileMappingEngine().getPersonalMap({ personalMapId });
}

async function acceptedLocationFreshness(
  context: StartedExploration,
  nowMs = Date.now(),
): Promise<LocationFreshness> {
  const loaded = await sqliteMappingRepository.loadExploration(
    context.personalMapId,
    context.explorationId,
  );
  const latestAcceptedAtMs =
    loaded === null
      ? null
      : replayExploration(loaded.replay).track.at(-1)?.recordedAtMs ?? null;
  return classifyLocationFreshness(latestAcceptedAtMs, nowMs);
}

async function ensureFreshAcceptedLocation(
  context: StartedExploration,
  reason: ActiveLocationRefreshReason,
): Promise<LocationFreshness> {
  const before = await acceptedLocationFreshness(context);
  if (before.state === "fresh") {
    return before;
  }

  const refresh = await ensureRuntime().gnss.refreshCurrentLocation(reason);
  if (refresh.status !== "refreshed") {
    throw new Error(
      "現在位置を更新できませんでした。空が見える場所で少し待ってから再試行してください。",
    );
  }

  const after = await acceptedLocationFreshness(context);
  if (after.state !== "fresh") {
    throw new Error(
      "新しい位置を地図へ採用できませんでした。位置精度が安定してから再試行してください。",
    );
  }
  return after;
}

export async function refreshActiveLocationOnResume(
  context: StartedExploration,
): Promise<boolean> {
  try {
    const refresh = await ensureRuntime().gnss.refreshCurrentLocation(
      "app-active",
    );
    if (refresh.status !== "refreshed") {
      return false;
    }
    return (await acceptedLocationFreshness(context)).state === "fresh";
  } catch {
    return false;
  }
}

export async function prepareMarkerLocation(
  context: StartedExploration,
): Promise<void> {
  try {
    await ensureFreshAcceptedLocation(context, "marker-open");
  } catch {
    // Opening the modal stays responsive. Marker save performs the same
    // check and shows a user-facing error if the fix is still unavailable.
  }
}

/**
 * Shared foreground/background observation entrypoint.
 *
 * Callback diagnostics describe delivery and persistence, while mapping-core
 * replay remains the authority for accepted/rejected map truth.
 */
export async function ingestActiveLocationBatch(
  locations: readonly Location.LocationObject[],
  delivery: MobileTrackingDelivery,
): Promise<void> {
  if (locations.length === 0) {
    return;
  }
  const active = await getActiveTrackingContext();
  if (active === null) {
    return;
  }

  const sampleTimestamps = locations.map((location) =>
    Math.round(location.timestamp),
  );
  const firstSampleAtMs = Math.min(...sampleTimestamps);
  const lastSampleAtMs = Math.max(...sampleTimestamps);
  await recordTrackingDiagnosticBestEffort({
    context: active,
    kind: "callback.received",
    payload: {
      delivery,
      sampleCount: locations.length,
      firstSampleAtMs,
      lastSampleAtMs,
      callbackReceivedAtMs: Date.now(),
    },
  });

  const samples = locationBatchToRawSamples(active.explorationId, locations);
  try {
    const result = await getMobileMappingEngine().ingestPositionSamples({
      personalMapId: active.personalMapId,
      explorationId: active.explorationId,
      samples,
    });
    await recordTrackingDiagnosticBestEffort({
      context: active,
      kind: "callback.persisted",
      payload: {
        delivery,
        sampleCount: samples.length,
        persistedSampleCount: result.persistedSampleCount,
        duplicateSampleCount: Math.max(
          0,
          samples.length - result.persistedSampleCount,
        ),
        acceptedSampleCount: result.acceptedSampleCount,
        rejectedSampleCount: result.rejectedSampleCount,
        firstSampleAtMs,
        lastSampleAtMs,
      },
    });
  } catch (error) {
    await recordTrackingDiagnosticBestEffort({
      context: active,
      kind: "callback.failed",
      payload: {
        delivery,
        sampleCount: samples.length,
        firstSampleAtMs,
        lastSampleAtMs,
        message: errorMessage(error),
      },
    });
    throw error;
  }
}

export interface StartedExploration {
  readonly personalMapId: string;
  readonly explorationId: string;
}

function providerIdForMode(mode: MobileTrackingMode): string {
  return mode === "background"
    ? BACKGROUND_GNSS_PROVIDER_ID
    : FOREGROUND_GNSS_PROVIDER_ID;
}

async function assertNoActiveExploration(): Promise<void> {
  const active = await getActiveTrackingContext();
  if (active !== null) {
    throw new Error(
      "別の探索が記録中です。終了してから新しい探索を始めてください。",
    );
  }
}

export async function startNewPersonalMapExploration(
  name: string,
  mode: MobileTrackingMode,
): Promise<StartedExploration> {
  await assertNoActiveExploration();

  const startedAtMs = Date.now();
  return getMobileMappingEngine().createPersonalMapWithFirstExploration({
    personalMapName: name,
    explorationName: name,
    createdAtMs: startedAtMs,
    startedAtMs,
    trackingProviderId: providerIdForMode(mode),
  });
}

export async function continuePersonalMapExploration(
  personalMapId: string,
  explorationName: string,
  mode: MobileTrackingMode,
): Promise<StartedExploration> {
  await assertNoActiveExploration();

  const engine = getMobileMappingEngine();
  const existingMap = await engine.getPersonalMap({ personalMapId });
  if (existingMap === null) {
    throw new Error("続きを記録する個人地図が見つかりませんでした。");
  }
  if (existingMap.frame.kind === "local") {
    throw new Error(
      "この地図はGPSなしのローカル座標で作られています。明示的な接続方法が用意されるまで、GNSS探索を同じ地図へ追加できません。",
    );
  }

  const { explorationId } = await engine.startExploration({
    personalMapId,
    name: explorationName,
    startedAtMs: Date.now(),
    trackingProviderId: providerIdForMode(mode),
  });
  return { personalMapId, explorationId };
}

export async function addConfirmedMarker(
  context: StartedExploration,
  input: {
    readonly category: MarkerCategory;
    readonly label: string;
    readonly note?: string;
  },
): Promise<void> {
  await ensureFreshAcceptedLocation(context, "marker-save");

  await getMobileMappingEngine().addMarker({
    personalMapId: context.personalMapId,
    explorationId: context.explorationId,
    marker: {
      recordedAtMs: Date.now(),
      category: input.category,
      label: input.label,
      ...(input.note === undefined ? {} : { note: input.note }),
    },
  });
}

async function markerObservationFreshness(
  context: StartedExploration,
  occurredAtMs: number,
): Promise<{
  readonly latestObservationAgeMs: number | null;
  readonly latestObservationMissing: boolean;
  readonly latestObservationFuture: boolean;
}> {
  try {
    const freshness = await acceptedLocationFreshness(context, occurredAtMs);
    if (freshness.state === "missing") {
      return {
        latestObservationAgeMs: null,
        latestObservationMissing: true,
        latestObservationFuture: false,
      };
    }
    if (freshness.state === "future") {
      return {
        latestObservationAgeMs: null,
        latestObservationMissing: false,
        latestObservationFuture: true,
      };
    }
    return {
      latestObservationAgeMs: freshness.ageMs,
      latestObservationMissing: false,
      latestObservationFuture: false,
    };
  } catch {
    // Diagnostics are non-canonical. A read failure must not block marker save
    // or expose private repository details through an operational message.
    return {
      latestObservationAgeMs: null,
      latestObservationMissing: true,
      latestObservationFuture: false,
    };
  }
}

export async function recordMarkerInputTiming(
  context: StartedExploration,
  outcome: "completed" | "cancelled",
  durationMs: number,
): Promise<void> {
  const active = await getActiveTrackingContext();
  if (
    active === null ||
    active.personalMapId !== context.personalMapId ||
    active.explorationId !== context.explorationId
  ) {
    return;
  }

  const occurredAtMs = Date.now();
  const freshness =
    outcome === "completed"
      ? await markerObservationFreshness(context, occurredAtMs)
      : null;
  await recordTrackingDiagnosticBestEffort({
    context: active,
    kind:
      outcome === "completed"
        ? "marker.input.completed"
        : "marker.input.cancelled",
    occurredAtMs,
    payload: {
      durationMs: Math.max(0, durationMs),
      ...(freshness === null ? {} : freshness),
    },
  });
}

export async function endActiveExploration(
  context: StartedExploration,
): Promise<void> {
  const activeBeforeStop = await getActiveTrackingContext();
  try {
    await getMobileMappingEngine().endExploration({
      personalMapId: context.personalMapId,
      explorationId: context.explorationId,
      endedAtMs: Date.now(),
    });
    await clearActiveTrackingContext(context.explorationId);
  } catch (error) {
    // A provider stop may clear the platform context before the repository
    // completion transaction runs. Restore the same still-recording context if
    // completion fails so the user can recover instead of losing the session.
    if (
      activeBeforeStop !== null &&
      activeBeforeStop.explorationId === context.explorationId
    ) {
      await setActiveTrackingContext(activeBeforeStop).catch(() => undefined);
    }
    throw error;
  }
}

export async function getMobileTrackingStatus(): Promise<MobileTrackingRuntimeStatus> {
  return ensureRuntime().gnss.status();
}

export async function stopOrphanedMobileTracking(): Promise<void> {
  await ensureRuntime().gnss.stopOrphanedTracking();
}

function demoSamples(
  explorationId: string,
  startedAtMs: number,
): readonly RawPositionSample[] {
  const points = [
    [0, 0],
    [0, 22],
    [14, 22],
    [27, 28],
    [38, 28],
    [38, 7],
    [53, 7],
    [63, 19],
    [75, 19],
  ] as const;

  return points.map(([xMeters, yMeters], index) => ({
    id: `demo-${explorationId}-${index}`,
    recordedAtMs: startedAtMs + index * 2 * 60 * 1_000,
    source: "simulation" as const,
    position: {
      kind: "local" as const,
      xMeters,
      yMeters,
    },
    confidence: 1,
  }));
}

export async function createDemoPersonalMap(): Promise<StartedExploration> {
  await assertNoActiveExploration();

  const engine = getMobileMappingEngine();
  const startedAtMs = Date.now() - 22 * 60 * 1_000;
  const { personalMapId, explorationId } =
    await engine.createPersonalMapWithFirstExploration({
      personalMapName: "デモ探索",
      explorationName: "デモ探索",
      createdAtMs: startedAtMs,
      startedAtMs,
      trackingProviderId: SIMULATION_PROVIDER_ID,
      localFrameLabel: "demo-local-space",
    });

  await engine.ingestPositionSamples({
    personalMapId,
    explorationId,
    samples: demoSamples(explorationId, startedAtMs),
  });
  await engine.addMarker({
    personalMapId,
    explorationId,
    marker: {
      recordedAtMs: startedAtMs + 10 * 60 * 1_000,
      category: "interesting",
      label: "気になる場所",
      note: "必要な時だけ残す短い発見メモ",
      sourcePosition: {
        kind: "local",
        xMeters: 38,
        yMeters: 28,
      },
    },
  });
  await engine.endExploration({
    personalMapId,
    explorationId,
    endedAtMs: Date.now(),
  });

  return { personalMapId, explorationId };
}
