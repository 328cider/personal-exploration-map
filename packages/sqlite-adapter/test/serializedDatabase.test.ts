import assert from "node:assert/strict";
import test from "node:test";

import {
  serializeAsyncSqliteDatabase,
  type AsyncSqliteDatabase,
  type AsyncSqliteExecutor,
  type SqliteBindValue,
  type SqliteRunResult,
} from "../src/index.ts";

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

class StrictAsyncDatabase implements AsyncSqliteDatabase {
  readonly events: string[] = [];
  maximumTopLevelConcurrency = 0;
  maximumTransactionConcurrency = 0;

  private activeTopLevel = 0;
  private activeTransaction = 0;

  private async topLevel<T>(
    label: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    this.activeTopLevel += 1;
    this.maximumTopLevelConcurrency = Math.max(
      this.maximumTopLevelConcurrency,
      this.activeTopLevel,
    );
    this.events.push(`start:${label}`);
    if (this.activeTopLevel > 1) {
      this.activeTopLevel -= 1;
      throw new Error(`concurrent top-level database operation: ${label}`);
    }

    try {
      await delay(5);
      return await operation();
    } finally {
      this.events.push(`end:${label}`);
      this.activeTopLevel -= 1;
    }
  }

  private async transactionOperation<T>(
    label: string,
    value: T,
  ): Promise<T> {
    this.activeTransaction += 1;
    this.maximumTransactionConcurrency = Math.max(
      this.maximumTransactionConcurrency,
      this.activeTransaction,
    );
    this.events.push(`tx-start:${label}`);
    if (this.activeTransaction > 1) {
      this.activeTransaction -= 1;
      throw new Error(`concurrent transaction operation: ${label}`);
    }

    try {
      await delay(3);
      return value;
    } finally {
      this.events.push(`tx-end:${label}`);
      this.activeTransaction -= 1;
    }
  }

  execAsync(source: string): Promise<void> {
    return this.topLevel(`exec:${source}`, async () => undefined);
  }

  runAsync(
    source: string,
    ..._params: readonly SqliteBindValue[]
  ): Promise<SqliteRunResult> {
    return this.topLevel(`run:${source}`, async () => {
      if (source === "fail") {
        throw new Error("planned database failure");
      }
      return { lastInsertRowId: 1, changes: 1 };
    });
  }

  getFirstAsync<T>(
    source: string,
    ..._params: readonly SqliteBindValue[]
  ): Promise<T | null> {
    return this.topLevel(`first:${source}`, async () => source as T);
  }

  getAllAsync<T>(
    source: string,
    ..._params: readonly SqliteBindValue[]
  ): Promise<readonly T[]> {
    return this.topLevel(`all:${source}`, async () => [source as T]);
  }

  withExclusiveTransactionAsync(
    task: (transaction: AsyncSqliteExecutor) => Promise<void>,
  ): Promise<void> {
    const transaction: AsyncSqliteExecutor = {
      execAsync: (source) =>
        this.transactionOperation(`exec:${source}`, undefined),
      runAsync: (source, ..._params) =>
        this.transactionOperation(`run:${source}`, {
          lastInsertRowId: 1,
          changes: 1,
        }),
      getFirstAsync: <T>(source: string, ..._params: readonly SqliteBindValue[]) =>
        this.transactionOperation(`first:${source}`, source as T),
      getAllAsync: <T>(source: string, ..._params: readonly SqliteBindValue[]) =>
        this.transactionOperation(`all:${source}`, [source as T]),
    };

    return this.topLevel("transaction", () => task(transaction));
  }
}

test("parallel top-level operations enter the native database one at a time", async () => {
  const underlying = new StrictAsyncDatabase();
  const database = serializeAsyncSqliteDatabase(underlying);

  const [first, all, run] = await Promise.all([
    database.getFirstAsync<string>("one"),
    database.getAllAsync<string>("two"),
    database.runAsync("three"),
  ]);

  assert.equal(first, "one");
  assert.deepEqual(all, ["two"]);
  assert.equal(run.changes, 1);
  assert.equal(underlying.maximumTopLevelConcurrency, 1);
  assert.deepEqual(underlying.events, [
    "start:first:one",
    "end:first:one",
    "start:all:two",
    "end:all:two",
    "start:run:three",
    "end:run:three",
  ]);
});

test("a transaction owns the queue slot while its internal operations remain usable", async () => {
  const underlying = new StrictAsyncDatabase();
  const database = serializeAsyncSqliteDatabase(underlying);

  const transaction = database.withExclusiveTransactionAsync(async (writer) => {
    await writer.runAsync("inside-one");
    await writer.getFirstAsync("inside-two");
  });
  const outsideRead = database.getFirstAsync<string>("outside");

  await transaction;
  assert.equal(await outsideRead, "outside");
  assert.equal(underlying.maximumTopLevelConcurrency, 1);
  assert.equal(underlying.maximumTransactionConcurrency, 1);
  assert.deepEqual(underlying.events, [
    "start:transaction",
    "tx-start:run:inside-one",
    "tx-end:run:inside-one",
    "tx-start:first:inside-two",
    "tx-end:first:inside-two",
    "end:transaction",
    "start:first:outside",
    "end:first:outside",
  ]);
});

test("a rejected operation does not poison later queued work", async () => {
  const underlying = new StrictAsyncDatabase();
  const database = serializeAsyncSqliteDatabase(underlying);

  await assert.rejects(database.runAsync("fail"), /planned database failure/u);
  assert.equal(await database.getFirstAsync<string>("after-failure"), "after-failure");
  assert.equal(underlying.maximumTopLevelConcurrency, 1);
  assert.deepEqual(underlying.events, [
    "start:run:fail",
    "end:run:fail",
    "start:first:after-failure",
    "end:first:after-failure",
  ]);
});
