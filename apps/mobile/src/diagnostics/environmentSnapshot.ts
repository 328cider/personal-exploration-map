import type {
  TrackingDiagnosticPayload,
  TrackingDiagnosticEventKind,
} from "@exploration-map/mapping-engine";

import { captureFieldTestEnvironmentSnapshot } from "../../modules/field-test-diagnostics";
import type { ActiveTrackingContext } from "../storage/activeTrackingState";
import { recordTrackingDiagnosticBestEffort } from "./trackingDiagnostics";

const ENVIRONMENT_CAPTURE_ENABLED =
  __DEV__ || process.env.EXPO_PUBLIC_FIELD_TEST === "1";

type EnvironmentPhase = "started" | "ended";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function recordEnvironmentSnapshotBestEffort(input: {
  readonly context: ActiveTrackingContext;
  readonly phase: EnvironmentPhase;
}): Promise<void> {
  if (!ENVIRONMENT_CAPTURE_ENABLED) {
    return;
  }

  try {
    const snapshot = await captureFieldTestEnvironmentSnapshot();
    if (snapshot === null) {
      return;
    }
    const kind: TrackingDiagnosticEventKind =
      input.phase === "started"
        ? "environment.session.started"
        : "environment.session.ended";
    const payload: TrackingDiagnosticPayload = { ...snapshot };
    await recordTrackingDiagnosticBestEffort({
      context: input.context,
      kind,
      occurredAtMs: snapshot.capturedAtMs,
      payload,
    });
  } catch (error) {
    await recordTrackingDiagnosticBestEffort({
      context: input.context,
      kind: "environment.snapshot.failed",
      payload: {
        phase: input.phase,
        message: errorMessage(error),
      },
    });
  }
}
