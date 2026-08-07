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
  readonly id = "gnss-background";
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
  const counts = new Map<MappingEntityKind, number>();
  return (kind: MappingEntityKind): string => {
    const next = (counts.get(kind) ?? 0) + 1;
    counts.set(kind, next);
    return `${kind}-${next}`;
  };
}

async function countRows(
  database: NodeSqliteDatabase,
  table: "personal_maps" | "explorations" | "position_samples" | "markers",
): Promise<number> {
  const row = await database.getFirstAsync<{ readonly count: number }>(
    `SELECT COUNT(*) AS count FROM ${table}`,
  );
  return Number(row?.count ?? 0);
}

test("provider failure removes the empty first-session aggregate in real SQLite", async () => {
  const database = new NodeSqliteDatabase(new DatabaseSync(":memory:"));
  try {
    await migrateMappingDatabase(database);
    const repository = createSqliteMappingRepository(async () => database);
    const provider = new FailingProvider();
    const engine = createMappingEngine({
      repository,
      trackingProviders: [provider],
      idFactory: deterministicIdFactory(),
    });

    await assert.rejects(
      engine.createPersonalMapWithFirstExploration({
        personalMapName: "Failed map",
        explorationName: "Failed first walk",
        createdAtMs: 1_000,
        startedAtMs: 1_000,
        trackingProviderId: provider.id,
      }),
      /provider start failed/u,
    );

    assert.equal(await countRows(database, "personal_maps"), 0);
    assert.equal(await countRows(database, "explorations"), 0);
    assert.equal(await countRows(database, "position_samples"), 0);
    assert.equal(await countRows(database, "markers"), 0);
    assert.deepEqual(await repository.listPersonalMaps(), []);
    assert.deepEqual(
      await database.getAllAsync("PRAGMA foreign_key_check"),
      [],
    );
  } finally {
    database.close();
  }
});

test("conditional compensation preserves maps with another session or evidence", async () => {
  const database = new NodeSqliteDatabase(new DatabaseSync(":memory:"));
  try {
    await migrateMappingDatabase(database);
    const repository = createSqliteMappingRepository(async () => database);

    await repository.runInTransaction(async (writer) => {
      await writer.createPersonalMap({
        id: "map-with-history",
        name: "Map with history",
        createdAtMs: 1_000,
        updatedAtMs: 2_000,
      });
      await writer.createExploration({
        id: "completed-session",
        personalMapId: "map-with-history",
        name: "Completed",
        startedAtMs: 1_000,
        trackingProviderId: "gnss-background",
      });
      await writer.completeExploration("completed-session", 1_500);
      await writer.createExploration({
        id: "provisional-session",
        personalMapId: "map-with-history",
        name: "Provisional",
        startedAtMs: 2_000,
        trackingProviderId: "gnss-background",
      });
    });

    const removedHistoricalMap = await repository.runInTransaction((writer) =>
      writer.deletePersonalMapIfOnlyEmptyExploration(
        "map-with-history",
        "provisional-session",
      ),
    );
    assert.equal(removedHistoricalMap, false);
    assert.equal(await countRows(database, "personal_maps"), 1);
    assert.equal(await countRows(database, "explorations"), 2);

    await repository.runInTransaction(async (writer) => {
      await writer.createPersonalMap({
        id: "map-with-evidence",
        name: "Map with evidence",
        createdAtMs: 3_000,
        updatedAtMs: 3_000,
      });
      await writer.createExploration({
        id: "evidence-session",
        personalMapId: "map-with-evidence",
        name: "Evidence session",
        startedAtMs: 3_000,
        trackingProviderId: "gnss-background",
      });
      await writer.appendPositionSamples("evidence-session", [
        {
          id: "sample-1",
          recordedAtMs: 3_100,
          source: "gnss",
          position: {
            kind: "geographic",
            latitude: 35,
            longitude: 139,
          },
          confidence: 0.9,
        },
      ]);
    });

    const removedEvidenceMap = await repository.runInTransaction((writer) =>
      writer.deletePersonalMapIfOnlyEmptyExploration(
        "map-with-evidence",
        "evidence-session",
      ),
    );
    assert.equal(removedEvidenceMap, false);
    assert.equal(await countRows(database, "personal_maps"), 2);
    assert.equal(await countRows(database, "explorations"), 3);
    assert.equal(await countRows(database, "position_samples"), 1);
  } finally {
    database.close();
  }
});
