import type {
  AsyncSqliteDatabase,
  AsyncSqliteExecutor,
} from "./database.ts";

export const MAPPING_DATABASE_VERSION = 3;

export const CREATE_LEGACY_V1_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS explorations (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('recording', 'completed')),
    tracking_mode TEXT NOT NULL CHECK (tracking_mode IN ('background', 'foreground', 'demo')),
    frame_hint TEXT,
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS position_samples (
    id TEXT PRIMARY KEY NOT NULL,
    exploration_id TEXT NOT NULL,
    recorded_at INTEGER NOT NULL,
    source TEXT NOT NULL,
    coordinate_kind TEXT NOT NULL CHECK (coordinate_kind IN ('geographic', 'local')),
    latitude REAL,
    longitude REAL,
    altitude_meters REAL,
    x_meters REAL,
    y_meters REAL,
    floor_level INTEGER,
    horizontal_accuracy_meters REAL,
    heading_degrees REAL,
    speed_meters_per_second REAL,
    confidence REAL NOT NULL,
    FOREIGN KEY (exploration_id) REFERENCES explorations(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS position_samples_exploration_time
    ON position_samples(exploration_id, recorded_at);

  CREATE UNIQUE INDEX IF NOT EXISTS position_samples_unique_observation
    ON position_samples(exploration_id, recorded_at, source);

  CREATE TABLE IF NOT EXISTS markers (
    id TEXT PRIMARY KEY NOT NULL,
    exploration_id TEXT NOT NULL,
    recorded_at INTEGER NOT NULL,
    category TEXT NOT NULL,
    label TEXT NOT NULL,
    note TEXT,
    coordinate_kind TEXT,
    latitude REAL,
    longitude REAL,
    altitude_meters REAL,
    x_meters REAL,
    y_meters REAL,
    floor_level INTEGER,
    FOREIGN KEY (exploration_id) REFERENCES explorations(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS markers_exploration_time
    ON markers(exploration_id, recorded_at);

  CREATE TABLE IF NOT EXISTS app_state (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT
  );

  PRAGMA user_version = 1;
`;

export const MIGRATE_V1_TO_V2_SQL = `
  CREATE TABLE personal_maps (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE INDEX personal_maps_updated_at
    ON personal_maps(updated_at DESC);

  INSERT INTO personal_maps(id, name, created_at, updated_at)
  SELECT id, name, created_at, updated_at
  FROM explorations;

  CREATE TABLE explorations_v2 (
    id TEXT PRIMARY KEY NOT NULL,
    personal_map_id TEXT NOT NULL,
    name TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('recording', 'completed')),
    tracking_provider_id TEXT NOT NULL,
    tracking_mode TEXT CHECK (
      tracking_mode IS NULL OR
      tracking_mode IN ('background', 'foreground', 'demo')
    ),
    frame_hint TEXT,
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (personal_map_id) REFERENCES personal_maps(id) ON DELETE CASCADE
  );

  INSERT INTO explorations_v2(
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
  )
  SELECT
    id,
    id,
    name,
    status,
    CASE tracking_mode
      WHEN 'background' THEN 'gnss-background'
      WHEN 'foreground' THEN 'gnss-foreground'
      WHEN 'demo' THEN 'simulation'
    END,
    tracking_mode,
    frame_hint,
    started_at,
    ended_at,
    created_at,
    updated_at
  FROM explorations;

  DROP TABLE explorations;
  ALTER TABLE explorations_v2 RENAME TO explorations;

  CREATE INDEX explorations_personal_map_started
    ON explorations(personal_map_id, started_at);

  DROP INDEX IF EXISTS position_samples_unique_observation;

  PRAGMA user_version = 2;
`;

export const MIGRATE_V2_TO_V3_SQL = `
  CREATE TABLE tracking_diagnostic_events (
    id TEXT PRIMARY KEY NOT NULL,
    personal_map_id TEXT NOT NULL,
    exploration_id TEXT NOT NULL,
    provider_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    occurred_at INTEGER NOT NULL,
    payload_json TEXT,
    FOREIGN KEY (personal_map_id) REFERENCES personal_maps(id) ON DELETE CASCADE,
    FOREIGN KEY (exploration_id) REFERENCES explorations(id) ON DELETE CASCADE
  );

  CREATE INDEX tracking_diagnostic_events_exploration_time
    ON tracking_diagnostic_events(exploration_id, occurred_at, id);

  CREATE INDEX tracking_diagnostic_events_kind_time
    ON tracking_diagnostic_events(kind, occurred_at);

  PRAGMA user_version = 3;
`;

interface UserVersionRow {
  readonly user_version: number;
}

interface ForeignKeyViolation {
  readonly table: string;
  readonly rowid: number;
  readonly parent: string;
  readonly fkid: number;
}

async function readUserVersion(
  database: AsyncSqliteExecutor,
): Promise<number> {
  const row = await database.getFirstAsync<UserVersionRow>(
    "PRAGMA user_version",
  );
  return row?.user_version ?? 0;
}

async function runExclusive(
  database: AsyncSqliteDatabase,
  operation: (transaction: AsyncSqliteExecutor) => Promise<void>,
): Promise<void> {
  await database.withExclusiveTransactionAsync(operation);
}

async function assertForeignKeyIntegrity(
  database: AsyncSqliteDatabase,
): Promise<void> {
  const violations = await database.getAllAsync<ForeignKeyViolation>(
    "PRAGMA foreign_key_check",
  );
  if (violations.length > 0) {
    throw new Error(
      `Mapping database migration left ${violations.length} foreign-key violation(s).`,
    );
  }
}

/**
 * Migrates the local-first mapping database without discarding canonical raw
 * evidence. Operational diagnostics are added in v3 as a separate table and
 * never become authoritative map data.
 */
export async function migrateMappingDatabase(
  database: AsyncSqliteDatabase,
): Promise<void> {
  await database.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
  `);

  let version = await readUserVersion(database);
  if (version > MAPPING_DATABASE_VERSION) {
    throw new Error(
      `Mapping database version ${version} is newer than supported version ${MAPPING_DATABASE_VERSION}.`,
    );
  }

  if (version < 1) {
    await runExclusive(database, async (transaction) => {
      await transaction.execAsync(CREATE_LEGACY_V1_SCHEMA_SQL);
    });
    version = 1;
  }

  if (version < 2) {
    // SQLite cannot rebuild a referenced parent table while foreign-key
    // enforcement is enabled. Disable it only for the exclusive migration,
    // restore it in finally, then verify the complete graph before returning.
    await database.execAsync("PRAGMA foreign_keys = OFF;");
    try {
      await runExclusive(database, async (transaction) => {
        await transaction.execAsync(MIGRATE_V1_TO_V2_SQL);
      });
    } finally {
      await database.execAsync("PRAGMA foreign_keys = ON;");
    }
    await assertForeignKeyIntegrity(database);
    version = 2;
  }

  if (version < 3) {
    await runExclusive(database, async (transaction) => {
      await transaction.execAsync(MIGRATE_V2_TO_V3_SQL);
    });
    await assertForeignKeyIntegrity(database);
    version = 3;
  }

  if (version !== MAPPING_DATABASE_VERSION) {
    throw new Error(
      `Mapping database migration stopped at version ${version}; expected ${MAPPING_DATABASE_VERSION}.`,
    );
  }
}
