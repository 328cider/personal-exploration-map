#!/usr/bin/env node

import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  analyzeFieldTestBundle,
  parseCoordinateFreeSummary,
} from "./analyze-field-test-summary.mjs";

const REPORT_SCHEMA_VERSION = 3;
const MARKER_STALE_WARNING_MS = 30_000;
const SEVERITY_RANK = { INFO: 0, WARN: 1, INCONCLUSIVE: 2, FAIL: 3 };

const ADDITIONAL_SAFE_FIELDS = [
  "callback_largest_batch",
  "callback_oldest_observation_age_ms_count",
  "callback_oldest_observation_age_ms_min",
  "callback_oldest_observation_age_ms_median",
  "callback_oldest_observation_age_ms_p95",
  "callback_oldest_observation_age_ms_max",
  "callback_newest_observation_age_ms_count",
  "callback_newest_observation_age_ms_min",
  "callback_newest_observation_age_ms_median",
  "callback_newest_observation_age_ms_p95",
  "callback_newest_observation_age_ms_max",
  "callback_future_observation_batches",
  "callback_missing_observation_timestamp_batches",
  "marker_latest_observation_age_ms_count",
  "marker_latest_observation_age_ms_min",
  "marker_latest_observation_age_ms_median",
  "marker_latest_observation_age_ms_p95",
  "marker_latest_observation_age_ms_max",
  "marker_latest_observation_missing_count",
  "marker_latest_observation_future_count",
];

