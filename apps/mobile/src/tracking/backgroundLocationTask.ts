import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";

import {
  appendLocationBatch,
  recordBackgroundTaskError,
} from "../storage/explorationRepository";

export const BACKGROUND_LOCATION_TASK =
  "personal-exploration-map-background-location";

interface BackgroundLocationTaskData {
  readonly locations?: readonly Location.LocationObject[];
}

if (!TaskManager.isTaskDefined(BACKGROUND_LOCATION_TASK)) {
  TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async ({ data, error }) => {
    if (error !== null) {
      await recordBackgroundTaskError(error.message);
      return;
    }

    const taskData = data as BackgroundLocationTaskData | undefined;
    try {
      await appendLocationBatch(taskData?.locations ?? []);
    } catch (taskError) {
      const message =
        taskError instanceof Error ? taskError.message : String(taskError);
      await recordBackgroundTaskError(message);
    }
  });
}
