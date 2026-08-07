import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  createSqliteMappingRepository,
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
  private readonly database: DatabaseSync;

  constructor(database: DatabaseSync) {
    this.database = database;
  }

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
    const row = this.database.prepare(source).get(...params) as
      | Record<string, unknown>
      | undefined;
    return row === undefined ? null : ({ ...row } as T);
  }

  async getAllAsync<T>(
    source: string,
    ...params: readonly SqliteBindValue[]
  ): Promise<readonly T[]> {
    const rows = this.database.prepare(source).all(...params) as Record<
      string,
      unknown
    >[];
    return rows.map((row) => ({ ...row }) as T);
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

class FailingProvider implements TrackingProviderPort {
  readonly id = "gnss";
  readonly coordinateKind = "geographic" as const;

  async start(): Promise<void> {
    throw new Error("provider start failed");
  }

  async stop(): Promise<void> {}

  async status(): Promise<TrackingRuntimeStatus> {
    return {
      running: false,
      providerId: null,
      explorationId: null,
    };
  }
}

function deterministicIdFactory() {
  const counters = new Map<MappingEntityKind, number>();
  return (kind: MappingEntityKind): string => {
    const next = (counters.get(kind) ?? 0) + 1;
    counters.set(kind, next);
    return `${kind}-${next}`;
  };
}

function sample(id: string, recordedAtMs: number): RawPositionSample {
  return {
    id,
    recordedAtMs,
    source: "gnss",
    position: {
      kind: "geographic",
      latitude: 35,
      longitude: 139,
    },
    horizontalAccuracyMeters: 5,
    confidence: 0.95,
  };
}

async function count(
  database: AsyncSqliteDatabase,
  table: string,
): Promise<number> {
  const row = await database.getFirstAsync<{ readonly count: number }>(
    `SELECT COUNT(*) AS count FROM ${table}`,
  );
  return Number(row?.count ?? 0);
}

test("failed first tracking start leaves no empty PersonalMap in real SQLite", async () => {
  const database = new NodeSqliteDatabase(new DatabaseSync(":memory:"));
  try {
    await migrateMappingDatabase(database);
    const repository = createSqliteMappingRepository(async () => database);
    const engine = createMappingEngine({
      repository,
      trackingProviders: [new FailingProvider()],
      idFactory: deterministicIdFactory(),
    });

    await assert.rejects(
      engine.createPersonalMapWithFirstExploration({
        personalMap: {
          name: "Empty failure map",
          createdAtMs: 1_000,
        },
        exploration: {
          name: "Failed first exploration",
          startedAtMs: 2_000,
          trackingProviderId: "gnss",
        },
      }),
      /provider start failed/u,
    );

    assert.equal(await count(database, "personal_maps"), 0);
    assert.equal(await count(database, "explorations"), 0);
    assert.equal(await count(database, "position_samples"), 0);
    assert.equal(await count(database, "markers"), 0);
    assert.equal(await count(database, "tracking_diagnostic_events"), 0);
    assert.deepEqual(
      await database.getAllAsync("PRAGMA foreign_key_check"),
      [],
    );
  } finally {
    database.close();
  }
});

test("automatic compensation refuses to delete a map with canonical evidence", async () => {
  const database = new NodeSqliteDatabase(new DatabaseSync(":memory:"));
  try {
    await migrateMappingDatabase(database);
    const repository = createSqliteMappingRepository(async () => database);

    const compensated = await repository.runInTransaction(async (writer) => {
      await writer.createPersonalMap({
        id: "map-with-evidence",
        name: "Map with evidence",
        createdAtMs: 1_000,
        updatedAtMs: 1_000,
      });
      await writer.createExploration({
        id: "exploration-with-evidence",
        personalMapId: "map-with-evidence",
        name: "Observed session",
        startedAtMs: 2_000,
        trackingProviderId: "gnss",
      });
      await writer.appendPositionSamples("exploration-with-evidence", [
        sample("early-sample", 2_100),
      ]);
      return writer.deletePersonalMapIfOnlyUnobservedExploration(
        "map-with-evidence",
        "exploration-with-evidence",
      );
    });

    assert.equal(compensated, false);
    assert.equal(await count(database, "personal_maps"), 1);
    assert.equal(await count(database, "explorations"), 1);
    assert.equal(await count(database, "position_samples"), 1);
  } finally {
    database.close();
  }
});

test("automatic compensation never deletes an existing map with another session", async () => {
  const database = new NodeSqliteDatabase(new DatabaseSync(":memory:"));
  try {
    await migrateMappingDatabase(database);
    const repository = createSqliteMappingRepository(async () => database);

    const compensated = await repository.runInTransaction(async (writer) => {
      await writer.createPersonalMap({
        id: "existing-map",
        name: "Existing map",
        createdAtMs: 1_000,
        updatedAtMs: 1_000,
      });
      await writer.createExploration({
        id: "first-session",
        personalMapId: "existing-map",
        name: "First session",
        startedAtMs: 2_000,
        trackingProviderId: "gnss",
      });
      await writer.completeExploration("first-session", 3_000);
      await writer.createExploration({
        id: "failed-session",
        personalMapId: "existing-map",
        name: "Failed continuation",
        startedAtMs: 4_000,
        trackingProviderId: "gnss",
      });
      return writer.deletePersonalMapIfOnlyUnobservedExploration(
        "existing-map",
        "failed-session",
      );
    });

    assert.equal(compensated, false);
    assert.equal(await count(database, "personal_maps"), 1);
    assert.equal(await count(database, "explorations"), 2);

    const removedContinuation = await repository.runInTransaction((writer) =>
      writer.deleteExplorationIfUnobserved("failed-session"),
    );
    assert.equal(removedContinuation, true);
    assert.equal(await count(database, "personal_maps"), 1);
    assert.equal(await count(database, "explorations"), 1);
  } finally {
    database.close();
  }
});
