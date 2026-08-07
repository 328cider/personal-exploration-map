import {
  createExplorationTrackingDiagnostics,
  type ExplorationTrackingDiagnostics,
  type TrackingDiagnosticEventKind,
  type TrackingDiagnosticPayload,
} from "@exploration-map/mapping-engine";
import { createSqliteTrackingDiagnosticsStore } from "@exploration-map/sqlite-adapter";

import {
  getActiveTrackingContext,
  type ActiveTrackingContext,
} from "../storage/activeTrackingState";
import { getDatabase, getMappingDatabase } from "../storage/database";
import { sqliteMappingRepository } from "../storage/sqliteMappingRepository";
import { createId } from "../utils/id";

const diagnosticsStore = createSqliteTrackingDiagnosticsStore(
  getMappingDatabase,
);

export interface ExplorationTrackingReportItem {
  readonly explorationId: string;
  readonly name: string;
  readonly providerId: string;
  readonly report: ExplorationTrackingDiagnostics;
}

interface ExplorationDiagnosticRow {
  readonly id: string;
  readonly name: string;
  readonly tracking_provider_id: string;
}

export async function recordTrackingDiagnosticEvent(input: {
  readonly context: ActiveTrackingContext;
  readonly kind: TrackingDiagnosticEventKind;
  readonly occurredAtMs?: number;
  readonly payload?: TrackingDiagnosticPayload;
}): Promise<boolean> {
  return diagnosticsStore.append({
    id: createId("tracking-event"),
    personalMapId: input.context.personalMapId,
    explorationId: input.context.explorationId,
    providerId: input.context.providerId,
    kind: input.kind,
    occurredAtMs: input.occurredAtMs ?? Date.now(),
    ...(input.payload === undefined ? {} : { payload: input.payload }),
  });
}

/**
 * Diagnostics must never interrupt canonical position persistence or provider
 * lifecycle. Callers use this helper on the tracking hot path.
 */
export async function recordTrackingDiagnosticBestEffort(input: {
  readonly context: ActiveTrackingContext;
  readonly kind: TrackingDiagnosticEventKind;
  readonly occurredAtMs?: number;
  readonly payload?: TrackingDiagnosticPayload;
}): Promise<void> {
  try {
    await recordTrackingDiagnosticEvent(input);
  } catch {
    // Operational evidence is useful but non-canonical. Never trade away a raw
    // location sample or a recoverable tracking session to record diagnostics.
  }
}

export async function recordActiveTrackingDiagnosticBestEffort(input: {
  readonly kind: TrackingDiagnosticEventKind;
  readonly occurredAtMs?: number;
  readonly payload?: TrackingDiagnosticPayload;
}): Promise<void> {
  const context = await getActiveTrackingContext();
  if (context === null) {
    return;
  }
  await recordTrackingDiagnosticBestEffort({ context, ...input });
}

export async function loadPersonalMapTrackingDiagnostics(
  personalMapId: string,
): Promise<readonly ExplorationTrackingReportItem[]> {
  const database = await getDatabase();
  const rows = await database.getAllAsync<ExplorationDiagnosticRow>(
    `SELECT id, name, tracking_provider_id
     FROM explorations
     WHERE personal_map_id = ?
     ORDER BY started_at ASC, id ASC`,
    personalMapId,
  );

  const reports: ExplorationTrackingReportItem[] = [];
  for (const row of rows) {
    const loaded = await sqliteMappingRepository.loadExploration(
      personalMapId,
      row.id,
    );
    if (loaded === null) {
      continue;
    }
    const events = await diagnosticsStore.listForExploration(row.id);
    reports.push({
      explorationId: row.id,
      name: row.name,
      providerId: row.tracking_provider_id,
      report: createExplorationTrackingDiagnostics({
        exploration: loaded.replay,
        providerId: row.tracking_provider_id,
        events,
      }),
    });
  }
  return reports;
}
