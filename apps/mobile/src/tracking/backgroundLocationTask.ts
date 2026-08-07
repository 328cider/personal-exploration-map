import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";

import { ingestActiveLocationBatch } from "../mapping/mobileMappingRuntime";
import { recordBackgroundTaskError } from "../storage/activeTrackingState";
import { BACKGROUND_LOCATION_TASK } from "./taskNames";

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
      await ingestActiveLocationBatch(taskData?.locations ?? []);
    } catch (taskError) {
      const message =
        taskError instanceof Error ? taskError.message : String(taskError);
      await recordBackgroundTaskError(message);
    }
  });
}
