import type {
  AsyncSqliteDatabase,
  AsyncSqliteExecutor,
  SqliteBindValue,
  SqliteRunResult,
} from "./database.ts";

/**
 * Small dependency-free async mutex used at the platform database boundary.
 *
 * Expo SQLite owns native prepared statements behind JavaScript promises. When
 * multiple reads, writes, or transactions enter the same database object at
 * once, one call can release a native statement while another call is still
 * using it. Keeping one top-level queue prevents that native lifetime race.
 *
 * A rejected operation never poisons the queue: the tail is always converted
 * back into a fulfilled Promise before the next operation is scheduled.
 */
class AsyncOperationQueue {
  private tail: Promise<void> = Promise.resolve();

  run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

/**
 * Serializes every operation entering an AsyncSqliteDatabase from the app.
 *
 * Transaction callbacks receive the executor supplied by the underlying
 * database directly. They deliberately do not re-enter this queue, because the
 * transaction already owns the queue slot and re-entry would deadlock. Code
 * inside either transaction type must therefore await operations in order
 * rather than running them with Promise.all.
 */
export function serializeAsyncSqliteDatabase(
  database: AsyncSqliteDatabase,
): AsyncSqliteDatabase {
  const queue = new AsyncOperationQueue();

  return {
    execAsync(source: string): Promise<void> {
      return queue.run(() => database.execAsync(source));
    },

    runAsync(
      source: string,
      ...params: readonly SqliteBindValue[]
    ): Promise<SqliteRunResult> {
      return queue.run(() => database.runAsync(source, ...params));
    },

    getFirstAsync<T>(
      source: string,
      ...params: readonly SqliteBindValue[]
    ): Promise<T | null> {
      return queue.run(() => database.getFirstAsync<T>(source, ...params));
    },

    getAllAsync<T>(
      source: string,
      ...params: readonly SqliteBindValue[]
    ): Promise<readonly T[]> {
      return queue.run(() => database.getAllAsync<T>(source, ...params));
    },

    withReadTransactionAsync(
      task: (transaction: AsyncSqliteExecutor) => Promise<void>,
    ): Promise<void> {
      return queue.run(() => database.withReadTransactionAsync(task));
    },

    withExclusiveTransactionAsync(
      task: (transaction: AsyncSqliteExecutor) => Promise<void>,
    ): Promise<void> {
      return queue.run(() => database.withExclusiveTransactionAsync(task));
    },
  };
}
