import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import type { TrackingProviderPort } from "@exploration-map/mapping-engine";

import {
  clearActiveTrackingContext,
  getActiveTrackingContext,
  recordBackgroundTaskError,
  setActiveTrackingContext,
} from "../storage/activeTrackingState";
import { BACKGROUND_LOCATION_TASK } from "./taskNames";
import type {
  GnssTrackingProviderSet,
  MobileTrackingRuntimeStatus,
  TrackingPermissionState,
} from "./types";

export const BACKGROUND_GNSS_PROVIDER_ID = "gnss-background";
export const FOREGROUND_GNSS_PROVIDER_ID = "gnss-foreground";

let foregroundSubscription: Location.LocationSubscription | null = null;
let foregroundExplorationId: string | null = null;

const locationOptions: Location.LocationOptions = {
  accuracy: Location.Accuracy.High,
  distanceInterval: 3,
  timeInterval: 5_000,
};

export async function getTrackingPermissionState(): Promise<TrackingPermissionState> {
  const [foreground, background] = await Promise.all([
    Location.getForegroundPermissionsAsync(),
    Location.getBackgroundPermissionsAsync(),
  ]);
  return {
    foregroundGranted: foreground.granted,
    backgroundGranted: background.granted,
    canAskForegroundAgain: foreground.canAskAgain,
    canAskBackgroundAgain: background.canAskAgain,
  };
}

export async function requestForegroundTrackingPermission(): Promise<boolean> {
  const permission = await Location.requestForegroundPermissionsAsync();
  return permission.granted;
}

export async function requestBackgroundTrackingPermission(): Promise<boolean> {
  const permission = await Location.requestBackgroundPermissionsAsync();
  return permission.granted;
}

async function backgroundTaskStarted(): Promise<boolean> {
  try {
    return await Location.hasStartedLocationUpdatesAsync(
      BACKGROUND_LOCATION_TASK,
    );
  } catch {
    return false;
  }
}

async function assertCompatibleActiveContext(
  input: {
    readonly personalMapId: string;
    readonly explorationId: string;
  },
  providerId: string,
): Promise<void> {
  const active = await getActiveTrackingContext();
  if (active === null) {
    return;
  }
  if (
    active.personalMapId !== input.personalMapId ||
    active.explorationId !== input.explorationId ||
    active.providerId !== providerId
  ) {
    throw new Error(
      "別の探索が記録中です。終了してから新しい探索を始めてください。",
    );
  }
}

/**
 * Creates platform tracking adapters for the headless mapping engine.
 *
 * The providers persist the active map/session context before the OS can emit
 * observations. Foreground callbacks use the injected ingestion function;
 * the top-level background task resolves the same durable context after a
 * process restart.
 */
