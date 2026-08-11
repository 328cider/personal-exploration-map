import type { TrackingProviderPort } from "@exploration-map/mapping-engine";

export type MobileTrackingMode = "background" | "foreground";
export type MobileTrackingDelivery =
  | "background"
  | "foreground"
  | "foreground-refresh";
export type ActiveLocationRefreshReason =
  | "app-active"
  | "marker-open"
  | "marker-save";

export interface ActiveLocationRefreshResult {
  readonly status: "inactive" | "refreshed" | "failed";
  readonly reason: ActiveLocationRefreshReason;
  readonly observationAtMs: number | null;
  readonly receivedAtMs: number | null;
}

export interface TrackingPermissionState {
  readonly foregroundGranted: boolean;
  readonly backgroundGranted: boolean;
  readonly canAskForegroundAgain: boolean;
  readonly canAskBackgroundAgain: boolean;
}

export interface MobileTrackingRuntimeStatus {
  readonly mode: MobileTrackingMode | null;
  readonly running: boolean;
  readonly taskManagerAvailable: boolean;
  readonly providerId: string | null;
  readonly explorationId: string | null;
}

export interface GnssTrackingProviderSet {
  readonly providers: readonly TrackingProviderPort[];
  status(): Promise<MobileTrackingRuntimeStatus>;
  refreshCurrentLocation(
    reason: ActiveLocationRefreshReason,
  ): Promise<ActiveLocationRefreshResult>;
  stopOrphanedTracking(): Promise<void>;
}
