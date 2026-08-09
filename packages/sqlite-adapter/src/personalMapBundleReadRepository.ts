import {
  createPersonalMapSnapshot,
  type MapFrame,
  type MapMarker,
  type RawPositionSample,
  type ReplayExplorationInput,
} from "@exploration-map/mapping-core";
import type {
  PersonalMapBundleMarkerGroup,
  PersonalMapBundleRawSampleGroup,
  PersonalMapBundleReadRepositoryPort,
  PersonalMapBundleReadSnapshotPort,
  StoredExploration,
  StoredPersonalMap,
} from "@exploration-map/mapping-engine";

import type {
  AsyncSqliteDatabaseProvider,
  AsyncSqliteExecutor,
} from "./database.ts";
import {
  rowToExactSample,
  rowToMarker,
  rowToStoredExploration,
  rowToStoredPersonalMap,
  type ExplorationRow,
  type MarkerRow,
  type PersonalMapRow,
  type PositionRow,
} from "./records.ts";

function identityBatchKey(values: readonly string[]): string {
  return values.map((value) => `${value.length}:${value}`).join("");
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}

class SqlitePersonalMapBundleSnapshotReader
  implements PersonalMapBundleReadSnapshotPort
{
  private readonly maps = new Map<string, StoredPersonalMap | null>();
  private readonly explorations = new Map<
    string,
    readonly StoredExploration[]
  >();
  private readonly rawGroups = new Map<
    string,
    readonly PersonalMapBundleRawSampleGroup[]
  >();
  private readonly markerGroups = new Map<
    string,
    readonly PersonalMapBundleMarkerGroup[]
  >();
  private readonly frames = new Map<string, MapFrame>();

  constructor(private readonly database: AsyncSqliteExecutor) {}

  async loadPersonalMapRecord(
    personalMapId: string,
  ): Promise<StoredPersonalMap | null> {
    if (this.maps.has(personalMapId)) {
      return this.maps.get(personalMapId) ?? null;
    }
    const row = await this.database.getFirstAsync<PersonalMapRow>(
      "SELECT * FROM personal_maps WHERE id = ?",
      personalMapId,
    );
    const record = row === null ? null : rowToStoredPersonalMap(row);
    this.maps.set(personalMapId, record);
    return record;
  }

  async listExplorationRecords(
    personalMapId: string,
  ): Promise<readonly StoredExploration[]> {
    const cached = this.explorations.get(personalMapId);
    if (cached !== undefined) {
      return cached;
    }
    const rows = await this.database.getAllAsync<ExplorationRow>(
      `SELECT * FROM explorations
       WHERE personal_map_id = ?
       ORDER BY started_at ASC, id ASC`,
      personalMapId,
    );
    const records = rows.map(rowToStoredExploration);
    this.explorations.set(personalMapId, records);
    return records;
  }

  async loadRawSampleGroups(
    explorationIds: readonly string[],
  ): Promise<readonly PersonalMapBundleRawSampleGroup[]> {
    const key = identityBatchKey(explorationIds);
    const cached = this.rawGroups.get(key);
    if (cached !== undefined) {
      return cached;
    }
    if (explorationIds.length === 0) {
      const empty: readonly PersonalMapBundleRawSampleGroup[] = [];
      this.rawGroups.set(key, empty);
      return empty;
    }

    const byExploration = new Map<string, RawPositionSample[]>(
      explorationIds.map(
        (explorationId): [string, RawPositionSample[]] => [
          explorationId,
          [],
        ],
      ),
    );
    const rows = await this.database.getAllAsync<PositionRow>(
      `SELECT * FROM position_samples
       WHERE exploration_id IN (${placeholders(explorationIds.length)})
       ORDER BY exploration_id ASC, sample_ordinal ASC`,
      ...explorationIds,
    );
    for (const row of rows) {
      const samples = byExploration.get(row.exploration_id);
      if (samples === undefined) {
        throw new Error(
          "SQLite returned raw observations for an unrequested exploration.",
        );
      }
      samples.push(rowToExactSample(row));
    }

    const groups = explorationIds.map((explorationId) => ({
      explorationId,
      samples: byExploration.get(explorationId)!,
    }));
    this.rawGroups.set(key, groups);
    return groups;
  }

  async loadMarkerGroups(
    explorationIds: readonly string[],
  ): Promise<readonly PersonalMapBundleMarkerGroup[]> {
    const key = identityBatchKey(explorationIds);
    const cached = this.markerGroups.get(key);
    if (cached !== undefined) {
      return cached;
    }
    if (explorationIds.length === 0) {
      const empty: readonly PersonalMapBundleMarkerGroup[] = [];
      this.markerGroups.set(key, empty);
      return empty;
    }

    const byExploration = new Map<string, MapMarker[]>(
      explorationIds.map(
        (explorationId): [string, MapMarker[]] => [explorationId, []],
      ),
    );
    const rows = await this.database.getAllAsync<MarkerRow>(
      `SELECT * FROM markers
       WHERE exploration_id IN (${placeholders(explorationIds.length)})
       ORDER BY exploration_id ASC, recorded_at ASC, id ASC`,
      ...explorationIds,
    );
    for (const row of rows) {
      const markers = byExploration.get(row.exploration_id);
      if (markers === undefined) {
        throw new Error(
          "SQLite returned markers for an unrequested exploration.",
        );
      }
      markers.push(rowToMarker(row));
    }

    const groups = explorationIds.map((explorationId) => ({
      explorationId,
      markers: byExploration.get(explorationId)!,
    }));
    this.markerGroups.set(key, groups);
    return groups;
  }

  async loadFrameAtExport(personalMapId: string): Promise<MapFrame> {
    const cached = this.frames.get(personalMapId);
    if (cached !== undefined) {
      return cached;
    }
    const map = await this.loadPersonalMapRecord(personalMapId);
    if (map === null) {
      throw new Error("PersonalMap does not exist.");
    }
    const explorations = await this.listExplorationRecords(personalMapId);
    const explorationIds = explorations.map((record) => record.id);
    const rawGroups = await this.loadRawSampleGroups(explorationIds);
    const markerGroups = await this.loadMarkerGroups(explorationIds);
    const rawByExploration = new Map<
      string,
      readonly RawPositionSample[]
    >(
      rawGroups.map((group) => [group.explorationId, group.samples] as const),
    );
    const markersByExploration = new Map<string, readonly MapMarker[]>(
      markerGroups.map(
        (group) => [group.explorationId, group.markers] as const,
      ),
    );
    const replayInputs: ReplayExplorationInput[] = explorations.map(
      (record) => ({
        id: record.id,
        name: record.name,
        startedAtMs: record.startedAtMs,
        ...(record.endedAtMs === undefined
          ? {}
          : { endedAtMs: record.endedAtMs }),
        samples: rawByExploration.get(record.id)!,
        markers: markersByExploration.get(record.id)!,
        ...(record.localFrameLabel === undefined
          ? {}
          : { localFrameLabel: record.localFrameLabel }),
      }),
    );
    const frame = createPersonalMapSnapshot({
      id: map.id,
      name: map.name,
      explorations: replayInputs,
    }).frame;
    this.frames.set(personalMapId, frame);
    return frame;
  }
}

/**
 * Creates the SQLite implementation of the lossless bundle read contract.
 *
 * Every query executes sequentially inside one serialized read transaction.
 * Legacy normalized rows fail closed when exact raw groups are requested; the
 * adapter never invents NaN, negative-zero semantics, or original order.
 */
export function createSqlitePersonalMapBundleReadRepository(
  getDatabase: AsyncSqliteDatabaseProvider,
): PersonalMapBundleReadRepositoryPort {
  return {
    async withConsistentRead<Result>(operation): Promise<Result> {
      const database = await getDatabase();
      let completed = false;
      let result: Result | undefined;
      await database.withReadTransactionAsync(async (transaction) => {
        result = await operation(
          new SqlitePersonalMapBundleSnapshotReader(transaction),
        );
        completed = true;
      });
      if (!completed) {
        throw new Error(
          "SQLite read transaction ended without completing its operation.",
        );
      }
      return result as Result;
    },
  };
}
