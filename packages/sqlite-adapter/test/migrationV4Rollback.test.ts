import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  CREATE_LEGACY_V1_SCHEMA_SQL,
  MIGRATE_V1_TO_V2_SQL,
  MIGRATE_V2_TO_V3_SQL,
  migrateMappingDatabase,
  type AsyncSqliteDatabase,
  type AsyncSqliteExecutor,
  type SqliteBindValue,
  type SqliteRunResult,
} from "../src/index.ts";

class FailingNodeSqliteDatabase implements AsyncSqliteDatabase {
  readonly database = new DatabaseSync(":memory:");
  failV4Copy = false;

  async execAsync(source: string): Promise<void> {
    if (
      this.failV4Copy &&
      source.includes("INSERT INTO position_samples_v4")
    ) {
      throw new Error("planned v4 copy failure");
    }
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

async function prepareV3(database: FailingNodeSqliteDatabase): Promise<void> {
  await database.execAsync("PRAGMA foreign_keys = ON;");
  await database.execAsync(CREATE_LEGACY_V1_SCHEMA_SQL);
  await database.runAsync(
    `INSERT INTO explorations(
      id, name, status, tracking_mode, frame_hint,
      started_at, ended_at, created_at, updated_at
    ) VALUES ('legacy', 'Legacy', 'completed', 'background', NULL,
      1000, 3000, 1000, 3000)`,
  );
  await database.runAsync(
    `INSERT INTO position_samples(
      id, exploration_id, recorded_at, source, coordinate_kind,
      latitude, longitude, altitude_meters, x_meters, y_meters, floor_level,
      horizontal_accuracy_meters, heading_degrees,
      speed_meters_per_second, confidence
    ) VALUES ('sample', 'legacy', 2000, 'gnss', 'geographic',
      35, 139, NULL, NULL, NULL, NULL, 5, NULL, NULL, 0.9)`,
  );

  await database.execAsync("PRAGMA foreign_keys = OFF;");
  await database.withExclusiveTransactionAsync((transaction) =>
    transaction.execAsync(MIGRATE_V1_TO_V2_SQL),
  );
  await database.execAsync("PRAGMA foreign_keys = ON;");
  await database.withExclusiveTransactionAsync((transaction) =>
    transaction.execAsync(MIGRATE_V2_TO_V3_SQL),
  );
}

test("v4 copy failure rolls back without replacing legacy canonical rows", async () => {
  const database = new FailingNodeSqliteDatabase();
  try {
    await prepareV3(database);
    database.failV4Copy = true;

    await assert.rejects(
      migrateMappingDatabase(database),
      /planned v4 copy failure/u,
    );

    assert.equal(
      (
        await database.getFirstAsync<{ user_version: number }>(
          "PRAGMA user_version",
        )
      )?.user_version,
      3,
    );
    assert.equal(
      (
        await database.getFirstAsync<{ count: number }>(
          "SELECT COUNT(*) AS count FROM position_samples",
        )
      )?.count,
      1,
    );
    const columns = await database.getAllAsync<{ name: string }>(
      "PRAGMA table_info(position_samples)",
    );
    assert.equal(columns.some((column) => column.name === "sample_ordinal"), false);
    assert.equal(
      (
        await database.getFirstAsync<{ count: number }>(
          `SELECT COUNT(*) AS count
           FROM sqlite_master
           WHERE type = 'table' AND name = 'position_samples_v4'`,
        )
      )?.count,
      0,
    );
    assert.deepEqual(
      await database.getAllAsync("PRAGMA foreign_key_check"),
      [],
    );
  } finally {
    database.close();
  }
});
