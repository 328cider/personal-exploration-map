import type * as Location from "expo-location";
import {
  createMapSnapshot,
  replayExploration,
  type MapMarker,
  type MapSnapshot,
  type MarkerCategory,
  type RawPositionSample,
} from "@exploration-map/mapping-core";

import { createId } from "../utils/id";
import { getDatabase } from "./database";

export type TrackingMode = "background" | "foreground" | "demo";

export interface ExplorationSummary {
  readonly id: string;
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
  id: string;
  personal_map_id: string;
  name: string;
  status: "recording" | "completed";
  tracking_provider_id: string;
  tracking_mode: TrackingMode | null;
  frame_hint: string | null;
  started_at: number;
  ended_at: number | null;
}

interface SummaryRow extends ExplorationRow {
  raw_sample_count: number;
  marker_count: number;
}

interface PositionRow {
  id: string;
  recorded_at: number;
  source: RawPositionSample["source"];
  coordinate_kind: "geographic" | "local";
  latitude: number | null;
  longitude: number | null;
  altitude_meters: number | null;
  x_meters: number | null;
  y_meters: number | null;
  floor_level: number | null;
  horizontal_accuracy_meters: number | null;
  heading_degrees: number | null;
  speed_meters_per_second: number | null;
  confidence: number;
}

interface MarkerRow {
  id: string;
  recorded_at: number;
  category: MarkerCategory;
  label: string;
  note: string | null;
  coordinate_kind: "geographic" | "local" | null;
  latitude: number | null;
  longitude: number | null;
  altitude_meters: number | null;
  x_meters: number | null;
  y_meters: number | null;
  floor_level: number | null;
}

function confidenceFromAccuracy(accuracy: number | null): number {
  if (accuracy === null || !Number.isFinite(accuracy)) {
    return 0.5;
  }
  if (accuracy <= 5) {
    return 0.95;
  }
  if (accuracy >= 100) {
    return 0.1;
  }
  return Math.max(0.1, Math.min(0.95, 1 - accuracy / 120));
}

function trackingProviderIdForMode(mode: TrackingMode): string {
  switch (mode) {
    case "background":
      return "gnss-background";
    case "foreground":
      return "gnss-foreground";
    case "demo":
      return "simulation";
  }
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

function observationId(
  explorationId: string,
  location: Location.LocationObject,
): string {
  return `position-${explorationId}-${Math.round(location.timestamp)}-gnss`;
}

async function setStateValue(key: string, value: string | null): Promise<void> {
  const database = await getDatabase();
  if (value === null) {
    await database.runAsync("DELETE FROM app_state WHERE key = ?", key);
    return;
  }
  await database.runAsync(
    `INSERT INTO app_state(key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    key,
    value,
  );
}

async function getStateValue(key: string): Promise<string | null> {
  const database = await getDatabase();
  const row = await database.getFirstAsync<{ value: string | null }>(
    "SELECT value FROM app_state WHERE key = ?",
    key,
  );
  return row?.value ?? null;
}

export async function createExploration(
  name: string,
  trackingMode: TrackingMode,
): Promise<string> {
  const database = await getDatabase();
  const activeId = await getStateValue("active_exploration_id");
  if (activeId !== null) {
    throw new Error(
      "別の探索が記録中です。終了してから新しい探索を始めてください。",
    );
  }

  const id = createId("exploration");
  const now = Date.now();

  await database.withExclusiveTransactionAsync(async (transaction) => {
    await transaction.runAsync(
      `INSERT INTO personal_maps(id, name, created_at, updated_at)
       VALUES (?, ?, ?, ?)`,
      id,
      name,
      now,
      now,
    );
    await transaction.runAsync(
      `INSERT INTO explorations(
        id, personal_map_id, name, status,
        tracking_provider_id, tracking_mode, frame_hint,
        started_at, ended_at, created_at, updated_at
      ) VALUES (?, ?, ?, 'recording', ?, ?, NULL, ?, NULL, ?, ?)`,
      id,
      id,
      name,
      trackingProviderIdForMode(trackingMode),
      trackingMode,
      now,
      now,
      now,
    );
    await transaction.runAsync(
      `INSERT INTO app_state(key, value) VALUES ('active_exploration_id', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      id,
    );
  });

  return id;
}

