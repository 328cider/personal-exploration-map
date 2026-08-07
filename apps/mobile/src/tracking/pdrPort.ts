import type { RawPositionSample } from "@exploration-map/mapping-core";

/**
 * Contract for the GPS-denied technical spike.
 *
 * This intentionally has no production implementation yet. A provider must emit
 * replayable local-coordinate observations and report uncertainty; it must not
 * fabricate walls, rooms, or paths as facts.
 */
export interface PocketPdrProvider {
  readonly id: string;
  start(originRecordedAtMs: number): Promise<void>;
  stop(): Promise<readonly RawPositionSample[]>;
  getLiveConfidence(): Promise<number | null>;
}
