import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  createSqliteTrackingDiagnosticsStore,
  migrateMappingDatabase,
  type AsyncSqliteDatabase,
  type AsyncSqliteExecutor,
  type SqliteBindValue,
  type SqliteRunResult,
} from "../src/index.ts";

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

  async withReadTransactionAsync(
    task: (transaction: AsyncSqliteExecutor) => Promise<void>,
  ): Promise<void> {
    this.database.exec("BEGIN");
    try {
      await task(this);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
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

test("tracking diagnostics are idempotent, ordered, and cascade with an exploration", async () => {
  const database = new NodeSqliteDatabase(new DatabaseSync(":memory:"));
  try {
    await migrateMappingDatabase(database);
    await database.runAsync(
      `INSERT INTO personal_maps(id, name, created_at, updated_at)
       VALUES ('map-1', 'Test map', 1000, 1000)`,
    );
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
      ) VALUES (
        'exploration-1',
        'map-1',
        'Test exploration',
        'recording',
        'gnss-background',
        'background',
        NULL,
        1000,
        NULL,
        1000,
        1000
      )`,
    );

    const store = createSqliteTrackingDiagnosticsStore(async () => database);
    const first = {
      id: "event-1",
      personalMapId: "map-1",
      explorationId: "exploration-1",
      providerId: "gnss-background",
      kind: "callback.received" as const,
      occurredAtMs: 3_000,
      payload: {
        sampleCount: 2,
        delivery: "background",
      },
    };
    const second = {
      id: "event-2",
      personalMapId: "map-1",
      explorationId: "exploration-1",
      providerId: "gnss-background",
      kind: "provider.started" as const,
      occurredAtMs: 2_000,
    };

    assert.equal(await store.append(first), true);
    assert.equal(await store.append(first), false);
    assert.equal(await store.append(second), true);

    assert.deepEqual(await store.listForExploration("exploration-1"), [
      second,
      first,
    ]);

    await database.runAsync(
      "DELETE FROM explorations WHERE id = ?",
      "exploration-1",
    );
    assert.deepEqual(await store.listForExploration("exploration-1"), []);
    assert.deepEqual(
      await database.getAllAsync("PRAGMA foreign_key_check"),
      [],
    );
  } finally {
    database.close();
  }
});
