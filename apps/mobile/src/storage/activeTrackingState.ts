import { getDatabase } from "./database";

const ACTIVE_CONTEXT_KEY = "active_tracking_context";
const LEGACY_ACTIVE_EXPLORATION_KEY = "active_exploration_id";
const LAST_BACKGROUND_ERROR_KEY = "last_background_error";

export interface ActiveTrackingContext {
  readonly personalMapId: string;
  readonly explorationId: string;
  readonly providerId: string;
}

interface ExplorationContextRow {
  readonly id: string;
  readonly personal_map_id: string;
  readonly tracking_provider_id: string;
}

function isActiveTrackingContext(
  value: unknown,
): value is ActiveTrackingContext {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.personalMapId === "string" &&
    record.personalMapId.length > 0 &&
    typeof record.explorationId === "string" &&
    record.explorationId.length > 0 &&
    typeof record.providerId === "string" &&
    record.providerId.length > 0
  );
}

async function getStateValue(key: string): Promise<string | null> {
  const database = await getDatabase();
  const row = await database.getFirstAsync<{ readonly value: string | null }>(
    "SELECT value FROM app_state WHERE key = ?",
    key,
  );
  return row?.value ?? null;
}

export async function setActiveTrackingContext(
  context: ActiveTrackingContext,
): Promise<void> {
  const database = await getDatabase();
  await database.withExclusiveTransactionAsync(async (transaction) => {
    await transaction.runAsync(
      `INSERT INTO app_state(key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      ACTIVE_CONTEXT_KEY,
      JSON.stringify(context),
    );
    await transaction.runAsync(
      `INSERT INTO app_state(key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      LEGACY_ACTIVE_EXPLORATION_KEY,
      context.explorationId,
    );
  });
}

async function loadRecordingContext(
  preferredExplorationId: string | null,
): Promise<ActiveTrackingContext | null> {
  const database = await getDatabase();
  const row =
    preferredExplorationId === null
      ? await database.getFirstAsync<ExplorationContextRow>(
          `SELECT id, personal_map_id, tracking_provider_id
           FROM explorations
           WHERE status = 'recording'
           ORDER BY started_at DESC, id DESC
           LIMIT 1`,
        )
      : await database.getFirstAsync<ExplorationContextRow>(
          `SELECT id, personal_map_id, tracking_provider_id
           FROM explorations
           WHERE id = ? AND status = 'recording'`,
          preferredExplorationId,
        );

  if (row === null) {
    return null;
  }
  return {
    personalMapId: row.personal_map_id,
    explorationId: row.id,
    providerId: row.tracking_provider_id,
  };
}

export async function getActiveTrackingContext(): Promise<ActiveTrackingContext | null> {
  // Read sequentially through the shared serialized database boundary. Running
  // these statements with Promise.all can make Expo SQLite release one native
  // statement while the other operation is still using the same database.
  const serialized = await getStateValue(ACTIVE_CONTEXT_KEY);
  const legacyExplorationId = await getStateValue(
    LEGACY_ACTIVE_EXPLORATION_KEY,
  );

  let serializedContext: ActiveTrackingContext | null = null;
  if (serialized !== null) {
    try {
      const parsed: unknown = JSON.parse(serialized);
      if (isActiveTrackingContext(parsed)) {
        serializedContext = parsed;
      }
    } catch {
      // Recover from the durable exploration row below.
    }
  }

  const preferredExplorationId =
    serializedContext?.explorationId ?? legacyExplorationId;
  const preferred = await loadRecordingContext(preferredExplorationId);
  const durable =
    preferred ??
    (preferredExplorationId === null
      ? null
      : await loadRecordingContext(null));

  if (durable === null) {
    if (serialized !== null || legacyExplorationId !== null) {
      await clearActiveTrackingContext();
    }
    return null;
  }

  // A missing or stale app_state can occur if the process dies after the
  // canonical session transaction but before a platform provider stores its
  // context. Recover the durable recording row rather than starting a second
  // exploration.
  if (
    serializedContext?.personalMapId !== durable.personalMapId ||
    serializedContext?.providerId !== durable.providerId ||
    serializedContext?.explorationId !== durable.explorationId ||
    legacyExplorationId !== durable.explorationId
  ) {
    await setActiveTrackingContext(durable);
  }
  return durable;
}

export async function clearActiveTrackingContext(
  expectedExplorationId?: string,
): Promise<void> {
  const database = await getDatabase();
  await database.withExclusiveTransactionAsync(async (transaction) => {
    if (expectedExplorationId !== undefined) {
      // A transaction executor is already inside the top-level database queue.
      // Its statements must stay sequential rather than using Promise.all.
      const current = await transaction.getFirstAsync<{
        readonly value: string | null;
      }>("SELECT value FROM app_state WHERE key = ?", ACTIVE_CONTEXT_KEY);
      const legacy = await transaction.getFirstAsync<{
        readonly value: string | null;
      }>(
        "SELECT value FROM app_state WHERE key = ?",
        LEGACY_ACTIVE_EXPLORATION_KEY,
      );

      if (current?.value !== null && current?.value !== undefined) {
        try {
          const parsed: unknown = JSON.parse(current.value);
          if (
            isActiveTrackingContext(parsed) &&
            parsed.explorationId !== expectedExplorationId
          ) {
            return;
          }
        } catch {
          // Invalid state should be cleared rather than preserved.
        }
      } else if (
        legacy?.value !== null &&
        legacy?.value !== undefined &&
        legacy.value !== expectedExplorationId
      ) {
        return;
      }
    }

    await transaction.runAsync(
      "DELETE FROM app_state WHERE key IN (?, ?)",
      ACTIVE_CONTEXT_KEY,
      LEGACY_ACTIVE_EXPLORATION_KEY,
    );
  });
}

export async function recordBackgroundTaskError(
  message: string,
): Promise<void> {
  const database = await getDatabase();
  await database.runAsync(
    `INSERT INTO app_state(key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    LAST_BACKGROUND_ERROR_KEY,
    JSON.stringify({
      message: message.slice(0, 1_000),
      occurredAtMs: Date.now(),
    }),
  );
}
