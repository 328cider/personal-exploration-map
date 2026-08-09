import { DatabaseSync } from "node:sqlite";

const CASES = [
  { name: "finite", value: 1.5 },
  { name: "nan", value: Number.NaN },
  { name: "positive-infinity", value: Number.POSITIVE_INFINITY },
  { name: "negative-infinity", value: Number.NEGATIVE_INFINITY },
  { name: "negative-zero", value: -0 },
];

const COLUMNS = [
  { name: "real-nullable", declaration: "REAL" },
  { name: "real-not-null", declaration: "REAL NOT NULL" },
  { name: "integer-not-null", declaration: "INTEGER NOT NULL" },
];

function numberObservation(value) {
  if (value === null) {
    return {
      javascriptType: "object",
      numberString: null,
      isNaN: false,
      isFinite: false,
      isNegativeZero: false,
    };
  }

  return {
    javascriptType: typeof value,
    numberString: Number.isNaN(value)
      ? "NaN"
      : value === Number.POSITIVE_INFINITY
        ? "+Infinity"
        : value === Number.NEGATIVE_INFINITY
          ? "-Infinity"
          : Object.is(value, -0)
            ? "-0"
            : String(value),
    isNaN: Number.isNaN(value),
    isFinite: Number.isFinite(value),
    isNegativeZero: Object.is(value, -0),
  };
}

function probe() {
  const database = new DatabaseSync(":memory:");
  try {
    const results = [];

    for (const column of COLUMNS) {
      const table = `probe_${column.name.replaceAll("-", "_")}`;
      database.exec(
        `CREATE TABLE ${table}(id TEXT PRIMARY KEY, value ${column.declaration})`,
      );

      for (const candidate of CASES) {
        const result = {
          column: column.name,
          case: candidate.name,
          input: numberObservation(candidate.value),
        };

        try {
          database
            .prepare(`INSERT INTO ${table}(id, value) VALUES (?, ?)`) 
            .run(candidate.name, candidate.value);
          result.insert = { ok: true };

          const row = database
            .prepare(
              `SELECT value, typeof(value) AS sqliteType, ` +
                `quote(value) AS sqliteQuote FROM ${table} WHERE id = ?`,
            )
            .get(candidate.name);

          result.output = {
            sqliteType: row.sqliteType,
            sqliteQuote: row.sqliteQuote,
            ...numberObservation(row.value),
          };
        } catch (error) {
          result.insert = {
            ok: false,
            errorName: error instanceof Error ? error.name : "UnknownError",
            errorCode:
              typeof error === "object" &&
              error !== null &&
              "code" in error &&
              typeof error.code === "string"
                ? error.code
                : null,
            errorMessage:
              error instanceof Error ? error.message : String(error),
          };
        }

        results.push(result);
      }
    }

    const runtime = database
      .prepare("SELECT sqlite_version() AS version")
      .get();

    return {
      schema: "personal-exploration-map.sqlite-special-number-probe.v1",
      runtime: {
        node: process.version,
        sqlite: runtime.version,
      },
      cases: CASES.map((candidate) => candidate.name),
      columns: COLUMNS.map((column) => ({
        name: column.name,
        declaration: column.declaration,
      })),
      results,
    };
  } finally {
    database.close();
  }
}

process.stdout.write(`${JSON.stringify(probe(), null, 2)}\n`);
