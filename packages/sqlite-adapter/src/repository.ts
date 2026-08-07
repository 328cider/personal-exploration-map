import type {
  MapMarker,
  MarkerCategory,
  PositionSource,
  RawPositionSample,
  ReplayExplorationInput,
} from "@exploration-map/mapping-core";
import type {
  LoadedExploration,
  MappingRepositoryPort,
  MappingRepositoryWriter,
  PersonalMapListItem,
  StoredExploration,
  StoredPersonalMap,
} from "@exploration-map/mapping-engine";

import type {
  AsyncSqliteDatabaseProvider,
  AsyncSqliteExecutor,
  SqliteBindValue,
} from "./database.ts";

interface PersonalMapRow {
  readonly id: string;
  readonly name: string;
  readonly created_at: number;
  readonly updated_at: number;
}

interface ExplorationRow {
  readonly id: string;
  readonly personal_map_id: string;
  readonly name: string;
  readonly status: "recording" | "completed";
  readonly tracking_provider_id: string;
  readonly tracking_mode: "background" | "foreground" | "demo" | null;
  readonly frame_hint: string | null;
  readonly started_at: number;
  readonly ended_at: number | null;
  readonly created_at: number;
  readonly updated_at: number;
}

interface PositionRow {
  readonly id: string;
  readonly recorded_at: number;
  readonly source: PositionSource;
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

interface ExplorationMapRow {
  readonly personal_map_id: string;
}

interface PersonalMapListRow {
  readonly id: string;
  readonly name: string;
  readonly updated_at: number;
  readonly exploration_count: number;
}

function legacyTrackingMode(
  providerId: string,
): "background" | "foreground" | "demo" | null {
  switch (providerId) {
    case "gnss-background":
      return "background";
    case "gnss-foreground":
      return "foreground";
    case "simulation":
      return "demo";
    default:
      return null;
  }
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

function rowToStoredExploration(row: ExplorationRow): StoredExploration {
  return {
    id: row.id,
    personalMapId: row.personal_map_id,
    name: row.name,
    startedAtMs: row.started_at,
    trackingProviderId: row.tracking_provider_id,
    ...(row.ended_at === null ? {} : { endedAtMs: row.ended_at }),
    ...(row.frame_hint === null ? {} : { localFrameLabel: row.frame_hint }),
  };
}

async function requirePersonalMapId(
  database: AsyncSqliteExecutor,
  explorationId: string,
): Promise<string> {
  const row = await database.getFirstAsync<ExplorationMapRow>(
    "SELECT personal_map_id FROM explorations WHERE id = ?",
    explorationId,
  );
  if (row === null) {
    throw new Error(`Exploration not found: ${explorationId}`);
  }
  return row.personal_map_id;
}

async function touchPersonalMap(
  database: AsyncSqliteExecutor,
  personalMapId: string,
  updatedAtMs: number,
): Promise<void> {
  await database.runAsync(
    `UPDATE personal_maps
     SET updated_at = MAX(updated_at, ?)
     WHERE id = ?`,
    updatedAtMs,
    personalMapId,
  );
}

async function touchExplorationAndMap(
  database: AsyncSqliteExecutor,
  explorationId: string,
  updatedAtMs: number,
): Promise<void> {
  const personalMapId = await requirePersonalMapId(database, explorationId);
  await database.runAsync(
    `UPDATE explorations
     SET updated_at = MAX(updated_at, ?)
     WHERE id = ?`,
    updatedAtMs,
    explorationId,
  );
  await touchPersonalMap(database, personalMapId, updatedAtMs);
}

function sampleValues(sample: RawPositionSample): readonly SqliteBindValue[] {
  const position = sample.position;
  return [
    sample.id,
    sample.recordedAtMs,
    sample.source,
    position.kind,
    position.kind === "geographic" ? position.latitude : null,
    position.kind === "geographic" ? position.longitude : null,
    position.kind === "geographic" ? position.altitudeMeters ?? null : null,
    position.kind === "local" ? position.xMeters : null,
    position.kind === "local" ? position.yMeters : null,
    position.kind === "local" ? position.floor ?? null : null,
    sample.horizontalAccuracyMeters ?? null,
    sample.headingDegrees ?? null,
    sample.speedMetersPerSecond ?? null,
    sample.confidence,
  ];
}

function markerValues(marker: MapMarker): readonly SqliteBindValue[] {
  const source = marker.sourcePosition;
  return [
    marker.id,
    marker.recordedAtMs,
    marker.category,
    marker.label,
    marker.note ?? null,
    source?.kind ?? null,
    source?.kind === "geographic" ? source.latitude : null,
    source?.kind === "geographic" ? source.longitude : null,
    source?.kind === "geographic" ? source.altitudeMeters ?? null : null,
    marker.xMeters ?? (source?.kind === "local" ? source.xMeters : null),
    marker.yMeters ?? (source?.kind === "local" ? source.yMeters : null),
    source?.kind === "local" ? source.floor ?? null : null,
  ];
}

function createWriter(database: AsyncSqliteExecutor): MappingRepositoryWriter {
  return {
    async createPersonalMap(record) {
      await database.runAsync(
        `INSERT INTO personal_maps(id, name, created_at, updated_at)
         VALUES (?, ?, ?, ?)`,
        record.id,
        record.name,
        record.createdAtMs,
        record.updatedAtMs,
      );
    },

    async createExploration(record) {
      await database.runAsync(
        `INSERT INTO explorations(
          id,
          personal_map_id,
          name,
          status,
          tracking_provider_id,
          tracking_mode,
          frame_hint,
          started_at,
          ended_at,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, 'recording', ?, ?, ?, ?, NULL, ?, ?)`,
        record.id,
        record.personalMapId,
        record.name,
        record.trackingProviderId,
        legacyTrackingMode(record.trackingProviderId),
        record.localFrameLabel ?? null,
        record.startedAtMs,
        record.startedAtMs,
        record.startedAtMs,
      );
      await touchPersonalMap(
        database,
        record.personalMapId,
        record.startedAtMs,
      );
    },

    async deleteExploration(explorationId) {
      const personalMapId = await requirePersonalMapId(database, explorationId);
      await database.runAsync(
        "DELETE FROM explorations WHERE id = ?",
        explorationId,
      );
      await database.runAsync(
        `UPDATE personal_maps
         SET updated_at = MAX(
           created_at,
           COALESCE(
             (SELECT MAX(updated_at)
              FROM explorations
              WHERE personal_map_id = ?),
             created_at
           )
         )
         WHERE id = ?`,
        personalMapId,
        personalMapId,
      );
    },

    async appendPositionSamples(explorationId, samples) {
      await requirePersonalMapId(database, explorationId);
      const inserted: RawPositionSample[] = [];
      for (const sample of samples) {
        const result = await database.runAsync(
          `INSERT OR IGNORE INTO position_samples(
            id,
            exploration_id,
            recorded_at,
            source,
            coordinate_kind,
            latitude,
            longitude,
            altitude_meters,
            x_meters,
            y_meters,
            floor_level,
            horizontal_accuracy_meters,
            heading_degrees,
            speed_meters_per_second,
            confidence
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          sample.id,
          explorationId,
          ...sampleValues(sample).slice(1),
        );
        if (result.changes > 0) {
          inserted.push(sample);
        }
      }

      if (inserted.length > 0) {
        const latestTimestamp = inserted.reduce(
          (maximum, sample) => Math.max(maximum, sample.recordedAtMs),
          0,
        );
        await touchExplorationAndMap(
          database,
          explorationId,
          latestTimestamp,
        );
      }
      return inserted;
    },

    async appendMarker(explorationId, marker) {
      await requirePersonalMapId(database, explorationId);
      const result = await database.runAsync(
        `INSERT OR IGNORE INTO markers(
          id,
          exploration_id,
          recorded_at,
          category,
          label,
          note,
          coordinate_kind,
          latitude,
          longitude,
          altitude_meters,
          x_meters,
          y_meters,
          floor_level
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        marker.id,
        explorationId,
        ...markerValues(marker).slice(1),
      );
      if (result.changes > 0) {
        await touchExplorationAndMap(
          database,
          explorationId,
          marker.recordedAtMs,
        );
        return true;
      }
      return false;
    },

    async completeExploration(explorationId, endedAtMs) {
      const result = await database.runAsync(
        `UPDATE explorations
         SET status = 'completed', ended_at = ?, updated_at = MAX(updated_at, ?)
         WHERE id = ? AND status = 'recording'`,
        endedAtMs,
        endedAtMs,
        explorationId,
      );
      if (result.changes === 0) {
        const existing = await database.getFirstAsync<{ readonly status: string }>(
          "SELECT status FROM explorations WHERE id = ?",
          explorationId,
        );
        if (existing === null) {
          throw new Error(`Exploration not found: ${explorationId}`);
        }
        throw new Error(`Exploration already completed: ${explorationId}`);
      }
      const personalMapId = await requirePersonalMapId(database, explorationId);
      await touchPersonalMap(database, personalMapId, endedAtMs);
    },
  };
}

async function loadReplay(
  database: AsyncSqliteExecutor,
  exploration: ExplorationRow,
): Promise<ReplayExplorationInput> {
  const positionRows = await database.getAllAsync<PositionRow>(
    `SELECT * FROM position_samples
     WHERE exploration_id = ?
     ORDER BY recorded_at ASC, id ASC`,
    exploration.id,
  );
  const markerRows = await database.getAllAsync<MarkerRow>(
    `SELECT * FROM markers
     WHERE exploration_id = ?
     ORDER BY recorded_at ASC, id ASC`,
    exploration.id,
  );

  const samples = positionRows
    .map(rowToSample)
    .filter((sample): sample is RawPositionSample => sample !== null);

  return {
    id: exploration.id,
    name: exploration.name,
    startedAtMs: exploration.started_at,
    ...(exploration.ended_at === null
      ? {}
      : { endedAtMs: exploration.ended_at }),
    samples,
    markers: markerRows.map(rowToMarker),
    ...(exploration.frame_hint === null
      ? {}
      : { localFrameLabel: exploration.frame_hint }),
  };
}

/**
 * Creates the local-first SQLite implementation of MappingRepositoryPort.
 *
 * The adapter persists only canonical records. Every query reconstructs replay
 * input from raw observations and confirmed markers; no derived snapshot table
 * can silently become the source of truth.
 */
export function createSqliteMappingRepository(
  getDatabase: AsyncSqliteDatabaseProvider,
): MappingRepositoryPort {
  return {
    async runInTransaction<T>(
      operation: (writer: MappingRepositoryWriter) => Promise<T>,
    ): Promise<T> {
      const database = await getDatabase();
      let completed = false;
      let result: T | undefined;
      await database.withExclusiveTransactionAsync(async (transaction) => {
        result = await operation(createWriter(transaction));
        completed = true;
      });
      if (!completed) {
        throw new Error("SQLite transaction ended without completing its operation.");
      }
      return result as T;
    },

    async loadExploration(personalMapId, explorationId) {
      const database = await getDatabase();
      const row = await database.getFirstAsync<ExplorationRow>(
        `SELECT * FROM explorations
         WHERE id = ? AND personal_map_id = ?`,
        explorationId,
        personalMapId,
      );
      if (row === null) {
        return null;
      }
      return {
        record: rowToStoredExploration(row),
        replay: await loadReplay(database, row),
      } satisfies LoadedExploration;
    },

    async loadPersonalMapReplayInput(personalMapId) {
      const database = await getDatabase();
      const map = await database.getFirstAsync<PersonalMapRow>(
        "SELECT * FROM personal_maps WHERE id = ?",
        personalMapId,
      );
      if (map === null) {
        return null;
      }

      const explorationRows = await database.getAllAsync<ExplorationRow>(
        `SELECT * FROM explorations
         WHERE personal_map_id = ?
         ORDER BY started_at ASC, id ASC`,
        personalMapId,
      );
      const explorations: ReplayExplorationInput[] = [];
      for (const exploration of explorationRows) {
        explorations.push(await loadReplay(database, exploration));
      }

      return {
        id: map.id,
        name: map.name,
        explorations,
      };
    },

    async listPersonalMaps(): Promise<readonly PersonalMapListItem[]> {
      const database = await getDatabase();
      const rows = await database.getAllAsync<PersonalMapListRow>(`
        SELECT
          pm.id,
          pm.name,
          pm.updated_at,
          COUNT(e.id) AS exploration_count
        FROM personal_maps pm
        LEFT JOIN explorations e ON e.personal_map_id = pm.id
        GROUP BY pm.id
        ORDER BY pm.updated_at DESC, pm.id ASC
      `);
      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        explorationCount: Number(row.exploration_count),
        updatedAtMs: row.updated_at,
      }));
    },
  };
}
