import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  CREATE_LEGACY_V1_SCHEMA_SQL,
  createSqliteMappingRepository,
  MAPPING_DATABASE_VERSION,
  migrateMappingDatabase,
  type AsyncSqliteDatabase,
  type AsyncSqliteExecutor,
  type SqliteBindValue,
  type SqliteRunResult,
} from "../src/index.ts";
import {
  createMappingEngine,
  type MappingEntityKind,
  type TrackingProviderPort,
  type TrackingRuntimeStatus,
} from "../../mapping-engine/src/index.ts";
import type { RawPositionSample } from "../../mapping-core/src/index.ts";

class NodeSqliteDatabase implements AsyncSqliteDatabase {
  constructor(private readonly database: DatabaseSync) {}

  async execAsync(source: string): Promise<void> {
    this.database.exec(source);
  }

  async runAsync(
    source: string,
    ...params: readonly SqliteBindValue[]
  ): Promise<SqliteRunResult> {
    const result = this.database.prepare(source).run(...params);
    return {
      lastInsertRowId: Number(result.lastInsertRowid),
      changes: Number(result.changes),
    };
  }

  async getFirstAsync<T>(
    source: string,
    ...params: readonly SqliteBindValue[]
  ): Promise<T | null> {
    const row = this.database.prepare(source).get(...params) as T | undefined;
    return row ?? null;
  }

  async getAllAsync<T>(
    source: string,
    ...params: readonly SqliteBindValue[]
  ): Promise<readonly T[]> {
    return this.database.prepare(source).all(...params) as T[];
  }

  async withExclusiveTransactionAsync(
    task: (transaction: AsyncSqliteExecutor) => Promise<void>,
  ): Promise<void> {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      await task(this);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  close(): void {
    this.database.close();
  }
}

class FakeTrackingProvider implements TrackingProviderPort {
  readonly id = "gnss-background";
  readonly starts: string[] = [];
  readonly stops: string[] = [];
  private activeExplorationId: string | null = null;

  async start(input: {
    readonly personalMapId: string;
    readonly explorationId: string;
  }): Promise<void> {
    this.starts.push(`${input.personalMapId}:${input.explorationId}`);
    this.activeExplorationId = input.explorationId;
  }

  async stop(explorationId: string): Promise<void> {
    this.stops.push(explorationId);
    if (this.activeExplorationId === explorationId) {
      this.activeExplorationId = null;
    }
  }

