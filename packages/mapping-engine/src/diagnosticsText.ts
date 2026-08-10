import type {
  ExplorationTrackingDiagnostics,
  NumericDistributionSummary,
  TrackingEnvironmentSnapshot,
} from "./diagnostics.ts";

function scalar(value: number | null): string {
  return value === null ? "null" : String(value);
}

function text(value: string | null): string {
  return value === null ? "null" : oneLine(value);
}

function booleanScalar(value: boolean | null): string {
  return value === null ? "null" : String(value);
}

function isoUtc(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "null";
  }
  return new Date(value).toISOString();
}

function distribution(
  prefix: string,
  summary: NumericDistributionSummary,
): readonly string[] {
  return [
    `${prefix}_count=${summary.count}`,
    `${prefix}_min=${scalar(summary.minimum)}`,
    `${prefix}_median=${scalar(summary.median)}`,
    `${prefix}_p95=${scalar(summary.p95)}`,
    `${prefix}_max=${scalar(summary.maximum)}`,
  ];
}

function oneLine(value: string): string {
  return value.replace(/[\r\n]+/gu, " ").trim().slice(0, 500);
}

function environmentLines(
  prefix: "start" | "end",
  snapshot: TrackingEnvironmentSnapshot | null,
): readonly string[] {
  return [
    `${prefix}_snapshot_at_ms=${scalar(snapshot?.capturedAtMs ?? null)}`,
    `${prefix}_snapshot_at_iso_utc=${isoUtc(snapshot?.capturedAtMs ?? null)}`,
    `${prefix}_elapsed_realtime_ms=${scalar(snapshot?.elapsedRealtimeMs ?? null)}`,
    `${prefix}_battery_percent=${scalar(snapshot?.batteryLevelPercent ?? null)}`,
    `${prefix}_battery_status=${text(snapshot?.batteryStatus ?? null)}`,
    `${prefix}_battery_plugged=${text(snapshot?.batteryPlugged ?? null)}`,
    `${prefix}_battery_temperature_c=${scalar(
      snapshot?.batteryTemperatureCelsius ?? null,
    )}`,
    `${prefix}_battery_voltage_mv=${scalar(
      snapshot?.batteryVoltageMillivolts ?? null,
    )}`,
    `${prefix}_battery_current_ua=${scalar(
      snapshot?.batteryCurrentMicroamps ?? null,
    )}`,
    `${prefix}_battery_charge_counter_uah=${scalar(
      snapshot?.batteryChargeCounterMicroampHours ?? null,
    )}`,
    `${prefix}_power_save_mode=${booleanScalar(snapshot?.powerSaveMode ?? null)}`,
    `${prefix}_battery_optimization_enabled=${booleanScalar(
      snapshot?.batteryOptimizationEnabled ?? null,
    )}`,
    `${prefix}_thermal_status=${scalar(snapshot?.thermalStatus ?? null)}`,
    `${prefix}_fine_location_granted=${booleanScalar(
      snapshot?.fineLocationGranted ?? null,
    )}`,
    `${prefix}_coarse_location_granted=${booleanScalar(
      snapshot?.coarseLocationGranted ?? null,
    )}`,
    `${prefix}_background_location_granted=${booleanScalar(
      snapshot?.backgroundLocationGranted ?? null,
    )}`,
    `${prefix}_notification_granted=${booleanScalar(
      snapshot?.notificationGranted ?? null,
    )}`,
  ];
}

