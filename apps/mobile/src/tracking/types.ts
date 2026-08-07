import type { TrackingMode } from "../storage/explorationRepository";

export interface TrackingPermissionState {
  readonly foregroundGranted: boolean;
  readonly backgroundGranted: boolean;
  readonly canAskForegroundAgain: boolean;
  readonly canAskBackgroundAgain: boolean;
}

export interface TrackingRuntimeStatus {
  readonly mode: TrackingMode | null;
  readonly running: boolean;
  readonly taskManagerAvailable: boolean;
}

export interface TrackingProvider {
  readonly id: string;
  readonly coordinateKind: "geographic" | "local";
  start(mode: Exclude<TrackingMode, "demo">): Promise<void>;
  stop(): Promise<void>;
  status(): Promise<TrackingRuntimeStatus>;
}
