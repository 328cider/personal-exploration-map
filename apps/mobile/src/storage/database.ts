import * as SQLite from "expo-sqlite";
import {
  migrateMappingDatabase,
  type AsyncSqliteDatabase,
  type AsyncSqliteExecutor,
  type SqliteBindValue,
} from "@exploration-map/sqlite-adapter";

const DATABASE_NAME = "personal-exploration-map.db";

let databasePromise: Promise<SQLite.SQLiteDatabase> | undefined;

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
    async withExclusiveTransactionAsync(task) {
      await database.withExclusiveTransactionAsync(async (transaction) => {
        await task(
          wrapExecutor(transaction as unknown as SQLite.SQLiteDatabase),
        );
      });
    },
  };
}

export async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  databasePromise ??= SQLite.openDatabaseAsync(DATABASE_NAME).then(
    async (database) => {
      await migrateMappingDatabase(wrapDatabase(database));
      return database;
    },
  );
  return databasePromise;
}

export async function getMappingDatabase(): Promise<AsyncSqliteDatabase> {
  return wrapDatabase(await getDatabase());
}

export async function initializeDatabase(): Promise<void> {
  await getDatabase();
}
