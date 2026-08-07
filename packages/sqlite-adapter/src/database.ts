export type SqliteBindValue = string | number | null | Uint8Array;

export interface SqliteRunResult {
  readonly lastInsertRowId: number;
  readonly changes: number;
}

/**
 * Minimal async SQLite surface used by the mapping repository.
 *
 * Expo SQLite's database and exclusive transaction objects are structurally
 * compatible with this interface. Keeping the adapter behind this small port
 * lets the schema and repository run against real SQLite in dependency-free
 * Node tests without rebuilding a database abstraction.
 */
export interface AsyncSqliteExecutor {
  execAsync(source: string): Promise<void>;

  runAsync(
    source: string,
    ...params: readonly SqliteBindValue[]
  ): Promise<SqliteRunResult>;

  getFirstAsync<T>(
    source: string,
    ...params: readonly SqliteBindValue[]
  ): Promise<T | null>;

  getAllAsync<T>(
    source: string,
    ...params: readonly SqliteBindValue[]
  ): Promise<readonly T[]>;
}

export interface AsyncSqliteDatabase extends AsyncSqliteExecutor {
  withExclusiveTransactionAsync(
    task: (transaction: AsyncSqliteExecutor) => Promise<void>,
  ): Promise<void>;
}

export type AsyncSqliteDatabaseProvider = () => Promise<AsyncSqliteDatabase>;
