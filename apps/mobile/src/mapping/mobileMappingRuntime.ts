import type * as Location from "expo-location";
import type { MarkerCategory, RawPositionSample } from "@exploration-map/mapping-core";
import {
  createMappingEngine,
  type MappingEngine,
  type MappingEntityKind,
  type TrackingProviderPort,
} from "@exploration-map/mapping-engine";

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
import { locationBatchToRawSamples } from "../tracking/locationSamples";
import type {
  GnssTrackingProviderSet,
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

/**
 * Shared foreground/background observation entrypoint.
 *
 * The OS callback resolves the durable PersonalMap/ExplorationSession context,
 * then issues the same canonical engine command used by the foreground app.
 */
export async function ingestActiveLocationBatch(
  locations: readonly Location.LocationObject[],
): Promise<void> {
  if (locations.length === 0) {
    return;
  }
  const active = await getActiveTrackingContext();
  if (active === null) {
    return;
  }

  const samples = locationBatchToRawSamples(active.explorationId, locations);
  await getMobileMappingEngine().ingestPositionSamples({
    personalMapId: active.personalMapId,
    explorationId: active.explorationId,
    samples,
  });
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

export async function startNewPersonalMapExploration(
  name: string,
  mode: MobileTrackingMode,
): Promise<StartedExploration> {
  const active = await getActiveTrackingContext();
  if (active !== null) {
    throw new Error(
      "別の探索が記録中です。終了してから新しい探索を始めてください。",
    );
  }

  const engine = getMobileMappingEngine();
  const createdAtMs = Date.now();
  const { personalMapId } = await engine.createPersonalMap({
    name,
    createdAtMs,
  });
  const { explorationId } = await engine.startExploration({
    personalMapId,
    name,
    startedAtMs: createdAtMs,
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
  const active = await getActiveTrackingContext();
  if (active !== null) {
    throw new Error(
      "記録中の探索を終了してからデモ地図を作成してください。",
    );
  }

  const engine = getMobileMappingEngine();
  const startedAtMs = Date.now() - 22 * 60 * 1_000;
  const { personalMapId } = await engine.createPersonalMap({
    name: "デモ探索",
    createdAtMs: startedAtMs,
  });
  const { explorationId } = await engine.startExploration({
    personalMapId,
    name: "デモ探索",
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