function numberValue(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringValue(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function finding(severity, code, message, category = "objective") {
  return { severity, code, message, category };
}

function statusFor(findings) {
  const rank = findings.reduce(
    (current, item) => Math.max(current, SEVERITY_RANK[item.severity] ?? 0),
    0,
  );
  if (rank >= SEVERITY_RANK.FAIL) return "FAIL";
  if (rank >= SEVERITY_RANK.INCONCLUSIVE) return "INCONCLUSIVE";
  if (rank >= SEVERITY_RANK.WARN) return "WARN";
  return "PASS";
}

function nextAction(status) {
  if (status === "FAIL") {
    return "同じ条件を再度歩かず、USB bundleを保持したままコード・エミュレータ側へ戻す。";
  }
  if (status === "INCONCLUSIVE") {
    return "製品FAILとは判定しない。bundleを保持し、指摘されたS0手順を1つの探索で満たして再実施する。";
  }
  if (status === "WARN") {
    return "raw evidenceの完全性とlive freshnessを分けて確認し、主観レビューと警告理由から次の試験条件を判断する。";
  }
  return "主観レビューを記録し、問題がなければ次の実地条件へ進む。";
}

function markdownCell(value) {
  return String(value ?? "—").replaceAll("|", "\\|").replaceAll("\n", " ");
}

function formatMinutes(values) {
  const duration = numberValue(values.duration_ms);
  return duration === null ? "—" : (duration / 60_000).toFixed(1);
}

function copyAdditionalEvidence(source, target) {
  for (const field of ADDITIONAL_SAFE_FIELDS) {
    if (Object.hasOwn(source, field)) {
      target[field] = source[field];
    }
  }
}

function callbackGapFindingIndex(findings) {
  return findings.findIndex((item) => item.code === "callback_gap_120s");
}

function hasFinding(findings, code) {
  return findings.some((item) => item.code === code);
}

export function normalizeBatteryOptimizationFinding(findings, values) {
  const result = findings.filter(
    (item) => item.code !== "battery_optimization_enabled",
  );
  if (values.start_battery_optimization_enabled === true) {
    result.push(
      finding(
        "INFO",
        "battery_optimization_observed",
        "Battery optimization was enabled at start. This is the standard product condition and is recorded for comparison, not treated as a defect by itself.",
        "environment",
      ),
    );
  }
  return result;
}

function bufferedDeliveryEvidence(values) {
  const gapCount = numberValue(values.callback_gap_at_least_120s) ?? 0;
  const callbackGapMaximumMs = numberValue(values.callback_gap_ms_max);
  const oldestObservationAgeMaximumMs = numberValue(
    values.callback_oldest_observation_age_ms_max,
  );
  const received = numberValue(values.callback_received_samples);
  const persisted = numberValue(values.callback_persisted_samples);
  const duplicates = numberValue(values.callback_duplicate_samples) ?? 0;
  const failedBatches = numberValue(values.callback_failed_batches) ?? 0;
  const observationOutages = numberValue(values.sample_gap_at_least_30s) ?? 0;
  const largestBatch = numberValue(values.callback_largest_batch) ?? 0;
  const futureBatches =
    numberValue(values.callback_future_observation_batches) ?? 0;
  const missingTimestampBatches =
    numberValue(values.callback_missing_observation_timestamp_batches) ?? 0;
  const lastError = stringValue(values.last_error_kind);

  if (
    gapCount <= 0 ||
    callbackGapMaximumMs === null ||
    oldestObservationAgeMaximumMs === null ||
    received === null ||
    persisted === null
  ) {
    return null;
  }

  const ageDifferenceMs = Math.abs(
    callbackGapMaximumMs - oldestObservationAgeMaximumMs,
  );
  const maximumAlignmentErrorMs = Math.max(
    30_000,
    callbackGapMaximumMs * 0.25,
  );
  const fullyAccounted = persisted + duplicates === received;
  const noOperationalError = lastError === null || lastError === "none";

  if (
    !fullyAccounted ||
    failedBatches !== 0 ||
    observationOutages !== 0 ||
    largestBatch <= 1 ||
    ageDifferenceMs > maximumAlignmentErrorMs ||
    futureBatches !== 0 ||
    missingTimestampBatches !== 0 ||
    !noOperationalError
  ) {
    return null;
  }

  return {
    gapCount,
    callbackGapMaximumMs,
    oldestObservationAgeMaximumMs,
    largestBatch,
    received,
    persisted,
    duplicates,
  };
}

function addTimingFindings(findings, values) {
  const result = [...findings];
  const futureCallbackBatches =
    numberValue(values.callback_future_observation_batches) ?? 0;
  const markerFutureCount =
    numberValue(values.marker_latest_observation_future_count) ?? 0;
  const markerMissingCount =
    numberValue(values.marker_latest_observation_missing_count) ?? 0;
  const markerAgeMaximumMs = numberValue(
    values.marker_latest_observation_age_ms_max,
  );

  if (
    futureCallbackBatches > 0 &&
    !hasFinding(result, "future_observation_timestamp")
  ) {
    result.push(
      finding(
        "FAIL",
        "future_observation_timestamp",
        `${futureCallbackBatches} callback batch(es) contained an observation timestamp after the callback receive time. Raw evidence is preserved, but this run cannot qualify until the clock/provenance mismatch is understood.`,
        "data-quality",
      ),
    );
  }

  if (
    markerFutureCount > 0 &&
    !hasFinding(result, "marker_observation_from_future")
  ) {
    result.push(
      finding(
        "FAIL",
        "marker_observation_from_future",
        `${markerFutureCount} completed marker input(s) resolved against an accepted observation timestamp later than the marker diagnostic time.`,
        "data-quality",
      ),
    );
  }

  if (
    markerMissingCount > 0 &&
    !hasFinding(result, "marker_observation_missing")
  ) {
    result.push(
      finding(
        "WARN",
        "marker_observation_missing",
        `${markerMissingCount} completed marker input(s) had no accepted observation available for attachment-freshness measurement.`,
        "data-quality",
      ),
    );
  }

  if (
    markerAgeMaximumMs !== null &&
    markerAgeMaximumMs >= MARKER_STALE_WARNING_MS &&
    !hasFinding(result, "marker_attachment_stale")
  ) {
    result.push(
      finding(
        "WARN",
        "marker_attachment_stale",
        `At least one completed marker input may have attached to a stale accepted observation; maximum measured age was ${markerAgeMaximumMs} ms.`,
        "data-quality",
      ),
    );
  }

  return result;
}

function reclassifyExploration(evaluation, rawValues, mode) {
  const values = { ...evaluation.values };
  copyAdditionalEvidence(rawValues, values);
  let findings = normalizeBatteryOptimizationFinding(
    addTimingFindings(evaluation.findings, rawValues),
    rawValues,
  );

  if (mode === "generic") {
    const gapIndex = callbackGapFindingIndex(findings);
    const evidence = bufferedDeliveryEvidence(rawValues);
    if (gapIndex >= 0 && evidence !== null) {
      findings = findings.filter((_, index) => index !== gapIndex);
      findings.push(
        finding(
          "WARN",
          "callback_delivery_batched",
          `${evidence.gapCount} callback delivery gap(s) exceeded 120 seconds, but all ${evidence.received} received sample(s) were accounted for and the largest catch-up batch contained ${evidence.largestBatch} sample(s). This supports delayed buffered delivery rather than raw observation loss.`,
          "runtime",
        ),
        finding(
          "WARN",
          "live_freshness_degraded",
          `Live map and marker placement may have been stale: maximum callback gap was ${evidence.callbackGapMaximumMs} ms and maximum oldest-observation age was ${evidence.oldestObservationAgeMaximumMs} ms.`,
          "runtime",
        ),
      );
    }
  }

  return {
    ...evaluation,
    values,
    findings,
    objectiveStatus: statusFor(findings),
  };
}

function renderMarkdown(report) {
  const evaluated = report.evaluatedExploration?.values ?? {};
  const findings = report.findings.length
    ? report.findings
    : [
        finding(
          "INFO",
          "all_objective_checks_passed",
          "All objective checks passed.",
        ),
      ];

  return [
    "# Field-test objective report",
    "",
    `- Objective status: **${report.status}**`,
    `- Bundle: \`${markdownCell(report.bundleName)}\``,
    `- Mode: \`${report.mode}\``,
    `- Evaluated exploration: ${markdownCell(report.evaluatedExplorationIndex)}`,
    `- Selection: ${markdownCell(report.selectionReason)}`,
    "- Subjective review required: **yes**",
    `- Next action: ${report.nextAction}`,
    "",
    "> This report does not automate the product Go / Narrow / Stop decision. Map recognizability, pocket UX, safety, and differentiation remain human judgments.",
    "",
    "## Evaluated exploration",
    "",
    "| Item | Value |",
    "|---|---|",
    `| Device | ${markdownCell(evaluated.device_manufacturer)} ${markdownCell(evaluated.device_model)} / Android ${markdownCell(evaluated.android_version)} |`,
    `| Duration | ${formatMinutes(evaluated)} min |`,
    `| Samples | raw ${markdownCell(evaluated.raw_samples)} / accepted ${markdownCell(evaluated.accepted_samples)} / rejected ${markdownCell(evaluated.rejected_samples)} |`,
    `| Persistence | received ${markdownCell(evaluated.callback_received_samples)} / persisted ${markdownCell(evaluated.callback_persisted_samples)} / duplicate ${markdownCell(evaluated.callback_duplicate_samples)} / failed batches ${markdownCell(evaluated.callback_failed_batches)} |`,
    `| Observation gap | p95 ${markdownCell(evaluated.sample_gap_ms_p95)} ms / max ${markdownCell(evaluated.sample_gap_ms_max)} ms / >=30s ${markdownCell(evaluated.sample_gap_at_least_30s)} |`,
    `| Callback gap | p95 ${markdownCell(evaluated.callback_gap_ms_p95)} ms / max ${markdownCell(evaluated.callback_gap_ms_max)} ms / >=120s ${markdownCell(evaluated.callback_gap_at_least_120s)} |`,
    `| Catch-up evidence | largest batch ${markdownCell(evaluated.callback_largest_batch)} / oldest age max ${markdownCell(evaluated.callback_oldest_observation_age_ms_max)} ms / newest age max ${markdownCell(evaluated.callback_newest_observation_age_ms_max)} ms |`,
    `| Marker | completed ${markdownCell(evaluated.marker_input_completed)} / cancelled ${markdownCell(evaluated.marker_input_cancelled)} |`,
    `| Marker attachment freshness | age p95 ${markdownCell(evaluated.marker_latest_observation_age_ms_p95)} ms / max ${markdownCell(evaluated.marker_latest_observation_age_ms_max)} ms / missing ${markdownCell(evaluated.marker_latest_observation_missing_count)} / future ${markdownCell(evaluated.marker_latest_observation_future_count)} |`,
    `| Battery | ${markdownCell(evaluated.start_battery_percent)}% → ${markdownCell(evaluated.end_battery_percent)}% / consumed ${markdownCell(evaluated.battery_consumed_percentage_points)} pt |`,
    `| Last error | ${markdownCell(evaluated.last_error_kind)} / ${markdownCell(evaluated.last_error_message)} |`,
    "",
    "## Findings",
    "",
    "| Severity | Category | Code | Detail |",
    "|---|---|---|---|",
    ...findings.map(
      (item) =>
        `| ${item.severity} | ${markdownCell(item.category)} | \`${markdownCell(item.code)}\` | ${markdownCell(item.message)} |`,
    ),
    "",
    "## All explorations in the coordinate-free summary",
    "",
    "| # | Status | Start | Duration min | Raw | Persisted | p95 observation gap ms | Marker |",
    "|---:|---|---|---:|---:|---:|---:|---:|",
    ...report.explorations.map(({ index, values, objectiveStatus }) =>
      `| ${index} | ${objectiveStatus} | ${markdownCell(values.session_started_at_iso_utc)} | ${formatMinutes(values)} | ${markdownCell(values.raw_samples)} | ${markdownCell(values.callback_persisted_samples)} | ${markdownCell(values.sample_gap_ms_p95)} | ${markdownCell(values.marker_input_completed)} |`,
    ),
    "",
    "## Interpretation boundary",
    "",
    "- Observation continuity and eventual persistence describe post-hoc raw-evidence completeness.",
    "- Callback delivery gaps describe live freshness and may delay the map or marker attachment without losing stored observations.",
    "- Marker attachment freshness measures marker-save time against the latest accepted observation available to the derived route.",
    "- Battery optimization ON is the standard product condition and is reported as environment context, not a defect by itself.",
    "- Generic mode may classify confirmed catch-up delivery as WARN; S0 keeps its stricter live-freshness gate.",
    "",
    "## Privacy boundary",
    "",
    "- This analyzer reads the coordinate-free summary, manifest, and checksums.",
    "- It does not parse raw SQLite/tar location history.",
    "- Exact coordinates, IDs, names, marker text, and map images are not written to this report.",
    "",
  ].join("\n");
}

function parseArguments(argv) {
  let inputPath = "artifacts/device-bundles";
  let outputDirectory = null;
  let mode = "s0";
  let failExit = true;
  let explorationIndex = null;
  let positionalSeen = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--output-dir") {
      outputDirectory = argv[++index];
    } else if (argument === "--mode") {
      mode = argv[++index];
    } else if (argument === "--exploration-index") {
      explorationIndex = Number(argv[++index]);
      if (!Number.isInteger(explorationIndex) || explorationIndex < 1) {
        throw new Error("--exploration-index must be a positive integer.");
      }
    } else if (argument === "--no-fail-exit") {
      failExit = false;
    } else if (argument.startsWith("--")) {
      throw new Error(`Unknown option: ${argument}`);
    } else if (!positionalSeen) {
      inputPath = argument;
      positionalSeen = true;
    } else {
      throw new Error(`Unexpected argument: ${argument}`);
    }
  }

  if (!outputDirectory && argv.includes("--output-dir")) {
    throw new Error("--output-dir requires a path.");
  }
  if (!mode && argv.includes("--mode")) {
    throw new Error("--mode requires a value.");
  }
  if (!["s0", "generic"].includes(mode)) {
    throw new Error("--mode must be s0 or generic.");
  }

  return { inputPath, outputDirectory, mode, failExit, explorationIndex };
}

