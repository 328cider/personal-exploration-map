import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";

import { recordActiveTrackingDiagnosticBestEffort } from "../diagnostics/trackingDiagnostics";
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
      await recordActiveTrackingDiagnosticBestEffort({
        kind: "callback.failed",
        payload: {
          delivery: "background",
          sampleCount: 0,
          message: error.message,
          source: "task-manager",
        },
      });
      return;
    }

    const taskData = data as BackgroundLocationTaskData | undefined;
    try {
      await ingestActiveLocationBatch(
        taskData?.locations ?? [],
        "background",
      );
    } catch (taskError) {
      const message =
        taskError instanceof Error ? taskError.message : String(taskError);
      await recordBackgroundTaskError(message);
      // ingestActiveLocationBatch already records the failed batch when an
      // active exploration exists. The app_state fallback remains useful if
      // diagnostic persistence itself was unavailable.
    }
  });
}
