import type {
  ExplorationTrackingDiagnostics,
  NumericDistributionSummary,
} from "./diagnostics.ts";

function scalar(value: number | null): string {
  return value === null ? "null" : String(value);
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

export function formatTrackingDiagnosticsSummary(
  report: ExplorationTrackingDiagnostics,
): string {
  const lines = [
    "personal_exploration_map_diagnostics_format=1",
    `report_version=${report.version}`,
    `provider=${oneLine(report.providerId)}`,
    `duration_ms=${report.durationMs}`,
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
    `callback_received_batches=${report.callbacks.receivedBatchCount}`,
    `callback_received_samples=${report.callbacks.receivedSampleCount}`,
    `callback_persisted_batches=${report.callbacks.persistedBatchCount}`,
    `callback_persisted_samples=${report.callbacks.persistedSampleCount}`,
    `callback_duplicate_samples=${report.callbacks.duplicateSampleCount}`,
    `callback_accepted_samples=${report.callbacks.acceptedSampleCount}`,
    `callback_rejected_samples=${report.callbacks.rejectedSampleCount}`,
    `callback_failed_batches=${report.callbacks.failedBatchCount}`,
    `callback_largest_batch=${report.callbacks.largestBatchSize}`,
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