  async status(): Promise<TrackingRuntimeStatus> {
    return {
      running: this.activeExplorationId !== null,
      providerId: this.activeExplorationId === null ? null : this.id,
      explorationId: this.activeExplorationId,
    };
  }
}

function createDatabase(): NodeSqliteDatabase {
  return new NodeSqliteDatabase(new DatabaseSync(":memory:"));
}

function deterministicIdFactory() {
  const counters = new Map<MappingEntityKind, number>();
  return (kind: MappingEntityKind): string => {
    const next = (counters.get(kind) ?? 0) + 1;
    counters.set(kind, next);
    return `${kind}-${next}`;
  };
}

function sample(
  id: string,
  recordedAtMs: number,
  latitude: number,
  longitude: number,
): RawPositionSample {
  return {
    id,
    recordedAtMs,
    source: "gnss",
    position: { kind: "geographic", latitude, longitude },
    horizontalAccuracyMeters: 5,
    confidence: 0.95,
  };
}

test("v1 migration preserves raw evidence and creates one personal map per legacy exploration", async () => {
  const database = createDatabase();
  try {
    await database.execAsync("PRAGMA foreign_keys = ON;");
    await database.execAsync(CREATE_LEGACY_V1_SCHEMA_SQL);
    await database.runAsync(
      `INSERT INTO explorations(
        id, name, status, tracking_mode, frame_hint,
        started_at, ended_at, created_at, updated_at
      ) VALUES (?, ?, 'completed', 'background', NULL, ?, ?, ?, ?)`,
      "legacy-exploration",
      "Legacy map",
      1_000,
      3_000,
      1_000,
      3_000,
    );
    await database.runAsync(
      `INSERT INTO position_samples(
        id, exploration_id, recorded_at, source, coordinate_kind,
        latitude, longitude, altitude_meters, x_meters, y_meters, floor_level,
        horizontal_accuracy_meters, heading_degrees, speed_meters_per_second,
        confidence
      ) VALUES (?, ?, ?, 'gnss', 'geographic', ?, ?, NULL, NULL, NULL, NULL, ?, NULL, NULL, ?)`,
      "legacy-sample",
      "legacy-exploration",
      2_000,
      35,
      139,
      5,
      0.95,
    );
    await database.runAsync(
      `INSERT INTO markers(
        id, exploration_id, recorded_at, category, label, note,
        coordinate_kind, latitude, longitude, altitude_meters,
        x_meters, y_meters, floor_level
      ) VALUES (?, ?, ?, 'interesting', 'Legacy marker', NULL,
        'geographic', ?, ?, NULL, ?, ?, NULL)`,
      "legacy-marker",
      "legacy-exploration",
      2_500,
      35,
      139,
      0,
      0,
    );

    await migrateMappingDatabase(database);

    const version = await database.getFirstAsync<{ user_version: number }>(
      "PRAGMA user_version",
    );
    assert.equal(version?.user_version, MAPPING_DATABASE_VERSION);

    const personalMap = await database.getFirstAsync<{
      id: string;
      name: string;
    }>("SELECT id, name FROM personal_maps");
    assert.deepEqual(personalMap, {
      id: "legacy-exploration",
      name: "Legacy map",
    });

    const exploration = await database.getFirstAsync<{
      personal_map_id: string;
      tracking_provider_id: string;
    }>(
      "SELECT personal_map_id, tracking_provider_id FROM explorations",
    );
    assert.deepEqual(exploration, {
      personal_map_id: "legacy-exploration",
      tracking_provider_id: "gnss-background",
    });

    assert.equal(
      (
        await database.getFirstAsync<{ count: number }>(
          "SELECT COUNT(*) AS count FROM position_samples",
        )
      )?.count,
      1,
    );
    assert.equal(
      (
        await database.getFirstAsync<{ count: number }>(
          "SELECT COUNT(*) AS count FROM markers",
        )
      )?.count,
      1,
    );
    assert.deepEqual(
      await database.getAllAsync("PRAGMA foreign_key_check"),
      [],
    );

    await database.runAsync(
      "DELETE FROM personal_maps WHERE id = ?",
      "legacy-exploration",
    );
    assert.equal(
      (
        await database.getFirstAsync<{ count: number }>(
          "SELECT COUNT(*) AS count FROM explorations",
        )
      )?.count,
      0,
    );
    assert.equal(
      (
        await database.getFirstAsync<{ count: number }>(
          "SELECT COUNT(*) AS count FROM position_samples",
        )
      )?.count,
      0,
    );
    assert.equal(
      (
        await database.getFirstAsync<{ count: number }>(
          "SELECT COUNT(*) AS count FROM markers",
        )
      )?.count,
      0,
    );
  } finally {
    database.close();
  }
});

test("SQLite repository persists two exploration sessions as separate personal-map segments", async () => {
  const database = createDatabase();
  try {
    await migrateMappingDatabase(database);
    const repository = createSqliteMappingRepository(async () => database);
    const provider = new FakeTrackingProvider();
    const engine = createMappingEngine({
      repository,
      trackingProviders: [provider],
      idFactory: deterministicIdFactory(),
    });

    const { personalMapId } = await engine.createPersonalMap({
      name: "My growing map",
      createdAtMs: 1_000,
    });

    const first = await engine.startExploration({
      personalMapId,
      name: "First exploration",
      startedAtMs: 2_000,
      trackingProviderId: provider.id,
    });
    const firstSamples = [
      sample("first-1", 2_500, 35, 139),
      sample("first-2", 3_500, 35.00001, 139.00001),
    ];
    assert.deepEqual(
      await engine.ingestPositionSamples({
        personalMapId,
        explorationId: first.explorationId,
        samples: firstSamples,
      }),
      {
        persistedSampleCount: 2,
        acceptedSampleCount: 2,
        rejectedSampleCount: 0,
      },
    );
    assert.deepEqual(
      await engine.ingestPositionSamples({
        personalMapId,
        explorationId: first.explorationId,
        samples: firstSamples,
      }),
      {
        persistedSampleCount: 0,
        acceptedSampleCount: 0,
        rejectedSampleCount: 0,
      },
    );
    await engine.addMarker({
      personalMapId,
      explorationId: first.explorationId,
      marker: {
        requestedId: "marker-1",
        recordedAtMs: 3_000,
        category: "interesting",
        label: "Found place",
      },
    });
    await engine.endExploration({
      personalMapId,
      explorationId: first.explorationId,
      endedAtMs: 4_000,
    });

    const second = await engine.startExploration({
      personalMapId,
      name: "Second exploration",
      startedAtMs: 5_000,
      trackingProviderId: provider.id,
    });
    await engine.ingestPositionSamples({
      personalMapId,
      explorationId: second.explorationId,
      samples: [
        sample("second-1", 5_500, 35.0001, 139.0001),
        sample("second-2", 6_500, 35.00011, 139.00011),
      ],
    });
    await engine.endExploration({
      personalMapId,
      explorationId: second.explorationId,
      endedAtMs: 7_000,
    });

    const map = await engine.getPersonalMap({ personalMapId });
    assert.equal(map?.stats.explorationCount, 2);
    assert.equal(map?.stats.rawSampleCount, 4);
    assert.equal(map?.stats.acceptedSampleCount, 4);
    assert.equal(map?.stats.markerCount, 1);
    assert.equal(map?.segments.length, 2);
    assert.deepEqual(
      map?.segments.map((segment) => ({
        explorationId: segment.explorationId,
        points: segment.track.length,
      })),
      [
        { explorationId: first.explorationId, points: 2 },
        { explorationId: second.explorationId, points: 2 },
      ],
    );

    const restartedRepository = createSqliteMappingRepository(
      async () => database,
    );
    const replayed = await restartedRepository.loadPersonalMapReplayInput(
      personalMapId,
    );
    assert.equal(replayed?.explorations.length, 2);
    assert.equal(replayed?.explorations[0]?.samples.length, 2);
    assert.equal(replayed?.explorations[1]?.samples.length, 2);

    assert.deepEqual(await engine.listPersonalMaps(), [
      {
        id: personalMapId,
        name: "My growing map",
        explorationCount: 2,
        updatedAtMs: 7_000,
      },
    ]);
    assert.deepEqual(provider.starts, [
      `${personalMapId}:${first.explorationId}`,
      `${personalMapId}:${second.explorationId}`,
    ]);
    assert.deepEqual(provider.stops, [
      first.explorationId,
      second.explorationId,
    ]);
  } finally {
    database.close();
  }
});

test("exclusive repository transaction rolls back partial canonical writes", async () => {
  const database = createDatabase();
  try {
    await migrateMappingDatabase(database);
    const repository = createSqliteMappingRepository(async () => database);

    await assert.rejects(
      repository.runInTransaction(async (writer) => {
        await writer.createPersonalMap({
          id: "rolled-back-map",
          name: "Should not survive",
          createdAtMs: 1_000,
          updatedAtMs: 1_000,
        });
        throw new Error("rollback requested");
      }),
      /rollback requested/u,
    );

    assert.deepEqual(await repository.listPersonalMaps(), []);
  } finally {
    database.close();
  }
});
