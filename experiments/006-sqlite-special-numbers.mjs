#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { DatabaseSync } from "node:sqlite";

const OUTPUT_PATH = path.resolve(
  process.argv[2] ?? "artifacts/sqlite-special-numbers/report.json",
);

const VALUES = [
  { id: "finite", value: 1.25 },
  { id: "nan", value: Number.NaN },
  { id: "positive-infinity", value: Number.POSITIVE_INFINITY },
  { id: "negative-infinity", value: Number.NEGATIVE_INFINITY },
  { id: "negative-zero", value: -0 },
];

function describeJavaScriptNumber(value) {
  if (value === null) {
    return { kind: "null", string: "null" };
  }
  if (typeof value !== "number") {
    return { kind: typeof value, string: String(value) };
  }
  if (Number.isNaN(value)) {
    return { kind: "number", string: "NaN", isNaN: true };
  }
  if (value === Number.POSITIVE_INFINITY) {
    return {
      kind: "number",
      string: "+Infinity",
      isFinite: false,
    };
  }
  if (value === Number.NEGATIVE_INFINITY) {
    return {
      kind: "number",
      string: "-Infinity",
      isFinite: false,
    };
  }
  if (Object.is(value, -0)) {
    return {
      kind: "number",
      string: "-0",
      isFinite: true,
      isNegativeZero: true,
    };
  }
  return {
    kind: "number",
    string: String(value),
    isFinite: Number.isFinite(value),
    isNegativeZero: false,
  };
}

function errorDetails(error) {
  return {
    name: error instanceof Error ? error.name : typeof error,
    message: error instanceof Error ? error.message : String(error),
    code:
      typeof error === "object" &&
      error !== null &&
      "code" in error
        ? String(error.code)
        : null,
  };
}

function measureSingleColumn(database, definition) {
  const table = `value_${definition.id.replaceAll("-", "_")}`;
  database.exec(
    `CREATE TABLE ${table}(label TEXT PRIMARY KEY NOT NULL, value ${definition.sqlType});`,
  );
  const insert = database.prepare(
    `INSERT INTO ${table}(label, value) VALUES (?, ?)`,
  );
  const select = database.prepare(
    `SELECT value, typeof(value) AS sqlite_type, quote(value) AS sqlite_quote FROM ${table} WHERE label = ?`,
  );

  return VALUES.map(({ id, value }) => {
    try {
      insert.run(id, value);
      const row = select.get(id);
      return {
        valueId: id,
        input: describeJavaScriptNumber(value),
        insert: "success",
        sqliteType: row?.sqlite_type ?? null,
        sqliteQuote: row?.sqlite_quote ?? null,
        output: describeJavaScriptNumber(row?.value ?? null),
      };
    } catch (error) {
      return {
        valueId: id,
        input: describeJavaScriptNumber(value),
        insert: "failure",
        error: errorDetails(error),
      };
    }
  });
}