export async function analyzeFieldTestEvidence(
  inputPath = "artifacts/device-bundles",
  {
    outputDirectory = null,
    mode = "s0",
    generatedAt = new Date().toISOString(),
    explorationIndex = null,
  } = {},
) {
  const base = await analyzeFieldTestBundle(inputPath, {
    outputDirectory,
    mode,
    generatedAt,
    explorationIndex,
  });
  const summaryPath = path.join(
    base.bundleDirectory,
    "coordinate-free-diagnostics.txt",
  );
  const parsed = parseCoordinateFreeSummary(
    await fs.readFile(summaryPath, "utf8"),
  );
  const rawByIndex = new Map(
    parsed.explorations.map((item) => [item.index, item.values]),
  );
  const explorations = base.report.explorations.map((evaluation) =>
    reclassifyExploration(
      evaluation,
      rawByIndex.get(evaluation.index) ?? {},
      mode,
    ),
  );
  const selected =
    base.report.evaluatedExplorationIndex === null
      ? null
      : explorations.find(
          (item) => item.index === base.report.evaluatedExplorationIndex,
        ) ?? null;
  const globalFindings = base.report.findings.filter((item) => {
    if (base.report.evaluatedExploration === null) {
      return true;
    }
    return !base.report.evaluatedExploration.findings.includes(item);
  });
  const findings = [...globalFindings, ...(selected?.findings ?? [])];
  const status = statusFor(findings);
  const latestExploration = explorations.at(-1) ?? null;
  const report = {
    ...base.report,
    schemaVersion: REPORT_SCHEMA_VERSION,
    status,
    explorations,
    latestExploration,
    evaluatedExploration: selected,
    findings,
    nextAction: nextAction(status),
  };

  await Promise.all([
    fs.writeFile(base.jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8"),
    fs.writeFile(base.markdownPath, renderMarkdown(report), "utf8"),
  ]);

  return { ...base, report };
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  const result = await analyzeFieldTestEvidence(options.inputPath, options);
  console.log(`Objective status: ${result.report.status}`);
  console.log(
    `Evaluated exploration: ${result.report.evaluatedExplorationIndex ?? "none"}`,
  );
  console.log(`Selection: ${result.report.selectionReason}`);
  console.log(`Markdown: ${result.markdownPath}`);
  console.log(`JSON: ${result.jsonPath}`);
  console.log(`Next action: ${result.report.nextAction}`);
  if (options.failExit && result.report.status === "FAIL") process.exitCode = 2;
  if (options.failExit && result.report.status === "INCONCLUSIVE") {
    process.exitCode = 3;
  }
  return result;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