export async function deleteExploration(id: string): Promise<void> {
  const database = await getDatabase();
  const activeId = await getStateValue("active_exploration_id");
  await database.withExclusiveTransactionAsync(async (transaction) => {
    const row = await transaction.getFirstAsync<{ personal_map_id: string }>(
      "SELECT personal_map_id FROM explorations WHERE id = ?",
      id,
    );
    await transaction.runAsync("DELETE FROM explorations WHERE id = ?", id);
    if (row !== null) {
      await transaction.runAsync(
        `DELETE FROM personal_maps
         WHERE id = ?
           AND NOT EXISTS (
             SELECT 1 FROM explorations WHERE personal_map_id = ?
           )`,
        row.personal_map_id,
        row.personal_map_id,
      );
    }
    if (activeId === id) {
      await transaction.runAsync(
        "DELETE FROM app_state WHERE key = 'active_exploration_id'",
      );
    }
  });
}

export async function getActiveExploration(): Promise<ExplorationSummary | null> {
  const activeId = await getStateValue("active_exploration_id");
  if (activeId === null) {
    return null;
  }
  return getExplorationSummary(activeId);
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

function toSummary(row: SummaryRow): ExplorationSummary {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    trackingMode: trackingModeFromRow(row),
    startedAtMs: row.started_at,
    endedAtMs: row.ended_at,
    rawSampleCount: Number(row.raw_sample_count),
    markerCount: Number(row.marker_count),
  };
}

export async function appendLocationBatch(
  locations: readonly Location.LocationObject[],
): Promise<void> {
  if (locations.length === 0) {
    return;
  }

  const activeId = await getStateValue("active_exploration_id");
  if (activeId === null) {
    return;
  }

  const database = await getDatabase();
  await database.withExclusiveTransactionAsync(async (transaction) => {
    let latestInsertedAt = 0;
    for (const location of locations) {
      const accuracy = location.coords.accuracy;
      const recordedAtMs = Math.round(location.timestamp);
      const result = await transaction.runAsync(
        `INSERT OR IGNORE INTO position_samples(
          id, exploration_id, recorded_at, source, coordinate_kind,
          latitude, longitude, altitude_meters, x_meters, y_meters, floor_level,
          horizontal_accuracy_meters, heading_degrees, speed_meters_per_second,
          confidence
        ) VALUES (?, ?, ?, 'gnss', 'geographic', ?, ?, ?, NULL, NULL, NULL, ?, ?, ?, ?)`,
        observationId(activeId, location),
        activeId,
        recordedAtMs,
        location.coords.latitude,
        location.coords.longitude,
        location.coords.altitude,
        accuracy,
        location.coords.heading,
        location.coords.speed,
        confidenceFromAccuracy(accuracy),
      );
      if (result.changes > 0) {
        latestInsertedAt = Math.max(latestInsertedAt, recordedAtMs);
      }
    }
    if (latestInsertedAt > 0) {
      await transaction.runAsync(
        `UPDATE explorations
         SET updated_at = MAX(updated_at, ?)
         WHERE id = ?`,
        latestInsertedAt,
        activeId,
      );
      await transaction.runAsync(
        `UPDATE personal_maps
         SET updated_at = MAX(updated_at, ?)
         WHERE id = (
           SELECT personal_map_id FROM explorations WHERE id = ?
         )`,
        latestInsertedAt,
        activeId,
      );
    }
  });
}

export async function getLiveExplorationStats(
  explorationId: string,
): Promise<LiveExplorationStats> {
  const database = await getDatabase();
  const counts = await database.getFirstAsync<{
    raw_sample_count: number;
    marker_count: number;
  }>(
    `SELECT
      (SELECT COUNT(*) FROM position_samples WHERE exploration_id = ?) AS raw_sample_count,
      (SELECT COUNT(*) FROM markers WHERE exploration_id = ?) AS marker_count`,
    explorationId,
    explorationId,
  );
  const latest = await database.getFirstAsync<{
    horizontal_accuracy_meters: number | null;
    recorded_at: number;
  }>(
    `SELECT horizontal_accuracy_meters, recorded_at
     FROM position_samples
     WHERE exploration_id = ?
     ORDER BY recorded_at DESC
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

export interface AddMarkerInput {
  readonly category: MarkerCategory;
  readonly label: string;
  readonly note?: string;
}

export async function addMarkerToExploration(
  explorationId: string,
  input: AddMarkerInput,
): Promise<void> {
  const database = await getDatabase();
  const recordedAtMs = Date.now();
  await database.withExclusiveTransactionAsync(async (transaction) => {
    const latest = await transaction.getFirstAsync<PositionRow>(
      `SELECT * FROM position_samples
       WHERE exploration_id = ? AND recorded_at <= ?
       ORDER BY recorded_at DESC
       LIMIT 1`,
      explorationId,
      recordedAtMs,
    );

    await transaction.runAsync(
      `INSERT INTO markers(
        id, exploration_id, recorded_at, category, label, note,
        coordinate_kind, latitude, longitude, altitude_meters,
        x_meters, y_meters, floor_level
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      createId("marker"),
      explorationId,
      recordedAtMs,
      input.category,
      input.label,
      input.note ?? null,
      latest?.coordinate_kind ?? null,
      latest?.latitude ?? null,
      latest?.longitude ?? null,
      latest?.altitude_meters ?? null,
      latest?.x_meters ?? null,
      latest?.y_meters ?? null,
      latest?.floor_level ?? null,
    );
    await transaction.runAsync(
      `UPDATE explorations
       SET updated_at = MAX(updated_at, ?)
       WHERE id = ?`,
      recordedAtMs,
      explorationId,
    );
    await transaction.runAsync(
      `UPDATE personal_maps
       SET updated_at = MAX(updated_at, ?)
       WHERE id = (
         SELECT personal_map_id FROM explorations WHERE id = ?
       )`,
      recordedAtMs,
      explorationId,
    );
  });
}