function measureRawLikeSchema(database) {
  database.exec(`
    CREATE TABLE raw_like (
      id TEXT PRIMARY KEY NOT NULL,
      recorded_at INTEGER NOT NULL,
      latitude REAL,
      confidence REAL NOT NULL
    );
  `);
  const insert = database.prepare(
    `INSERT INTO raw_like(id, recorded_at, latitude, confidence) VALUES (?, ?, ?, ?)`,
  );
  const select = database.prepare(`
    SELECT
      recorded_at,
      typeof(recorded_at) AS recorded_at_type,
      quote(recorded_at) AS recorded_at_quote,
      latitude,
      typeof(latitude) AS latitude_type,
      quote(latitude) AS latitude_quote,
      confidence,
      typeof(confidence) AS confidence_type,
      quote(confidence) AS confidence_quote
    FROM raw_like
    WHERE id = ?
  `);

  const cases = [
    {
      id: "all-finite",
      recordedAt: 1_000,
      latitude: 35.681,
      confidence: 0.9,
    },
    {
      id: "nan-nullable-latitude",
      recordedAt: 1_001,
      latitude: Number.NaN,
      confidence: 0.9,
    },
    {
      id: "nan-required-confidence",
      recordedAt: 1_002,
      latitude: 35.681,
      confidence: Number.NaN,
    },
    {
      id: "positive-infinity-confidence",
      recordedAt: 1_003,
      latitude: 35.681,
      confidence: Number.POSITIVE_INFINITY,
    },
    {
      id: "negative-infinity-confidence",
      recordedAt: 1_004,
      latitude: 35.681,
      confidence: Number.NEGATIVE_INFINITY,
    },
    {
      id: "negative-zero-confidence",
      recordedAt: 1_005,
      latitude: 35.681,
      confidence: -0,
    },
    {
      id: "nan-required-recorded-at",
      recordedAt: Number.NaN,
      latitude: 35.681,
      confidence: 0.9,
    },
    {
      id: "positive-infinity-recorded-at",
      recordedAt: Number.POSITIVE_INFINITY,
      latitude: 35.681,
      confidence: 0.9,
    },
    {
      id: "negative-zero-recorded-at",
      recordedAt: -0,
      latitude: 35.681,
      confidence: 0.9,
    },
  ];

  return cases.map((item) => {
    try {
      insert.run(
        item.id,
        item.recordedAt,
        item.latitude,
        item.confidence,
      );
      const row = select.get(item.id);
      return {
        caseId: item.id,
        input: {
          recordedAt: describeJavaScriptNumber(item.recordedAt),
          latitude: describeJavaScriptNumber(item.latitude),
          confidence: describeJavaScriptNumber(item.confidence),
        },
        insert: "success",
        output: {
          recordedAt: describeJavaScriptNumber(row?.recorded_at ?? null),
          recordedAtSqliteType: row?.recorded_at_type ?? null,
          recordedAtSqliteQuote: row?.recorded_at_quote ?? null,
          latitude: describeJavaScriptNumber(row?.latitude ?? null),
          latitudeSqliteType: row?.latitude_type ?? null,
          latitudeSqliteQuote: row?.latitude_quote ?? null,
          confidence: describeJavaScriptNumber(row?.confidence ?? null),
          confidenceSqliteType: row?.confidence_type ?? null,
          confidenceSqliteQuote: row?.confidence_quote ?? null,
        },
      };
    } catch (error) {
      return {
        caseId: item.id,
        input: {
          recordedAt: describeJavaScriptNumber(item.recordedAt),
          latitude: describeJavaScriptNumber(item.latitude),
          confidence: describeJavaScriptNumber(item.confidence),
        },
        insert: "failure",
        error: errorDetails(error),
      };
    }
  });
}

async function main() {
  const database = new DatabaseSync(":memory:");
  try {
    const report = {
      experiment: "sqlite-special-numbers",
      purpose:
        "Measure Node 22 node:sqlite binding behavior before changing the canonical schema or lossless-backup claims.",
      generatedAt: new Date().toISOString(),
      runtime: {
        node: process.version,
        versions: process.versions,
      },
      limitations: [
        "This measures node:sqlite on the GitHub runner, not Expo SQLite on Android.",
        "A successful Node round-trip does not prove the Android native binding is identical.",
        "No product schema or runtime behavior is changed by this experiment.",
      ],
      singleColumnCases: [
        {
          definition: "REAL",
          results: measureSingleColumn(database, {
            id: "real-nullable",
            sqlType: "REAL",
          }),
        },
        {
          definition: "REAL NOT NULL",
          results: measureSingleColumn(database, {
            id: "real-not-null",
            sqlType: "REAL NOT NULL",
          }),
        },
        {
          definition: "INTEGER NOT NULL",
          results: measureSingleColumn(database, {
            id: "integer-not-null",
            sqlType: "INTEGER NOT NULL",
          }),
        },
      ],
      rawLikeCases: measureRawLikeSchema(database),
    };

    await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
    await writeFile(OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(JSON.stringify({ output: OUTPUT_PATH, status: "measured" }));
  } finally {
    database.close();
  }
}

await main();
