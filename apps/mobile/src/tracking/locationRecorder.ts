import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import type { TrackingProviderPort } from "@exploration-map/mapping-engine";

import { recordTrackingDiagnosticBestEffort } from "../diagnostics/trackingDiagnostics";
import {
  clearActiveTrackingContext,
  getActiveTrackingContext,
  recordBackgroundTaskError,
  setActiveTrackingContext,
  type ActiveTrackingContext,
} from "../storage/activeTrackingState";
import { BACKGROUND_LOCATION_TASK } from "./taskNames";
import type {
  GnssTrackingProviderSet,
  MobileTrackingDelivery,
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function contextFor(
  input: {
    readonly personalMapId: string;
    readonly explorationId: string;
  },
  providerId: string,
): ActiveTrackingContext {
  return {
    personalMapId: input.personalMapId,
    explorationId: input.explorationId,
    providerId,
  };
}

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

async function recordProviderEvent(
  context: ActiveTrackingContext,
  kind:
    | "provider.start.requested"
    | "provider.started"
    | "provider.start.failed"
    | "provider.stop.requested"
    | "provider.stopped"
    | "provider.stop.failed",
  payload?: Readonly<Record<string, string | number | boolean | null>>,
): Promise<void> {
  await recordTrackingDiagnosticBestEffort({
    context,
    kind,
    ...(payload === undefined ? {} : { payload }),
  });
}

async function releaseContextAfterStopFailure(
  context: ActiveTrackingContext | null,
  explorationId: string,
  delivery: MobileTrackingDelivery,
  error: unknown,
): Promise<void> {
  if (context !== null) {
    await recordProviderEvent(context, "provider.stop.failed", {
      delivery,
      message: errorMessage(error),
      canonicalCompletionContinues: true,
    });
  }

  // Provider shutdown is operational cleanup, not the authority for ending a
  // user's ExplorationSession. Release the app-side context so a transient OS
  // stop failure cannot trap the user on the recording screen. Any late
  // callback finds no active context and is ignored; orphan cleanup retries on
  // the next app start.
  await clearActiveTrackingContext(explorationId).catch(() => undefined);
}

/**
 * Creates platform tracking adapters for the headless mapping engine.
 *
 * Provider lifecycle diagnostics are operational evidence only. Failure to
 * write them cannot stop or roll back canonical raw-position persistence.
 */
export function createGnssTrackingProviderSet(
  ingestLocations: (
    locations: readonly Location.LocationObject[],
    delivery: MobileTrackingDelivery,
  ) => Promise<void>,
): GnssTrackingProviderSet {
  const backgroundProvider: TrackingProviderPort = {
    id: BACKGROUND_GNSS_PROVIDER_ID,
    coordinateKind: "geographic",

    async start(input) {
      const context = contextFor(input, BACKGROUND_GNSS_PROVIDER_ID);
      await recordProviderEvent(context, "provider.start.requested", {
        delivery: "background",
      });

      try {
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
          await recordProviderEvent(context, "provider.started", {
            delivery: "background",
            alreadyStarted: true,
          });
          return;
        }

        await setActiveTrackingContext(context);
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
        await recordProviderEvent(context, "provider.started", {
          delivery: "background",
          alreadyStarted: false,
        });
      } catch (error) {
        await recordProviderEvent(context, "provider.start.failed", {
          delivery: "background",
          message: errorMessage(error),
        });
        await clearActiveTrackingContext(input.explorationId);
        throw error;
      }
    },

    async stop(explorationId) {
      const active = await getActiveTrackingContext();
      const context =
        active?.explorationId === explorationId ? active : null;
      if (context !== null) {
        await recordProviderEvent(context, "provider.stop.requested", {
          delivery: "background",
        });
      }

      try {
        if (await backgroundTaskStarted()) {
          await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
        }
        if (context !== null) {
          await recordProviderEvent(context, "provider.stopped", {
            delivery: "background",
          });
        }
        await clearActiveTrackingContext(explorationId);
      } catch (error) {
        await releaseContextAfterStopFailure(
          context,
          explorationId,
          "background",
          error,
        );
      }
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
      const context = contextFor(input, FOREGROUND_GNSS_PROVIDER_ID);
      await recordProviderEvent(context, "provider.start.requested", {
        delivery: "foreground",
      });

      try {
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
          await recordProviderEvent(context, "provider.started", {
            delivery: "foreground",
            alreadyStarted: true,
          });
          return;
        }

        await setActiveTrackingContext(context);
        foregroundSubscription = await Location.watchPositionAsync(
          locationOptions,
          (location) => {
            void ingestLocations([location], "foreground").catch(
              (error: unknown) => {
                void recordBackgroundTaskError(errorMessage(error));
              },
            );
          },
        );
        foregroundExplorationId = input.explorationId;
        await recordProviderEvent(context, "provider.started", {
          delivery: "foreground",
          alreadyStarted: false,
        });
      } catch (error) {
        await recordProviderEvent(context, "provider.start.failed", {
          delivery: "foreground",
          message: errorMessage(error),
        });
        foregroundSubscription?.remove();
        foregroundSubscription = null;
        foregroundExplorationId = null;
        await clearActiveTrackingContext(input.explorationId);
        throw error;
      }
    },

    async stop(explorationId) {
      const active = await getActiveTrackingContext();
      const context =
        active?.explorationId === explorationId ? active : null;
      if (context !== null) {
        await recordProviderEvent(context, "provider.stop.requested", {
          delivery: "foreground",
        });
      }

      try {
        if (
          foregroundSubscription !== null &&
          foregroundExplorationId === explorationId
        ) {
          foregroundSubscription.remove();
          foregroundSubscription = null;
          foregroundExplorationId = null;
        }
        if (context !== null) {
          await recordProviderEvent(context, "provider.stopped", {
            delivery: "foreground",
          });
        }
        await clearActiveTrackingContext(explorationId);
      } catch (error) {
        foregroundSubscription = null;
        foregroundExplorationId = null;
        await releaseContextAfterStopFailure(
          context,
          explorationId,
          "foreground",
          error,
        );
      }
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
    const active = await getActiveTrackingContext();
    if (active !== null) {
      await recordProviderEvent(active, "provider.stop.requested", {
        reason: "orphan-cleanup",
      });
    }

    try {
      foregroundSubscription?.remove();
      foregroundSubscription = null;
      foregroundExplorationId = null;
      if (await backgroundTaskStarted()) {
        await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
      }
      if (active !== null) {
        await recordProviderEvent(active, "provider.stopped", {
          reason: "orphan-cleanup",
        });
      }
      await clearActiveTrackingContext();
    } catch (error) {
      if (active !== null) {
        await recordProviderEvent(active, "provider.stop.failed", {
          reason: "orphan-cleanup",
          message: errorMessage(error),
        });
      }
      throw error;
    }
  }

  return {
    providers: [backgroundProvider, foregroundProvider],
    status,
    stopOrphanedTracking,
  };
}