export async function completeExploration(id: string): Promise<void> {
  const database = await getDatabase();
  const activeId = await getStateValue("active_exploration_id");
  const now = Date.now();
  await database.withExclusiveTransactionAsync(async (transaction) => {
    await transaction.runAsync(
      `UPDATE explorations
       SET status = 'completed', ended_at = ?, updated_at = MAX(updated_at, ?)
       WHERE id = ?`,
      now,
      now,
      id,
    );
    await transaction.runAsync(
      `UPDATE personal_maps
       SET updated_at = MAX(updated_at, ?)
       WHERE id = (
         SELECT personal_map_id FROM explorations WHERE id = ?
       )`,
      now,
      id,
    );
    if (activeId === id) {
      await transaction.runAsync(
        "DELETE FROM app_state WHERE key = 'active_exploration_id'",
      );
    }
  });
}

export async function recordBackgroundTaskError(message: string): Promise<void> {
  await setStateValue("last_background_error", message.slice(0, 1000));
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
     ORDER BY recorded_at ASC`,
    explorationId,
  );
  const markerRows = await database.getAllAsync<MarkerRow>(
    `SELECT * FROM markers
     WHERE exploration_id = ?
     ORDER BY recorded_at ASC`,
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

export async function createDemoExploration(): Promise<string> {
  const database = await getDatabase();
  const id = createId("demo");
  const startedAtMs = Date.now() - 22 * 60 * 1000;
  const endedAtMs = Date.now();
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

  await database.withExclusiveTransactionAsync(async (transaction) => {
    await transaction.runAsync(
      `INSERT INTO personal_maps(id, name, created_at, updated_at)
       VALUES (?, 'デモ探索', ?, ?)`,
      id,
      startedAtMs,
      endedAtMs,
    );
    await transaction.runAsync(
      `INSERT INTO explorations(
        id, personal_map_id, name, status,
        tracking_provider_id, tracking_mode, frame_hint,
        started_at, ended_at, created_at, updated_at
      ) VALUES (?, ?, 'デモ探索', 'completed',
        'simulation', 'demo', 'demo-local-space', ?, ?, ?, ?)`,
      id,
      id,
      startedAtMs,
      endedAtMs,
      startedAtMs,
      endedAtMs,
    );

    for (const [index, [xMeters, yMeters]] of points.entries()) {
      await transaction.runAsync(
        `INSERT INTO position_samples(
          id, exploration_id, recorded_at, source, coordinate_kind,
          latitude, longitude, altitude_meters, x_meters, y_meters, floor_level,
          horizontal_accuracy_meters, heading_degrees, speed_meters_per_second,
          confidence
        ) VALUES (?, ?, ?, 'simulation', 'local', NULL, NULL, NULL, ?, ?, NULL, NULL, NULL, NULL, 1)`,
        createId("demo-position"),
        id,
        startedAtMs + index * 2 * 60 * 1000,
        xMeters,
        yMeters,
      );
    }

    await transaction.runAsync(
      `INSERT INTO markers(
        id, exploration_id, recorded_at, category, label, note,
        coordinate_kind, latitude, longitude, altitude_meters,
        x_meters, y_meters, floor_level
      ) VALUES (?, ?, ?, 'interesting', '気になる場所', '必要な時だけ残す短い発見メモ',
        'local', NULL, NULL, NULL, 38, 28, NULL)`,
      createId("demo-marker"),
      id,
      startedAtMs + 10 * 60 * 1000,
    );
  });

  return id;
}
