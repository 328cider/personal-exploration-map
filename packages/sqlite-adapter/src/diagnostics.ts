import type {
  TrackingDiagnosticEvent,
  TrackingDiagnosticEventKind,
  TrackingDiagnosticPayload,
} from "@exploration-map/mapping-engine";

import type { AsyncSqliteDatabaseProvider } from "./database.ts";

interface TrackingDiagnosticEventRow {
  readonly id: string;
  readonly personal_map_id: string;
  readonly exploration_id: string;
  readonly provider_id: string;
  readonly kind: TrackingDiagnosticEventKind;
  readonly occurred_at: number;
  readonly payload_json: string | null;
}

export interface TrackingDiagnosticsStore {
  append(event: TrackingDiagnosticEvent): Promise<boolean>;
  listForExploration(
    explorationId: string,
  ): Promise<readonly TrackingDiagnosticEvent[]>;
}

function parsePayload(value: string | null): TrackingDiagnosticPayload | undefined {
  if (value === null) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return undefined;
    }
    const result: Record<string, string | number | boolean | null> = {};
    for (const [key, item] of Object.entries(parsed)) {
      if (
        item === null ||
        typeof item === "string" ||
        typeof item === "boolean" ||
        (typeof item === "number" && Number.isFinite(item))
      ) {
        result[key] = item;
      }
    }
    return result;
  } catch {
    return undefined;
  }
}

function rowToEvent(row: TrackingDiagnosticEventRow): TrackingDiagnosticEvent {
  const payload = parsePayload(row.payload_json);
  return {
    id: row.id,
    personalMapId: row.personal_map_id,
    explorationId: row.exploration_id,
    providerId: row.provider_id,
    kind: row.kind,
    occurredAtMs: row.occurred_at,
    ...(payload === undefined ? {} : { payload }),
  };
}

/**
 * Stores operational tracking evidence separately from canonical map data.
 *
 * A failure to write diagnostics must be handled by the caller as best-effort;
 * the mapping engine and raw observation persistence remain authoritative.
 */
export function createSqliteTrackingDiagnosticsStore(
  getDatabase: AsyncSqliteDatabaseProvider,
): TrackingDiagnosticsStore {
  return {
    async append(event) {
      const database = await getDatabase();
      const result = await database.runAsync(
        `INSERT OR IGNORE INTO tracking_diagnostic_events(
          id,
          personal_map_id,
          exploration_id,
          provider_id,
          kind,
          occurred_at,
          payload_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        event.id,
        event.personalMapId,
        event.explorationId,
        event.providerId,
        event.kind,
        event.occurredAtMs,
        event.payload === undefined ? null : JSON.stringify(event.payload),
      );
      return result.changes > 0;
    },

    async listForExploration(explorationId) {
      const database = await getDatabase();
      const rows = await database.getAllAsync<TrackingDiagnosticEventRow>(
        `SELECT
          id,
          personal_map_id,
          exploration_id,
          provider_id,
          kind,
          occurred_at,
          payload_json
         FROM tracking_diagnostic_events
         WHERE exploration_id = ?
         ORDER BY occurred_at ASC, id ASC`,
        explorationId,
      );
      return rows.map(rowToEvent);
    },
  };
}
