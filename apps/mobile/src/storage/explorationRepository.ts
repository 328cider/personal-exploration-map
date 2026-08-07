import {
  createMapSnapshot,
  replayExploration,
  type MapMarker,
  type MapSnapshot,
  type MarkerCategory,
  type RawPositionSample,
} from "@exploration-map/mapping-core";

import { getActiveTrackingContext } from "./activeTrackingState";
import { getDatabase } from "./database";

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

interface PositionRow {
  readonly id: string;
  readonly recorded_at: number;
  readonly source: RawPositionSample["source"];
  readonly coordinate_kind: "geographic" | "local";
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly altitude_meters: number | null;
  readonly x_meters: number | null;
  readonly y_meters: number | null;
  readonly floor_level: number | null;
  readonly horizontal_accuracy_meters: number | null;
  readonly heading_degrees: number | null;
  readonly speed_meters_per_second: number | null;
  readonly confidence: number;
}

interface MarkerRow {
  readonly id: string;
  readonly recorded_at: number;
  readonly category: MarkerCategory;
  readonly label: string;
  readonly note: string | null;
  readonly coordinate_kind: "geographic" | "local" | null;
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly altitude_meters: number | null;
  readonly x_meters: number | null;
  readonly y_meters: number | null;
  readonly floor_level: number | null;
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
    readonly recorded_at: number;
  }>(
    `SELECT horizontal_accuracy_meters, recorded_at
     FROM position_samples
     WHERE exploration_id = ?
     ORDER BY recorded_at DESC, id DESC
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

function rowToSample(row: PositionRow): RawPositionSample | null {
  const shared = {
    id: row.id,
    recordedAtMs: row.recorded_at,
    source: row.source,
    confidence: row.confidence,
    ...(row.horizontal_accuracy_meters === null
      ? {}
      : { horizontalAccuracyMeters: row.horizontal_accuracy_meters }),
    ...(row.heading_degrees === null
      ? {}
      : { headingDegrees: row.heading_degrees }),
    ...(row.speed_meters_per_second === null
      ? {}
      : { speedMetersPerSecond: row.speed_meters_per_second }),
  };

  if (
    row.coordinate_kind === "geographic" &&
    row.latitude !== null &&
    row.longitude !== null
  ) {
    return {
      ...shared,
      position: {
        kind: "geographic",
        latitude: row.latitude,
        longitude: row.longitude,
        ...(row.altitude_meters === null
          ? {}
          : { altitudeMeters: row.altitude_meters }),
      },
    };
  }

  if (
    row.coordinate_kind === "local" &&
    row.x_meters !== null &&
    row.y_meters !== null
  ) {
    return {
      ...shared,
      position: {
        kind: "local",
        xMeters: row.x_meters,
        yMeters: row.y_meters,
        ...(row.floor_level === null ? {} : { floor: row.floor_level }),
      },
    };
  }

  return null;
}

function rowToMarker(row: MarkerRow): MapMarker {
  const sourcePosition =
    row.coordinate_kind === "geographic" &&
    row.latitude !== null &&
    row.longitude !== null
      ? {
          kind: "geographic" as const,
          latitude: row.latitude,
          longitude: row.longitude,
          ...(row.altitude_meters === null
            ? {}
            : { altitudeMeters: row.altitude_meters }),
        }
      : row.coordinate_kind === "local" &&
          row.x_meters !== null &&
          row.y_meters !== null
        ? {
            kind: "local" as const,
            xMeters: row.x_meters,
            yMeters: row.y_meters,
            ...(row.floor_level === null ? {} : { floor: row.floor_level }),
          }
        : undefined;

  return {
    id: row.id,
    recordedAtMs: row.recorded_at,
    category: row.category,
    label: row.label,
    ...(row.note === null ? {} : { note: row.note }),
    ...(sourcePosition === undefined ? {} : { sourcePosition }),
    ...(row.x_meters === null ? {} : { xMeters: row.x_meters }),
    ...(row.y_meters === null ? {} : { yMeters: row.y_meters }),
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

  const positionRows = await database.getAllAsync<PositionRow>(
    `SELECT * FROM position_samples
     WHERE exploration_id = ?
     ORDER BY recorded_at ASC, id ASC`,
    explorationId,
  );
  const markerRows = await database.getAllAsync<MarkerRow>(
    `SELECT * FROM markers
     WHERE exploration_id = ?
     ORDER BY recorded_at ASC, id ASC`,
    explorationId,
  );

  const samples = positionRows
    .map(rowToSample)
    .filter((sample): sample is RawPositionSample => sample !== null);
  const markers = markerRows.map(rowToMarker);
  const session = replayExploration({
    id: exploration.id,
    name: exploration.name,
    startedAtMs: exploration.started_at,
    ...(exploration.ended_at === null
      ? {}
      : { endedAtMs: exploration.ended_at }),
    samples,
    markers,
    ...(exploration.frame_hint === null
      ? {}
      : { localFrameLabel: exploration.frame_hint }),
  });
  return createMapSnapshot(session, { simplifyToleranceMeters: 1.5 });
}
