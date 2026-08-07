import * as SQLite from "expo-sqlite";

const DATABASE_NAME = "personal-exploration-map.db";
const DATABASE_VERSION = 1;

let databasePromise: Promise<SQLite.SQLiteDatabase> | undefined;

async function migrate(database: SQLite.SQLiteDatabase): Promise<void> {
  const versionRow = await database.getFirstAsync<{ user_version: number }>(
    "PRAGMA user_version",
  );
  const currentVersion = versionRow?.user_version ?? 0;
  if (currentVersion >= DATABASE_VERSION) {
    return;
  }

  await database.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

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
  `);
}

export async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  databasePromise ??= SQLite.openDatabaseAsync(DATABASE_NAME).then(
    async (database) => {
      await migrate(database);
      return database;
    },
  );
  return databasePromise;
}

export async function initializeDatabase(): Promise<void> {
  await getDatabase();
}
