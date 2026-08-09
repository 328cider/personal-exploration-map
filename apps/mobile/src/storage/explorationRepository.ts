import {
  createMapSnapshot,
  replayExploration,
  type MapSnapshot,
} from "@exploration-map/mapping-core";

import { getActiveTrackingContext } from "./activeTrackingState";
import { getDatabase } from "./database";
import { sqliteMappingRepository } from "./sqliteMappingRepository";

export type TrackingMode = "background" | "foreground" | "demo";

export interface ExplorationSummary {
  readonly id: string;
  readonly personalMapId: string;
  readonly name: string;
  readonly status: "recording" | "completed";
  readonly trackingMode: TrackingMode;
  readonly startedAtMs: number;
  readonly endedAtMs: number | null;
  readonly rawSampleCount: number;
  readonly markerCount: number;
}

export interface LiveExplorationStats {
  readonly rawSampleCount: number;
  readonly markerCount: number;
  readonly latestAccuracyMeters: number | null;
  readonly latestRecordedAtMs: number | null;
}

interface ExplorationRow {
  readonly id: string;
  readonly personal_map_id: string;
  readonly name: string;
  readonly status: "recording" | "completed";
  readonly tracking_provider_id: string;
  readonly tracking_mode: TrackingMode | null;
  readonly frame_hint: string | null;
  readonly started_at: number;
  readonly ended_at: number | null;
}

interface SummaryRow extends ExplorationRow {
  readonly raw_sample_count: number;
  readonly marker_count: number;
}

function trackingModeFromRow(row: ExplorationRow): TrackingMode {
  if (row.tracking_mode !== null) {
    return row.tracking_mode;
  }
  switch (row.tracking_provider_id) {
    case "gnss-background":
      return "background";
    case "simulation":
      return "demo";
    default:
      return "foreground";
  }
}

function toSummary(row: SummaryRow): ExplorationSummary {
  return {
    id: row.id,
    personalMapId: row.personal_map_id,
    name: row.name,
    status: row.status,
    trackingMode: trackingModeFromRow(row),
    startedAtMs: row.started_at,
    endedAtMs: row.ended_at,
    rawSampleCount: Number(row.raw_sample_count),
    markerCount: Number(row.marker_count),
  };
}

export async function getActiveExploration(): Promise<ExplorationSummary | null> {
  const active = await getActiveTrackingContext();
  if (active === null) {
    return null;
  }
  return getExplorationSummary(active.explorationId);
}

export async function listExplorations(): Promise<readonly ExplorationSummary[]> {
  const database = await getDatabase();
  const rows = await database.getAllAsync<SummaryRow>(`
    SELECT
      e.id,
      e.personal_map_id,
      e.name,
      e.status,
      e.tracking_provider_id,
      e.tracking_mode,
      e.frame_hint,
      e.started_at,
      e.ended_at,
      COUNT(DISTINCT p.id) AS raw_sample_count,
      COUNT(DISTINCT m.id) AS marker_count
    FROM explorations e
    LEFT JOIN position_samples p ON p.exploration_id = e.id
    LEFT JOIN markers m ON m.exploration_id = e.id
    GROUP BY e.id
    ORDER BY e.started_at DESC
    LIMIT 30
  `);
  return rows.map(toSummary);
}

export async function getExplorationSummary(
  id: string,
): Promise<ExplorationSummary | null> {
  const database = await getDatabase();
  const row = await database.getFirstAsync<SummaryRow>(
    `SELECT
      e.id,
      e.personal_map_id,
      e.name,
      e.status,
      e.tracking_provider_id,
      e.tracking_mode,
      e.frame_hint,
      e.started_at,
      e.ended_at,
      COUNT(DISTINCT p.id) AS raw_sample_count,
      COUNT(DISTINCT m.id) AS marker_count
    FROM explorations e
    LEFT JOIN position_samples p ON p.exploration_id = e.id
    LEFT JOIN markers m ON m.exploration_id = e.id
    WHERE e.id = ?
    GROUP BY e.id`,
    id,
  );
  return row === null ? null : toSummary(row);
}

export async function getLiveExplorationStats(
  explorationId: string,
): Promise<LiveExplorationStats> {
  const database = await getDatabase();
  const counts = await database.getFirstAsync<{
    readonly raw_sample_count: number;
    readonly marker_count: number;
  }>(
    `SELECT
      (SELECT COUNT(*) FROM position_samples WHERE exploration_id = ?) AS raw_sample_count,
      (SELECT COUNT(*) FROM markers WHERE exploration_id = ?) AS marker_count`,
    explorationId,
    explorationId,
  );
  const latest = await database.getFirstAsync<{
    readonly horizontal_accuracy_meters: number | null;
    readonly recorded_at: number | null;
  }>(
    `SELECT horizontal_accuracy_meters, recorded_at
     FROM position_samples
     WHERE exploration_id = ?
     ORDER BY sample_ordinal DESC
     LIMIT 1`,
    explorationId,
  );

  return {
    rawSampleCount: Number(counts?.raw_sample_count ?? 0),
    markerCount: Number(counts?.marker_count ?? 0),
    latestAccuracyMeters: latest?.horizontal_accuracy_meters ?? null,
    latestRecordedAtMs: latest?.recorded_at ?? null,
  };
}

export async function loadExplorationMap(
  explorationId: string,
): Promise<MapSnapshot | null> {
  const database = await getDatabase();
  const exploration = await database.getFirstAsync<ExplorationRow>(
    "SELECT * FROM explorations WHERE id = ?",
    explorationId,
  );
  if (exploration === null) {
    return null;
  }

  // Reuse the canonical repository decoder so foreground review and the
  // mapping engine restore exact raw payloads in the same persisted order.
  const loaded = await sqliteMappingRepository.loadExploration(
    exploration.personal_map_id,
    explorationId,
  );
  if (loaded === null) {
    return null;
  }
  return createMapSnapshot(replayExploration(loaded.replay), {
    simplifyToleranceMeters: 1.5,
  });
}
