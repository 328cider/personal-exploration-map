import {
  createExplorationTrackingDiagnostics,
  type ExplorationTrackingDiagnostics,
  type TrackingDiagnosticEvent,
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

let diagnosticWriteQueue: Promise<void> = Promise.resolve();

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

interface DiagnosticInput {
  readonly context: ActiveTrackingContext;
  readonly kind: TrackingDiagnosticEventKind;
  readonly occurredAtMs?: number;
  readonly payload?: TrackingDiagnosticPayload;
}

function createDiagnosticEvent(input: DiagnosticInput): TrackingDiagnosticEvent {
  return {
    id: createId("tracking-event"),
    personalMapId: input.context.personalMapId,
    explorationId: input.context.explorationId,
    providerId: input.context.providerId,
    kind: input.kind,
    // Capture the observation time before a queued SQLite write begins.
    occurredAtMs: input.occurredAtMs ?? Date.now(),
    ...(input.payload === undefined ? {} : { payload: input.payload }),
  };
}

export async function recordTrackingDiagnosticEvent(
  input: DiagnosticInput,
): Promise<boolean> {
  return diagnosticsStore.append(createDiagnosticEvent(input));
}

/**
 * Diagnostics must never interrupt canonical position persistence or provider
 * lifecycle. Events are timestamped immediately, then serialized through a
 * private best-effort queue to avoid concurrent SQLite writes on callback hot
 * paths. The returned promise may be awaited by lifecycle code, but callback
 * ingestion deliberately fires it without waiting.
 */
export function recordTrackingDiagnosticBestEffort(
  input: DiagnosticInput,
): Promise<void> {
  const event = createDiagnosticEvent(input);
  const write = diagnosticWriteQueue.then(async () => {
    try {
      await diagnosticsStore.append(event);
    } catch {
      // Operational evidence is useful but non-canonical. Never trade away a
      // raw location sample or recoverable tracking session for diagnostics.
    }
  });
  // Each queued task handles its own persistence failure, so the queue remains
  // usable even after an individual diagnostic insert cannot be written.
  diagnosticWriteQueue = write;
  return write;
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
  // Make a review opened immediately after stopping deterministic: wait only
  // for diagnostics already queued by this process, never for future events.
  await diagnosticWriteQueue;

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