export function formatTrackingDiagnosticsSummary(
  report: ExplorationTrackingDiagnostics,
): string {
  const device = report.environment.start ?? report.environment.end;
  const lines = [
    "personal_exploration_map_diagnostics_format=3",
    `report_version=${report.version}`,
    `provider=${oneLine(report.providerId)}`,
    `session_started_at_ms=${report.startedAtMs}`,
    `session_started_at_iso_utc=${isoUtc(report.startedAtMs)}`,
    `session_ended_at_ms=${scalar(report.endedAtMs)}`,
    `session_ended_at_iso_utc=${isoUtc(report.endedAtMs)}`,
    `duration_ms=${report.durationMs}`,
    `snapshot_elapsed_duration_ms=${scalar(
      report.environment.snapshotElapsedDurationMs,
    )}`,
    `device_manufacturer=${text(device?.manufacturer ?? null)}`,
    `device_brand=${text(device?.brand ?? null)}`,
    `device_model=${text(device?.model ?? null)}`,
    `device_codename=${text(device?.device ?? null)}`,
    `device_product=${text(device?.product ?? null)}`,
    `android_version=${text(device?.androidVersion ?? null)}`,
    `android_sdk=${scalar(device?.sdkInt ?? null)}`,
    `android_build_id=${text(device?.buildId ?? null)}`,
    `build_fingerprint_sha256=${text(device?.buildFingerprintHash ?? null)}`,
    `app_package=${text(device?.packageName ?? null)}`,
    `app_version_name=${text(device?.appVersionName ?? null)}`,
    `app_version_code=${scalar(device?.appVersionCode ?? null)}`,
    `app_debuggable=${booleanScalar(device?.isDebuggable ?? null)}`,
    `timezone=${text(device?.timezoneId ?? null)}`,
    `timezone_offset_minutes=${scalar(device?.timezoneOffsetMinutes ?? null)}`,
    `locale=${text(device?.localeTag ?? null)}`,
    ...environmentLines("start", report.environment.start),
    ...environmentLines("end", report.environment.end),
    `battery_consumed_percentage_points=${scalar(
      report.environment.batteryConsumedPercentagePoints,
    )}`,
    `raw_samples=${report.rawSampleCount}`,
    `accepted_samples=${report.acceptedSampleCount}`,
    `rejected_samples=${report.rejectedSampleCount}`,
    `acceptance_rate=${scalar(report.acceptanceRate)}`,
    `rejection_reasons=${
      report.rejectionReasons.length === 0
        ? "none"
        : report.rejectionReasons
            .map((item) => `${item.reason}:${item.count}`)
            .join(",")
    }`,
    ...distribution("accuracy_m", report.horizontalAccuracyMeters),
    ...distribution("sample_gap_ms", report.sampleGapsMs),
    `sample_gap_at_least_30s=${report.sampleGapsMs.atLeast30Seconds}`,
    `sample_gap_at_least_60s=${report.sampleGapsMs.atLeast60Seconds}`,
    `sample_gap_at_least_120s=${report.sampleGapsMs.atLeast120Seconds}`,
    `sample_before_start_count=${report.sampleWindow.beforeStartCount}`,
    `sample_before_start_max_ms=${scalar(
      report.sampleWindow.beforeStartMaximumMs,
    )}`,
    `sample_after_end_count=${report.sampleWindow.afterEndCount}`,
    `sample_after_end_max_ms=${scalar(
      report.sampleWindow.afterEndMaximumMs,
    )}`,
    `callback_received_batches=${report.callbacks.receivedBatchCount}`,
    `callback_received_samples=${report.callbacks.receivedSampleCount}`,
    `callback_persisted_batches=${report.callbacks.persistedBatchCount}`,
    `callback_persisted_samples=${report.callbacks.persistedSampleCount}`,
    `callback_duplicate_samples=${report.callbacks.duplicateSampleCount}`,
    `callback_accepted_samples=${report.callbacks.acceptedSampleCount}`,
    `callback_rejected_samples=${report.callbacks.rejectedSampleCount}`,
    `callback_failed_batches=${report.callbacks.failedBatchCount}`,
    `callback_largest_batch=${report.callbacks.largestBatchSize}`,
    ...distribution("callback_gap_ms", report.callbacks.deliveryGapsMs),
    `callback_gap_at_least_30s=${
      report.callbacks.deliveryGapsMs.atLeast30Seconds
    }`,
    `callback_gap_at_least_60s=${
      report.callbacks.deliveryGapsMs.atLeast60Seconds
    }`,
    `callback_gap_at_least_120s=${
      report.callbacks.deliveryGapsMs.atLeast120Seconds
    }`,
    ...distribution(
      "callback_oldest_observation_age_ms",
      report.callbacks.oldestObservationAgeMs,
    ),
    ...distribution(
      "callback_newest_observation_age_ms",
      report.callbacks.newestObservationAgeMs,
    ),
    `callback_future_observation_batches=${
      report.callbacks.futureObservationBatchCount
    }`,
    `callback_missing_observation_timestamp_batches=${
      report.callbacks.missingObservationTimestampBatchCount
    }`,
    ...distribution("marker_input_ms", report.markerInputMs),
    `marker_input_completed=${report.markerInputMs.completedCount}`,
    `marker_input_cancelled=${report.markerInputMs.cancelledCount}`,
    `last_error_kind=${report.lastError?.kind ?? "none"}`,
    `last_error_message=${
      report.lastError === null ? "none" : oneLine(report.lastError.message)
    }`,
    `lifecycle_count=${report.lifecycle.length}`,
  ];

  report.lifecycle.forEach((transition, index) => {
    const offsetMs = Math.max(0, transition.occurredAtMs - report.startedAtMs);
    const position = index + 1;
    lines.push(`lifecycle_${position}_offset_ms=${offsetMs}`);
    lines.push(`lifecycle_${position}_kind=${transition.kind}`);
    lines.push(
      `lifecycle_${position}_detail=${
        transition.detail === null ? "none" : oneLine(transition.detail)
      }`,
    );
  });

  return lines.join("\n");
}
