import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import type { RawPositionSample } from "../../mapping-core/src/index.ts";
import {
  loadPersonalMapBundleExportInput,
  type StoredExploration,
  type StoredPersonalMap,
} from "../../mapping-engine/src/index.ts";
import {
  CREATE_LEGACY_V1_SCHEMA_SQL,
  createSqliteMappingRepository,
  createSqlitePersonalMapBundleReadRepository,
  MAPPING_DATABASE_VERSION,
  migrateMappingDatabase,
  SQLITE_RAW_SAMPLE_PAYLOAD_FORMAT,
  SqliteRawEvidenceError,
  type AsyncSqliteDatabase,
  type AsyncSqliteExecutor,
  type SqliteBindValue,
  type SqliteRunResult,
} from "../src/index.ts";

class NodeSqliteDatabase implements AsyncSqliteDatabase {
  readonly database: DatabaseSync;
  readTransactionCount = 0;

  constructor(database = new DatabaseSync(":memory:")) {
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
    this.readTransactionCount += 1;
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

const MAP: StoredPersonalMap = {
  id: "map-exact",
  name: "Exact map",
  createdAtMs: 1_000,
  updatedAtMs: 1_000,
};

function exploration(id: string, startedAtMs: number): StoredExploration {
  return {
    id,
    personalMapId: MAP.id,
    name: id,
    startedAtMs,
    trackingProviderId: "gnss-background",
  };
}

function validSample(
  id: string,
  recordedAtMs: number,
  latitude = 35,
): RawPositionSample {
  return {
    id,
    recordedAtMs,
    source: "gnss",
    position: {
      kind: "geographic",
      latitude,
      longitude: 139,
    },
    horizontalAccuracyMeters: 5,
    confidence: 0.95,
  };
}

function specialSample(id: string): RawPositionSample {
  return {
    id,
    recordedAtMs: Number.NaN,
    source: "gnss",
    position: {
      kind: "geographic",
      latitude: Number.NaN,
      longitude: Number.POSITIVE_INFINITY,
      altitudeMeters: -0,
    },
    horizontalAccuracyMeters: Number.NEGATIVE_INFINITY,
    speedMetersPerSecond: -0,
    confidence: Number.NaN,
  };
}

async function createMapAndExploration(
  repository: ReturnType<typeof createSqliteMappingRepository>,
  record: StoredExploration,
  createMap: boolean,
): Promise<void> {
  await repository.runInTransaction(async (writer) => {
    if (createMap) {
      await writer.createPersonalMap(MAP);
    }
    await writer.createExploration(record);
  });
}

test("v4 migration keeps legacy order explicit without inventing an ordinal or exact payload", async () => {
  const database = new NodeSqliteDatabase();
  try {
    await database.execAsync("PRAGMA foreign_keys = ON;");
    await database.execAsync(CREATE_LEGACY_V1_SCHEMA_SQL);
    await database.runAsync(
      `INSERT INTO explorations(
        id, name, status, tracking_mode, frame_hint,
        started_at, ended_at, created_at, updated_at
      ) VALUES ('legacy', 'Legacy', 'completed', 'background', NULL,
        1000, 4000, 1000, 4000)`,
    );
    for (const [id, recordedAt] of [
      ["later-id", 3_000],
      ["earlier-b", 2_000],
      ["earlier-a", 2_000],
    ] as const) {
      await database.runAsync(
        `INSERT INTO position_samples(
          id, exploration_id, recorded_at, source, coordinate_kind,
          latitude, longitude, altitude_meters, x_meters, y_meters, floor_level,
          horizontal_accuracy_meters, heading_degrees,
          speed_meters_per_second, confidence
        ) VALUES (?, 'legacy', ?, 'gnss', 'geographic',
          35, 139, NULL, NULL, NULL, NULL, 5, NULL, NULL, 0.9)`,
        id,
        recordedAt,
      );
    }

    await migrateMappingDatabase(database);

    const version = await database.getFirstAsync<{ user_version: number }>(
      "PRAGMA user_version",
    );
    assert.equal(version?.user_version, MAPPING_DATABASE_VERSION);
    assert.deepEqual(
      await database.getAllAsync(
        `SELECT id, sample_ordinal, ordinal_provenance,
                raw_payload_format, raw_payload_json
         FROM position_samples
         ORDER BY recorded_at ASC, id ASC`,
      ),
      [
        {
          id: "earlier-a",
          sample_ordinal: null,
          ordinal_provenance: "legacy-recorded-at-id-v1",
          raw_payload_format: "legacy-normalized-v1",
          raw_payload_json: null,
        },
        {
          id: "earlier-b",
          sample_ordinal: null,
          ordinal_provenance: "legacy-recorded-at-id-v1",
          raw_payload_format: "legacy-normalized-v1",
          raw_payload_json: null,
        },
        {
          id: "later-id",
          sample_ordinal: null,
          ordinal_provenance: "legacy-recorded-at-id-v1",
          raw_payload_format: "legacy-normalized-v1",
          raw_payload_json: null,
        },
      ],
    );

    const mappingRepository = createSqliteMappingRepository(
      async () => database,
    );
    const replay = await mappingRepository.loadExploration("legacy", "legacy");
    assert.deepEqual(
      replay?.replay.samples.map((sample) => sample.id),
      ["earlier-a", "earlier-b", "later-id"],
    );

    const bundleRepository = createSqlitePersonalMapBundleReadRepository(
      async () => database,
    );
    await assert.rejects(
      loadPersonalMapBundleExportInput(bundleRepository, {
        personalMapId: "legacy",
      }),
      (error: unknown) => {
        assert.ok(error instanceof SqliteRawEvidenceError);
        assert.equal(error.code, "legacy-normalized-evidence");
        return true;
      },
    );
    assert.equal(database.readTransactionCount, 1);
    assert.deepEqual(
      await database.getAllAsync("PRAGMA foreign_key_check"),
      [],
    );
  } finally {
    database.close();
  }
});

test("new raw evidence preserves exact numbers and provider order while projection stays finite-only", async () => {
  const database = new NodeSqliteDatabase();
  try {
    await migrateMappingDatabase(database);
    const repository = createSqliteMappingRepository(async () => database);
    const first = exploration("session-a", 1_000);
    await createMapAndExploration(repository, first, true);

    const samples = [
      validSample("valid", 3_000),
      specialSample("special"),
      validSample("earlier", 2_000, 35.0001),
    ] as const;
    assert.deepEqual(
      await repository.runInTransaction((writer) =>
        writer.appendPositionSamples(first.id, samples),
      ),
      samples,
    );
    assert.deepEqual(
      await repository.runInTransaction((writer) =>
        writer.appendPositionSamples(first.id, [samples[1]]),
      ),
      [],
    );
    const final = validSample("final", 2_500, 35.0002);
    await repository.runInTransaction((writer) =>
      writer.appendPositionSamples(first.id, [final]),
    );

    const rows = await database.getAllAsync<{
      id: string;
      sample_ordinal: number;
      ordinal_provenance: string;
      raw_payload_format: string;
      recorded_at: number | null;
      latitude: number | null;
      longitude: number | null;
      altitude_meters: number | null;
      horizontal_accuracy_meters: number | null;
      speed_meters_per_second: number | null;
      confidence: number | null;
    }>(
      `SELECT id, sample_ordinal, ordinal_provenance, raw_payload_format,
              recorded_at, latitude, longitude, altitude_meters,
              horizontal_accuracy_meters, speed_meters_per_second, confidence
       FROM position_samples
       WHERE exploration_id = ?
       ORDER BY sample_ordinal`,
      first.id,
    );
    assert.deepEqual(
      rows.map((row) => ({
        id: row.id,
        ordinal: row.sample_ordinal,
        provenance: row.ordinal_provenance,
        format: row.raw_payload_format,
      })),
      [
        {
          id: "valid",
          ordinal: 0,
          provenance: "ingest-sequence-v1",
          format: SQLITE_RAW_SAMPLE_PAYLOAD_FORMAT,
        },
        {
          id: "special",
          ordinal: 1,
          provenance: "ingest-sequence-v1",
          format: SQLITE_RAW_SAMPLE_PAYLOAD_FORMAT,
        },
        {
          id: "earlier",
          ordinal: 2,
          provenance: "ingest-sequence-v1",
          format: SQLITE_RAW_SAMPLE_PAYLOAD_FORMAT,
        },
        {
          id: "final",
          ordinal: 3,
          provenance: "ingest-sequence-v1",
          format: SQLITE_RAW_SAMPLE_PAYLOAD_FORMAT,
        },
      ],
    );
    const specialProjection = rows[1]!;
    assert.equal(specialProjection.recorded_at, null);
    assert.equal(specialProjection.latitude, null);
    assert.equal(specialProjection.longitude, null);
    assert.equal(specialProjection.altitude_meters, 0);
    assert.equal(specialProjection.horizontal_accuracy_meters, null);
    assert.equal(specialProjection.speed_meters_per_second, 0);
    assert.equal(specialProjection.confidence, null);

    const loaded = await repository.loadExploration(MAP.id, first.id);
    assert.deepEqual(
      loaded?.replay.samples.map((sample) => sample.id),
      ["valid", "special", "earlier", "final"],
    );
    const restoredSpecial = loaded?.replay.samples[1];
    assert.ok(restoredSpecial !== undefined);
    assert.ok(Number.isNaN(restoredSpecial.recordedAtMs));
    assert.ok(Number.isNaN(restoredSpecial.confidence));
    assert.equal(
      restoredSpecial.horizontalAccuracyMeters,
      Number.NEGATIVE_INFINITY,
    );
    assert.ok(Object.is(restoredSpecial.speedMetersPerSecond, -0));
    assert.equal(restoredSpecial.position.kind, "geographic");
    if (restoredSpecial.position.kind === "geographic") {
      assert.ok(Number.isNaN(restoredSpecial.position.latitude));
      assert.equal(
        restoredSpecial.position.longitude,
        Number.POSITIVE_INFINITY,
      );
      assert.ok(Object.is(restoredSpecial.position.altitudeMeters, -0));
    }

    await assert.rejects(
      repository.runInTransaction((writer) =>
        writer.appendPositionSamples(first.id, [
          { ...samples[0], confidence: 0.5 },
        ]),
      ),
      (error: unknown) => {
        assert.ok(error instanceof SqliteRawEvidenceError);
        assert.equal(error.code, "exact-payload-identity-mismatch");
        return true;
      },
    );
  } finally {
    database.close();
  }
});

test("sample identity is exploration-scoped and exact bundle reads use one snapshot", async () => {
  const database = new NodeSqliteDatabase();
  try {
    await migrateMappingDatabase(database);
    const repository = createSqliteMappingRepository(async () => database);
    const first = exploration("session-a", 1_000);
    const second = exploration("session-b", 5_000);
    await createMapAndExploration(repository, first, true);
    await createMapAndExploration(repository, second, false);

    await repository.runInTransaction((writer) =>
      writer.appendPositionSamples(first.id, [validSample("shared-id", 2_000)]),
    );
    await repository.runInTransaction((writer) =>
      writer.appendPositionSamples(second.id, [
        validSample("shared-id", 6_000, 35.01),
      ]),
    );

    const bundleRepository = createSqlitePersonalMapBundleReadRepository(
      async () => database,
    );
    const input = await loadPersonalMapBundleExportInput(bundleRepository, {
      personalMapId: MAP.id,
    });

    assert.equal(database.readTransactionCount, 1);
    assert.deepEqual(
      input.explorations.map((item) => ({
        id: item.record.id,
        samples: item.rawSamples.map((sample) => sample.id),
      })),
      [
        { id: "session-a", samples: ["shared-id"] },
        { id: "session-b", samples: ["shared-id"] },
      ],
    );
    assert.equal(input.frameAtExport.kind, "geographic-local");
  } finally {
    database.close();
  }
});
