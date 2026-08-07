import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";

import { appendLocationBatch } from "../storage/explorationRepository";
import { BACKGROUND_LOCATION_TASK } from "./backgroundLocationTask";
import type {
  TrackingPermissionState,
  TrackingProvider,
  TrackingRuntimeStatus,
} from "./types";

let foregroundSubscription: Location.LocationSubscription | null = null;
let activeMode: "background" | "foreground" | null = null;

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

async function startBackgroundTracking(): Promise<void> {
  const available = await TaskManager.isAvailableAsync();
  if (!available) {
    throw new Error(
      "このビルドではバックグラウンド記録を利用できません。development buildを使用してください。",
    );
  }

  const alreadyStarted = await Location.hasStartedLocationUpdatesAsync(
    BACKGROUND_LOCATION_TASK,
  );
  if (alreadyStarted) {
    activeMode = "background";
    return;
  }

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
  activeMode = "background";
}

async function startForegroundTracking(): Promise<void> {
  foregroundSubscription?.remove();
  foregroundSubscription = await Location.watchPositionAsync(
    locationOptions,
    async (location) => {
      await appendLocationBatch([location]);
    },
  );
  activeMode = "foreground";
}

export const gnssTrackingProvider: TrackingProvider = {
  id: "gnss",
  coordinateKind: "geographic",
  async start(mode) {
    if (mode === "background") {
      await startBackgroundTracking();
      return;
    }
    await startForegroundTracking();
  },
  async stop() {
    foregroundSubscription?.remove();
    foregroundSubscription = null;

    const backgroundStarted = await Location.hasStartedLocationUpdatesAsync(
      BACKGROUND_LOCATION_TASK,
    );
    if (backgroundStarted) {
      await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
    }
    activeMode = null;
  },
  async status(): Promise<TrackingRuntimeStatus> {
    const taskManagerAvailable = await TaskManager.isAvailableAsync();
    const backgroundStarted = await Location.hasStartedLocationUpdatesAsync(
      BACKGROUND_LOCATION_TASK,
    );
    if (backgroundStarted) {
      return {
        mode: "background",
        running: true,
        taskManagerAvailable,
      };
    }
    if (foregroundSubscription !== null) {
      return {
        mode: "foreground",
        running: true,
        taskManagerAvailable,
      };
    }
    return {
      mode: activeMode,
      running: false,
      taskManagerAvailable,
    };
  },
};
