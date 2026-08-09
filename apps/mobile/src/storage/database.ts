import * as SQLite from "expo-sqlite";
import {
  migrateMappingDatabase,
  serializeAsyncSqliteDatabase,
  type AsyncSqliteDatabase,
  type AsyncSqliteExecutor,
  type SqliteBindValue,
} from "@exploration-map/sqlite-adapter";

const DATABASE_NAME = "personal-exploration-map.db";

let databasePromise: Promise<AsyncSqliteDatabase> | undefined;

function wrapExecutor(
  executor: SQLite.SQLiteDatabase,
): AsyncSqliteExecutor {
  return {
    execAsync(source) {
      return executor.execAsync(source);
    },
    async runAsync(source, ...params) {
      const result = await executor.runAsync(
        source,
        ...(params as SQLite.SQLiteBindValue[]),
      );
      return {
        lastInsertRowId: result.lastInsertRowId,
        changes: result.changes,
      };
    },
    getFirstAsync<T>(source: string, ...params: readonly SqliteBindValue[]) {
      return executor.getFirstAsync<T>(
        source,
        ...(params as SQLite.SQLiteBindValue[]),
      );
    },
    getAllAsync<T>(source: string, ...params: readonly SqliteBindValue[]) {
      return executor.getAllAsync<T>(
        source,
        ...(params as SQLite.SQLiteBindValue[]),
      );
    },
  };
}

function wrapDatabase(database: SQLite.SQLiteDatabase): AsyncSqliteDatabase {
  return {
    ...wrapExecutor(database),
    async withReadTransactionAsync(task) {
      // The serialized outer database owns the queue slot for the full callback,
      // so no unrelated operation can leak into Expo's non-exclusive read
      // transaction. Queries inside this callback are awaited sequentially.
      await database.withTransactionAsync(async () => {
        await task(wrapExecutor(database));
      });
    },
    async withExclusiveTransactionAsync(task) {
      await database.withExclusiveTransactionAsync(async (transaction) => {
        await task(
          wrapExecutor(transaction as unknown as SQLite.SQLiteDatabase),
        );
      });
    },
  };
}

/**
 * Returns the single serialized database boundary shared by foreground UI,
 * background location callbacks, diagnostics, and mapping replay.
 *
 * Expo SQLite manages native prepared statements behind each async call. The
 * application must not enter the same native database object concurrently, so
 * every top-level operation goes through one queue before reaching Expo.
 */
export async function getDatabase(): Promise<AsyncSqliteDatabase> {
  databasePromise ??= SQLite.openDatabaseAsync(DATABASE_NAME).then(
    async (rawDatabase) => {
      const database = serializeAsyncSqliteDatabase(
        wrapDatabase(rawDatabase),
      );
      await migrateMappingDatabase(database);
      return database;
    },
  );
  return databasePromise;
}

export async function getMappingDatabase(): Promise<AsyncSqliteDatabase> {
  return getDatabase();
}

export async function initializeDatabase(): Promise<void> {
  await getDatabase();
}
