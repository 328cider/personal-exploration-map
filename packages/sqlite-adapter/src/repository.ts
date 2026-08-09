import type {
  MapMarker,
  RawPositionSample,
  ReplayExplorationInput,
} from "@exploration-map/mapping-core";
import type {
  LoadedExploration,
  MappingRepositoryPort,
  MappingRepositoryWriter,
  PersonalMapListItem,
} from "@exploration-map/mapping-engine";

import type {
  AsyncSqliteDatabaseProvider,
  AsyncSqliteExecutor,
  SqliteBindValue,
} from "./database.ts";
import {
  rowToMarker,
  rowToReplaySample,
  rowToStoredExploration,
  SqliteRawEvidenceError,
  type ExplorationRow,
  type MarkerRow,
  type PersonalMapRow,
  type PositionRow,
} from "./records.ts";
import {
  encodeSqliteRawSamplePayload,
  SQLITE_RAW_SAMPLE_PAYLOAD_FORMAT,
} from "./rawSamplePayload.ts";

interface ExplorationMapRow {
  readonly personal_map_id: string;
}

interface PersonalMapListRow {
  readonly id: string;
  readonly name: string;
  readonly updated_at: number;
  readonly exploration_count: number;
}

interface NextSampleOrdinalRow {
  readonly next_ordinal: number;
}

interface ExistingSampleRow {
  readonly raw_payload_format: string;
  readonly raw_payload_json: string | null;
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

async function requirePersonalMapId(
  database: AsyncSqliteExecutor,
  explorationId: string,
): Promise<string> {
  const row = await database.getFirstAsync<ExplorationMapRow>(
    "SELECT personal_map_id FROM explorations WHERE id = ?",
    explorationId,
  );
  if (row === null) {
    throw new Error("Exploration does not exist.");
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

function finiteProjection(value: number | undefined): number | null {
  return value !== undefined && Number.isFinite(value) ? value : null;
}

function sampleProjectionValues(
  sample: RawPositionSample,
): readonly SqliteBindValue[] {
  const position = sample.position;
  return [
    finiteProjection(sample.recordedAtMs),
    sample.source,
    position.kind,
    position.kind === "geographic"
      ? finiteProjection(position.latitude)
      : null,
    position.kind === "geographic"
      ? finiteProjection(position.longitude)
      : null,
    position.kind === "geographic"
      ? finiteProjection(position.altitudeMeters)
      : null,
    position.kind === "local" ? finiteProjection(position.xMeters) : null,
    position.kind === "local" ? finiteProjection(position.yMeters) : null,
    position.kind === "local" ? finiteProjection(position.floor) : null,
    finiteProjection(sample.horizontalAccuracyMeters),
    finiteProjection(sample.headingDegrees),
    finiteProjection(sample.speedMetersPerSecond),
    finiteProjection(sample.confidence),
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

async function nextSampleOrdinal(
  database: AsyncSqliteExecutor,
  explorationId: string,
): Promise<number> {
  const row = await database.getFirstAsync<NextSampleOrdinalRow>(
    `SELECT COALESCE(MAX(sample_ordinal), -1) + 1 AS next_ordinal
     FROM position_samples
     WHERE exploration_id = ?`,
    explorationId,
  );
  return Number(row?.next_ordinal ?? 0);
}

async function assertIdempotentExistingSample(
  database: AsyncSqliteExecutor,
  explorationId: string,
  sampleId: string,
  exactPayload: string,
): Promise<void> {
  const existing = await database.getFirstAsync<ExistingSampleRow>(
    `SELECT raw_payload_format, raw_payload_json
     FROM position_samples
     WHERE exploration_id = ? AND id = ?`,
    explorationId,
    sampleId,
  );
  if (existing === null) {
    throw new SqliteRawEvidenceError(
      "exact-payload-identity-mismatch",
      "Raw observation insertion was ignored by an unexpected constraint.",
    );
  }
  if (
    existing.raw_payload_format !== SQLITE_RAW_SAMPLE_PAYLOAD_FORMAT ||
    existing.raw_payload_json !== exactPayload
  ) {
    throw new SqliteRawEvidenceError(
      "exact-payload-identity-mismatch",
      "A raw observation identity was reused with different evidence.",
    );
  }
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

    async deletePersonalMapIfOnlyEmptyExploration(
      personalMapId,
      explorationId,
    ) {
      const result = await database.runAsync(
        `DELETE FROM personal_maps
         WHERE id = ?
           AND 1 = (
             SELECT COUNT(*)
             FROM explorations
             WHERE personal_map_id = ?
           )
           AND EXISTS (
             SELECT 1
             FROM explorations e
             WHERE e.id = ?
               AND e.personal_map_id = ?
               AND e.status = 'recording'
               AND NOT EXISTS (
                 SELECT 1 FROM position_samples p
                 WHERE p.exploration_id = e.id
               )
               AND NOT EXISTS (
                 SELECT 1 FROM markers m
                 WHERE m.exploration_id = e.id
               )
           )`,
        personalMapId,
        personalMapId,
        explorationId,
        personalMapId,
      );
      if (result.changes > 0) {
        await database.runAsync(
          `DELETE FROM app_state
           WHERE key = 'active_exploration_id' AND value = ?`,
          explorationId,
        );
        return true;
      }
      return false;
    },

    async appendPositionSamples(explorationId, samples) {
      await requirePersonalMapId(database, explorationId);
      const inserted: RawPositionSample[] = [];
      let ordinal = await nextSampleOrdinal(database, explorationId);

      for (const sample of samples) {
        const exactPayload = encodeSqliteRawSamplePayload(sample);
        const result = await database.runAsync(
          `INSERT OR IGNORE INTO position_samples(
            id,
            exploration_id,
            sample_ordinal,
            ordinal_provenance,
            raw_payload_format,
            raw_payload_json,
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
          ) VALUES (?, ?, ?, 'ingest-sequence-v1', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          sample.id,
          explorationId,
          ordinal,
          SQLITE_RAW_SAMPLE_PAYLOAD_FORMAT,
          exactPayload,
          ...sampleProjectionValues(sample),
        );
        if (result.changes > 0) {
          inserted.push(sample);
          ordinal += 1;
        } else {
          await assertIdempotentExistingSample(
            database,
            explorationId,
            sample.id,
            exactPayload,
          );
        }
      }

      const finiteTimestamps = inserted
        .map((sample) => sample.recordedAtMs)
        .filter(Number.isFinite);
      if (finiteTimestamps.length > 0) {
        await touchExplorationAndMap(
          database,
          explorationId,
          Math.max(...finiteTimestamps),
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
          throw new Error("Exploration does not exist.");
        }
        throw new Error("Exploration is already completed.");
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
     ORDER BY sample_ordinal ASC`,
    exploration.id,
  );
  const markerRows = await database.getAllAsync<MarkerRow>(
    `SELECT * FROM markers
     WHERE exploration_id = ?
     ORDER BY recorded_at ASC, id ASC`,
    exploration.id,
  );

  const samples = positionRows
    .map(rowToReplaySample)
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
 * The adapter persists exact raw payloads before SQLite numeric normalization.
 * New rows replay in provider-received ordinal order; migrated rows keep their
 * previous deterministic order with explicit legacy provenance. Derived map
 * snapshots never become authoritative.
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
