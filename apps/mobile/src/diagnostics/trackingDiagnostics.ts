import {
  createExplorationTrackingDiagnostics,
  formatTrackingDiagnosticsSummary,
  type ExplorationTrackingDiagnostics,
  type TrackingDiagnosticEvent,
  type TrackingDiagnosticEventKind,
  type TrackingDiagnosticPayload,
} from "@exploration-map/mapping-engine";
import { createSqliteTrackingDiagnosticsStore } from "@exploration-map/sqlite-adapter";

import {
  captureFieldTestEnvironmentSnapshot,
  writeFieldTestTextFile,
} from "../../modules/field-test-diagnostics";
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
const environmentCaptureEnabled =
  __DEV__ || process.env.EXPO_PUBLIC_FIELD_TEST === "1";

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
    // Capture observation time before the queued SQLite write begins.
    occurredAtMs: input.occurredAtMs ?? Date.now(),
    ...(input.payload === undefined ? {} : { payload: input.payload }),
  };
}

function environmentPhaseFor(
  kind: TrackingDiagnosticEventKind,
): "started" | "ended" | null {
  if (kind === "provider.started") {
    return "started";
  }
  if (kind === "provider.stop.requested") {
    return "ended";
  }
  return null;
}

async function appendEnvironmentSnapshot(
  context: ActiveTrackingContext,
  phase: "started" | "ended",
): Promise<void> {
  if (!environmentCaptureEnabled) {
    return;
  }

  try {
    const snapshot = await captureFieldTestEnvironmentSnapshot();
    if (snapshot === null) {
      return;
    }
    await diagnosticsStore.append(
      createDiagnosticEvent({
        context,
        kind:
          phase === "started"
            ? "environment.session.started"
            : "environment.session.ended",
        occurredAtMs: snapshot.capturedAtMs,
        payload: { ...snapshot },
      }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await diagnosticsStore
      .append(
        createDiagnosticEvent({
          context,
          kind: "environment.snapshot.failed",
          payload: { phase, message },
        }),
      )
      .catch(() => undefined);
  }
}

function coordinateFreeSummary(
  reports: readonly ExplorationTrackingReportItem[],
): string {
  return [
    "Personal Exploration Map / USB field-test diagnostics",
    "privacy=no_coordinates_no_map_names_no_ids_no_marker_text_no_map_images",
    "contains=device_time_battery_permissions_and_aggregate_tracking_metrics",
    `exploration_count=${reports.length}`,
    ...reports.map(
      ({ report }, index) =>
        `[exploration_${index + 1}]\n${formatTrackingDiagnosticsSummary(report)}`,
    ),
  ].join("\n\n");
}

async function persistCoordinateFreeSummary(
  reports: readonly ExplorationTrackingReportItem[],
): Promise<void> {
  if (!environmentCaptureEnabled || reports.length === 0) {
    return;
  }
  const content = coordinateFreeSummary(reports);
  const latestStartedAtMs = reports.at(-1)?.report.startedAtMs ?? Date.now();
  await Promise.all([
    writeFieldTestTextFile("latest-coordinate-free-diagnostics.txt", content),
    writeFieldTestTextFile(
      `diagnostics-${Math.round(latestStartedAtMs)}.txt`,
      content,
    ),
  ]).catch(() => undefined);
}

export async function recordTrackingDiagnosticEvent(
  input: DiagnosticInput,
): Promise<boolean> {
  return diagnosticsStore.append(createDiagnosticEvent(input));
}

/**
 * Queue a best-effort diagnostic write and resolve immediately.
 *
 * Canonical position persistence and provider lifecycle never wait for this
 * queue. Events are serialized to avoid concurrent SQLite writes, while Review
 * explicitly waits for events already queued by the current process.
 */
export function recordTrackingDiagnosticBestEffort(
  input: DiagnosticInput,
): Promise<void> {
  const event = createDiagnosticEvent(input);
  const environmentPhase = environmentPhaseFor(input.kind);
  diagnosticWriteQueue = diagnosticWriteQueue.then(async () => {
    try {
      await diagnosticsStore.append(event);
      if (environmentPhase !== null) {
        await appendEnvironmentSnapshot(input.context, environmentPhase);
      }
    } catch {
      // Operational evidence is useful but non-canonical. Never trade away a
      // raw location sample or recoverable tracking session for diagnostics.
    }
  });
  return Promise.resolve();
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
  void recordTrackingDiagnosticBestEffort({ context, ...input });
}

export async function loadPersonalMapTrackingDiagnostics(
  personalMapId: string,
): Promise<readonly ExplorationTrackingReportItem[]> {
  // Make a Review opened immediately after stopping deterministic: wait only
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
  await persistCoordinateFreeSummary(reports);
  return reports;
}