export function createGnssTrackingProviderSet(
  ingestLocations: (
    locations: readonly Location.LocationObject[],
  ) => Promise<void>,
): GnssTrackingProviderSet {
  const backgroundProvider: TrackingProviderPort = {
    id: BACKGROUND_GNSS_PROVIDER_ID,
    coordinateKind: "geographic",

    async start(input) {
      const available = await TaskManager.isAvailableAsync();
      if (!available) {
        throw new Error(
          "このビルドではバックグラウンド記録を利用できません。development buildを使用してください。",
        );
      }

      await assertCompatibleActiveContext(
        input,
        BACKGROUND_GNSS_PROVIDER_ID,
      );
      const alreadyStarted = await backgroundTaskStarted();
      if (alreadyStarted) {
        return;
      }

      await setActiveTrackingContext({
        personalMapId: input.personalMapId,
        explorationId: input.explorationId,
        providerId: BACKGROUND_GNSS_PROVIDER_ID,
      });

      try {
        await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
          ...locationOptions,
          activityType: Location.ActivityType.Fitness,
          pausesUpdatesAutomatically: false,
          showsBackgroundLocationIndicator: true,
          deferredUpdatesDistance: 10,
          deferredUpdatesInterval: 15_000,
          foregroundService: {
            notificationTitle: "探索を記録中",
            notificationBody: "スマホをしまったまま移動を地図に残しています。",
            killServiceOnDestroy: false,
          },
        });
      } catch (error) {
        await clearActiveTrackingContext(input.explorationId);
        throw error;
      }
    },

    async stop(explorationId) {
      if (await backgroundTaskStarted()) {
        await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
      }
      await clearActiveTrackingContext(explorationId);
    },

    async status() {
      const active = await getActiveTrackingContext();
      return {
        running:
          active?.providerId === BACKGROUND_GNSS_PROVIDER_ID &&
          (await backgroundTaskStarted()),
        providerId: active?.providerId ?? null,
        explorationId: active?.explorationId ?? null,
      };
    },
  };

  const foregroundProvider: TrackingProviderPort = {
    id: FOREGROUND_GNSS_PROVIDER_ID,
    coordinateKind: "geographic",

    async start(input) {
      await assertCompatibleActiveContext(
        input,
        FOREGROUND_GNSS_PROVIDER_ID,
      );
      if (
        foregroundSubscription !== null &&
        foregroundExplorationId !== input.explorationId
      ) {
        throw new Error(
          "別の前面探索が動作中です。停止してから再試行してください。",
        );
      }
      if (
        foregroundSubscription !== null &&
        foregroundExplorationId === input.explorationId
      ) {
        return;
      }

      await setActiveTrackingContext({
        personalMapId: input.personalMapId,
        explorationId: input.explorationId,
        providerId: FOREGROUND_GNSS_PROVIDER_ID,
      });

      try {
        foregroundSubscription = await Location.watchPositionAsync(
          locationOptions,
          (location) => {
            void ingestLocations([location]).catch((error: unknown) => {
              const message =
                error instanceof Error ? error.message : String(error);
              void recordBackgroundTaskError(message);
            });
          },
        );
        foregroundExplorationId = input.explorationId;
      } catch (error) {
        foregroundSubscription?.remove();
        foregroundSubscription = null;
        foregroundExplorationId = null;
        await clearActiveTrackingContext(input.explorationId);
        throw error;
      }
    },

    async stop(explorationId) {
      if (
        foregroundSubscription !== null &&
        foregroundExplorationId === explorationId
      ) {
        foregroundSubscription.remove();
        foregroundSubscription = null;
        foregroundExplorationId = null;
      }
      await clearActiveTrackingContext(explorationId);
    },

    async status() {
      const active = await getActiveTrackingContext();
      return {
        running:
          foregroundSubscription !== null &&
          foregroundExplorationId !== null &&
          active?.providerId === FOREGROUND_GNSS_PROVIDER_ID &&
          active.explorationId === foregroundExplorationId,
        providerId: active?.providerId ?? null,
        explorationId: active?.explorationId ?? null,
      };
    },
  };

  async function status(): Promise<MobileTrackingRuntimeStatus> {
    const [taskManagerAvailable, active, backgroundStarted] = await Promise.all([
      TaskManager.isAvailableAsync(),
      getActiveTrackingContext(),
      backgroundTaskStarted(),
    ]);

    if (
      active?.providerId === BACKGROUND_GNSS_PROVIDER_ID &&
      backgroundStarted
    ) {
      return {
        mode: "background",
        running: true,
        taskManagerAvailable,
        providerId: active.providerId,
        explorationId: active.explorationId,
      };
    }

    if (
      active?.providerId === FOREGROUND_GNSS_PROVIDER_ID &&
      foregroundSubscription !== null &&
      foregroundExplorationId === active.explorationId
    ) {
      return {
        mode: "foreground",
        running: true,
        taskManagerAvailable,
        providerId: active.providerId,
        explorationId: active.explorationId,
      };
    }

    return {
      mode:
        active?.providerId === BACKGROUND_GNSS_PROVIDER_ID
          ? "background"
          : active?.providerId === FOREGROUND_GNSS_PROVIDER_ID
            ? "foreground"
            : null,
      running: false,
      taskManagerAvailable,
      providerId: active?.providerId ?? null,
      explorationId: active?.explorationId ?? null,
    };
  }

  async function stopOrphanedTracking(): Promise<void> {
    foregroundSubscription?.remove();
    foregroundSubscription = null;
    foregroundExplorationId = null;
    if (await backgroundTaskStarted()) {
      await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
    }
    await clearActiveTrackingContext();
  }

  return {
    providers: [backgroundProvider, foregroundProvider],
    status,
    stopOrphanedTracking,
  };
}
