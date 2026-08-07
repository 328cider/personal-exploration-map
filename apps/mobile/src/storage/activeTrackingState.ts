import { getDatabase } from "./database";

const ACTIVE_CONTEXT_KEY = "active_tracking_context";
const LEGACY_ACTIVE_EXPLORATION_KEY = "active_exploration_id";
const LAST_BACKGROUND_ERROR_KEY = "last_background_error";

export interface ActiveTrackingContext {
  readonly personalMapId: string;
  readonly explorationId: string;
  readonly providerId: string;
}

interface LegacyExplorationContextRow {
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

export async function getActiveTrackingContext(): Promise<ActiveTrackingContext | null> {
  const serialized = await getStateValue(ACTIVE_CONTEXT_KEY);
  if (serialized !== null) {
    try {
      const parsed: unknown = JSON.parse(serialized);
      if (isActiveTrackingContext(parsed)) {
        return parsed;
      }
    } catch {
      // Fall through to recovery from the durable exploration row.
    }
  }

  const legacyExplorationId = await getStateValue(
    LEGACY_ACTIVE_EXPLORATION_KEY,
  );
  if (legacyExplorationId === null) {
    return null;
  }

  const database = await getDatabase();
  const row = await database.getFirstAsync<LegacyExplorationContextRow>(
    `SELECT personal_map_id, tracking_provider_id
     FROM explorations
     WHERE id = ? AND status = 'recording'`,
    legacyExplorationId,
  );
  if (row === null) {
    await clearActiveTrackingContext();
    return null;
  }

  const recovered: ActiveTrackingContext = {
    personalMapId: row.personal_map_id,
    explorationId: legacyExplorationId,
    providerId: row.tracking_provider_id,
  };
  await setActiveTrackingContext(recovered);
  return recovered;
}

export async function clearActiveTrackingContext(
  expectedExplorationId?: string,
): Promise<void> {
  const database = await getDatabase();
  await database.withExclusiveTransactionAsync(async (transaction) => {
    if (expectedExplorationId !== undefined) {
      const current = await transaction.getFirstAsync<{
        readonly value: string | null;
      }>("SELECT value FROM app_state WHERE key = ?", ACTIVE_CONTEXT_KEY);
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
