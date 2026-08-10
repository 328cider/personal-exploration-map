#!/usr/bin/env node

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const EXPECTED_PACKAGE = "com.cider328.personalexplorationmap.fieldtest";
const DEFAULT_INPUT = "artifacts/device-bundles";
const REPORT_SCHEMA_VERSION = 2;
const SEVERITY_RANK = { INFO: 0, WARN: 1, INCONCLUSIVE: 2, FAIL: 3 };

const PROHIBITED_KEY_PATTERNS = [
  /(^|_)(latitude|longitude|coordinate)(_|$)/i,
  /(^|_)(local_x|local_y|x_meters|y_meters)(_|$)/i,
  /(^|_)(personal_map_id|exploration_id|map_name|marker_text)(_|$)/i,
];

const SAFE_REPORT_FIELDS = [
  "provider",
  "session_started_at_iso_utc",
  "session_ended_at_iso_utc",
  "duration_ms",
  "snapshot_elapsed_duration_ms",
  "device_manufacturer",
  "device_model",
  "android_version",
  "android_sdk",
  "app_package",
  "app_version_name",
  "app_version_code",
  "app_debuggable",
  "timezone",
  "locale",
  "start_battery_percent",
  "end_battery_percent",
  "battery_consumed_percentage_points",
  "start_battery_status",
  "end_battery_status",
  "start_battery_plugged",
  "end_battery_plugged",
  "start_battery_temperature_c",
  "end_battery_temperature_c",
  "start_battery_voltage_mv",
  "end_battery_voltage_mv",
  "start_battery_current_ua",
  "end_battery_current_ua",
  "start_power_save_mode",
  "end_power_save_mode",
  "start_battery_optimization_enabled",
  "end_battery_optimization_enabled",
  "start_thermal_status",
  "end_thermal_status",
  "start_fine_location_granted",
  "end_fine_location_granted",
  "start_background_location_granted",
  "end_background_location_granted",
  "start_notification_granted",
  "end_notification_granted",
  "raw_samples",
  "accepted_samples",
  "rejected_samples",
  "acceptance_rate",
  "rejection_reasons",
  "accuracy_m_count",
  "accuracy_m_min",
  "accuracy_m_median",
  "accuracy_m_p95",
  "accuracy_m_max",
  "sample_gap_ms_count",
  "sample_gap_ms_min",
  "sample_gap_ms_median",
  "sample_gap_ms_p95",
  "sample_gap_ms_max",
  "sample_gap_at_least_30s",
  "sample_gap_at_least_60s",
  "sample_gap_at_least_120s",
  "sample_before_start_count",
  "sample_before_start_max_ms",
  "sample_after_end_count",
  "sample_after_end_max_ms",
  "callback_gap_ms_count",
  "callback_gap_ms_min",
  "callback_gap_ms_median",
  "callback_gap_ms_p95",
  "callback_gap_ms_max",
  "callback_gap_at_least_30s",
  "callback_gap_at_least_60s",
  "callback_gap_at_least_120s",
  "callback_received_batches",
  "callback_received_samples",
  "callback_persisted_batches",
  "callback_persisted_samples",
  "callback_duplicate_samples",
  "callback_failed_batches",
  "marker_input_ms_count",
  "marker_input_ms_median",
  "marker_input_ms_p95",
  "marker_input_ms_max",
  "marker_input_completed",
  "marker_input_cancelled",
  "last_error_kind",
  "last_error_message",
];

function parseScalar(value) {
  const trimmed = value.trim();
  if (trimmed === "null") return null;
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (/^-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(trimmed)) {
    return Number(trimmed);
  }
  return trimmed;
}

export function parseCoordinateFreeSummary(text) {
  const metadata = {};
  const explorations = [];
  const duplicateKeys = [];
  let title = "";
  let current = null;

  for (const rawLine of text.replaceAll("\r\n", "\n").split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;

    const section = /^\[exploration_(\d+)\]$/.exec(line);
    if (section) {
      current = { index: Number(section[1]), values: {} };
      explorations.push(current);
      continue;
    }

    const separator = line.indexOf("=");
    if (separator < 1) {
      if (!title) title = line;
      continue;
    }

    const key = line.slice(0, separator).trim();
    const target = current?.values ?? metadata;
    if (Object.hasOwn(target, key)) {
      duplicateKeys.push({ section: current?.index ?? 0, key });
    }
    target[key] = parseScalar(line.slice(separator + 1));
  }

  return { title, metadata, explorations, duplicateKeys };
}

function finding(severity, code, message, category = "objective") {
  return { severity, code, message, category };
}

function numberValue(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function booleanValue(value) {
  return typeof value === "boolean" ? value : null;
}

function stringValue(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function durationMinutes(values) {
  const duration = numberValue(values.duration_ms);
  return duration === null ? null : duration / 60_000;
}

function lifecycleFrom(values) {
  const count = Math.max(0, Math.trunc(numberValue(values.lifecycle_count) ?? 0));
  return Array.from({ length: count }, (_, offset) => {
    const index = offset + 1;
    return {
      kind: stringValue(values[`lifecycle_${index}_kind`]) ?? "",
      detail: stringValue(values[`lifecycle_${index}_detail`]) ?? "",
      offsetMs: numberValue(values[`lifecycle_${index}_offset_ms`]),
    };
  });
}

function sanitizeValues(values) {
  const safeValues = {};
  for (const field of SAFE_REPORT_FIELDS) {
    if (Object.hasOwn(values, field)) safeValues[field] = values[field];
  }
  safeValues.lifecycle_count = lifecycleFrom(values).length;
  return safeValues;
}

function evaluatePrivacy(parsed) {
  const findings = [];
  const sections = [
    { name: "metadata", values: parsed.metadata },
    ...parsed.explorations.map((item) => ({
      name: `exploration_${item.index}`,
      values: item.values,
    })),
  ];

  for (const section of sections) {
    for (const key of Object.keys(section.values)) {
      if (PROHIBITED_KEY_PATTERNS.some((pattern) => pattern.test(key))) {
        findings.push(
          finding(
            "FAIL",
            "coordinate_key_present",
            `${section.name} contains prohibited key '${key}'.`,
            "privacy",
          ),
        );
      }
    }
  }

  if (
    parsed.metadata.privacy !==
    "no_coordinates_no_map_names_no_ids_no_marker_text_no_map_images"
  ) {
    findings.push(
      finding(
        "WARN",
        "privacy_header_unexpected",
        "The coordinate-free privacy declaration is missing or changed.",
        "privacy",
      ),
    );
  }
  return findings;
}

function requireFields(values, fields, findings) {
  for (const field of fields) {
    if (!Object.hasOwn(values, field) || values[field] === null || values[field] === "") {
      findings.push(
        finding(
          "FAIL",
          "required_field_missing",
          `Required field '${field}' is missing.`,
          "integrity",
        ),
      );
    }
  }
}

function gapFinding(values) {
  const durationMs = numberValue(values.duration_ms);
  const sampleGapMax = numberValue(values.sample_gap_ms_max);
  const beforeStartCount = numberValue(values.sample_before_start_count) ?? 0;
  const afterEndCount = numberValue(values.sample_after_end_count) ?? 0;
  const callbackGapAvailable = Object.hasOwn(values, "callback_gap_ms_count");

  const sampleWindowSuspicious =
    beforeStartCount > 0 ||
    afterEndCount > 0 ||
    (durationMs !== null && sampleGapMax !== null && sampleGapMax > durationMs + 15_000);

  const findings = [];
  if (sampleWindowSuspicious) {
    const details = [];
    if (beforeStartCount > 0) details.push(`${beforeStartCount} sample(s) before session start`);
    if (afterEndCount > 0) details.push(`${afterEndCount} sample(s) after session end`);
    if (details.length === 0 && sampleGapMax !== null && durationMs !== null) {
      details.push(`observation gap ${sampleGapMax} ms exceeds session duration ${durationMs} ms`);
    }
    findings.push(
      finding(
        "WARN",
        "sample_timestamp_outside_session_suspected",
        `Observation timestamps may include cached/stale or out-of-window samples: ${details.join(", ")}. This is not treated as a callback outage.`,
        "data-quality",
      ),
    );
  }

  const prefix = callbackGapAvailable ? "callback_gap" : "sample_gap";
  const gaps120 = numberValue(values[`${prefix}_at_least_120s`]) ?? 0;
  const gaps60 = numberValue(values[`${prefix}_at_least_60s`]) ?? 0;
  const gaps30 = numberValue(values[`${prefix}_at_least_30s`]) ?? 0;

  if (!callbackGapAvailable && sampleWindowSuspicious) return findings;

  const label = callbackGapAvailable ? "callback delivery" : "sample observation";
  if (gaps120 > 0) {
    findings.push(
      finding(
        "FAIL",
        `${prefix}_120s`,
        `${gaps120} ${label} gap(s) were at least 120 seconds.`,
        "runtime",
      ),
    );
  } else if (gaps60 > 0) {
    findings.push(
      finding(
        "WARN",
        `${prefix}_60s`,
        `${gaps60} ${label} gap(s) were at least 60 seconds.`,
        "runtime",
      ),
    );
  } else if (gaps30 > 0) {
    findings.push(
      finding(
        "WARN",
        `${prefix}_30s`,
        `${gaps30} ${label} gap(s) were at least 30 seconds.`,
        "runtime",
      ),
    );
  }
  return findings;
}

export function evaluateExploration(values, { mode = "s0" } = {}) {
  const findings = [];
  requireFields(
    values,
    [
      "provider",
      "session_started_at_iso_utc",
      "session_ended_at_iso_utc",
      "duration_ms",
      "device_model",
      "android_version",
      "app_package",
      "app_version_name",
      "app_debuggable",
      "start_elapsed_realtime_ms",
      "end_elapsed_realtime_ms",
      "raw_samples",
      "accepted_samples",
      "callback_received_samples",
      "callback_persisted_samples",
      "callback_duplicate_samples",
      "callback_failed_batches",
      "last_error_kind",
      "lifecycle_count",
    ],
    findings,
  );

  if (values.app_package !== EXPECTED_PACKAGE) {
    findings.push(
      finding(
        "FAIL",
        "unexpected_package",
        `Expected ${EXPECTED_PACKAGE}; got ${values.app_package}.`,
        "integrity",
      ),
    );
  }
  if (booleanValue(values.app_debuggable) !== true) {
    findings.push(
      finding(
        "FAIL",
        "field_test_not_debuggable",
        "The collected package is not the USB-debuggable Field-test build.",
        "integrity",
      ),
    );
  }
  if (values.provider !== "gnss-background") {
    findings.push(
      finding(
        "WARN",
        "unexpected_provider",
        `Expected gnss-background; got ${values.provider}.`,
        "protocol",
      ),
    );
  }

  for (const key of [
    "start_fine_location_granted",
    "end_fine_location_granted",
    "start_background_location_granted",
    "end_background_location_granted",
    "start_notification_granted",
    "end_notification_granted",
  ]) {
    if (booleanValue(values[key]) !== true) {
      findings.push(
        finding("FAIL", "required_permission_missing", `${key} is not true.`, "runtime"),
      );
    }
  }

  const rawSamples = numberValue(values.raw_samples);
  const acceptedSamples = numberValue(values.accepted_samples);
  if (rawSamples === null || rawSamples <= 0) {
    findings.push(
      finding("FAIL", "no_raw_samples", "No raw location samples were recorded.", "runtime"),
    );
  }
  if (acceptedSamples === null || acceptedSamples <= 0) {
    findings.push(
      finding(
        "FAIL",
        "no_accepted_samples",
        "No samples were accepted into the derived route.",
        "runtime",
      ),
    );
  }

  const received = numberValue(values.callback_received_samples);
  const persisted = numberValue(values.callback_persisted_samples);
  const duplicates = numberValue(values.callback_duplicate_samples) ?? 0;
  if (received !== null && persisted !== null && persisted + duplicates < received) {
    findings.push(
      finding(
        "FAIL",
        "callback_samples_unaccounted",
        `Received ${received}, persisted ${persisted}, duplicate ${duplicates}; some samples are unaccounted for.`,
        "runtime",
      ),
    );
  } else if (received !== null && persisted !== null && persisted + duplicates > received) {
    findings.push(
      finding(
        "WARN",
        "callback_accounting_inconsistent",
        `Persisted plus duplicate samples (${persisted + duplicates}) exceed received samples (${received}).`,
        "runtime",
      ),
    );
  }

  const failedBatches = numberValue(values.callback_failed_batches);
  if (failedBatches !== null && failedBatches > 0) {
    findings.push(
      finding(
        "FAIL",
        "callback_batch_failed",
        `${failedBatches} callback batch(es) failed.`,
        "runtime",
      ),
    );
  }

  const lastError = stringValue(values.last_error_kind);
  if (lastError && lastError !== "none") {
    findings.push(
      finding(
        "FAIL",
        "operational_error",
        `${lastError}: ${stringValue(values.last_error_message) ?? "no message"}`,
        "runtime",
      ),
    );
  }

  findings.push(...gapFinding(values));

  const acceptanceRate = numberValue(values.acceptance_rate);
  if (acceptanceRate !== null && acceptanceRate < 0.5) {
    findings.push(
      finding(
        "WARN",
        "low_acceptance_rate",
        `Acceptance rate is ${(acceptanceRate * 100).toFixed(1)}%.`,
        "map-quality",
      ),
    );
  }

  const events = lifecycleFrom(values);
  const eventKinds = new Set(events.map((event) => event.kind));
  for (const required of [
    "provider.start.requested",
    "provider.started",
    "provider.stop.requested",
    "provider.stopped",
    "environment.session.started",
    "environment.session.ended",
  ]) {
    if (!eventKinds.has(required)) {
      findings.push(
        finding(
          "FAIL",
          "lifecycle_event_missing",
          `Lifecycle event '${required}' is missing.`,
          "runtime",
        ),
      );
    }
  }

  if (mode === "s0") {
    const appStates = new Set(
      events
        .filter((event) => event.kind === "app.state.changed")
        .map((event) => event.detail),
    );
    if (!appStates.has("background") || !appStates.has("active")) {
      findings.push(
        finding(
          "INCONCLUSIVE",
          "background_recovery_missing",
          "This exploration does not contain both background and active app-state evidence. The S0 protocol is incomplete; this alone is not a product failure.",
          "protocol",
        ),
      );
    }
    if ((numberValue(values.marker_input_completed) ?? 0) < 1) {
      findings.push(
        finding(
          "INCONCLUSIVE",
          "marker_not_completed",
          "This exploration does not contain one completed marker input. The S0 protocol is incomplete.",
          "protocol",
        ),
      );
    }
  }

  const minutes = durationMinutes(values);
  if (mode === "s0" && minutes !== null) {
    if (minutes < 4) {
      findings.push(
        finding(
          "INCONCLUSIVE",
          "s0_duration_too_short",
          `S0 duration is ${minutes.toFixed(1)} minutes; at least 4 minutes of one continuous exploration are required to interpret the run.`,
          "protocol",
        ),
      );
    } else if (minutes < 5 || minutes > 10) {
      findings.push(
        finding(
          "WARN",
          "s0_duration_outside_target",
          `S0 duration is ${minutes.toFixed(1)} minutes; target is 5–10 minutes.`,
          "protocol",
        ),
      );
    }
  }

  for (const key of ["start_battery_percent", "end_battery_percent"]) {
    if (numberValue(values[key]) === null) {
      findings.push(
        finding("WARN", "battery_value_missing", `${key} was not provided.`, "environment"),
      );
    }
  }
  if (booleanValue(values.start_power_save_mode) === true) {
    findings.push(
      finding("WARN", "power_save_enabled", "Battery saver was enabled at start.", "environment"),
    );
  }
  if (booleanValue(values.start_battery_optimization_enabled) === true) {
    findings.push(
      finding(
        "WARN",
        "battery_optimization_enabled",
        "The app was subject to battery optimization at start.",
        "environment",
      ),
    );
  }

  const thermal = numberValue(values.end_thermal_status);
  if (thermal === null) {
    findings.push(
      finding("WARN", "thermal_value_missing", "Thermal status was not provided.", "environment"),
    );
  } else if (thermal >= 4) {
    findings.push(
      finding("FAIL", "thermal_critical", `End thermal status was ${thermal}.`, "environment"),
    );
  } else if (thermal >= 2) {
    findings.push(
      finding("WARN", "thermal_elevated", `End thermal status was ${thermal}.`, "environment"),
    );
  }

  const durationMs = numberValue(values.duration_ms);
  const snapshotDurationMs = numberValue(values.snapshot_elapsed_duration_ms);
  if (
    durationMs !== null &&
    snapshotDurationMs !== null &&
    Math.abs(durationMs - snapshotDurationMs) > 15_000
  ) {
    findings.push(
      finding(
        "WARN",
        "snapshot_duration_mismatch",
        `Session and snapshot durations differ by ${Math.round(Math.abs(durationMs - snapshotDurationMs) / 1000)} seconds.`,
        "environment",
      ),
    );
  }

  return { findings, lifecycle: events, status: statusFor(findings) };
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

function parseChecksums(text) {
  return text
    .replaceAll("\r\n", "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = /^([a-fA-F0-9]{64})\s{2}(.+)$/.exec(line);
      return match
        ? { expected: match[1].toLowerCase(), relativePath: match[2] }
        : { error: `Malformed checksum line: ${line}` };
    });
}

async function sha256File(filePath) {
  return createHash("sha256").update(await fs.readFile(filePath)).digest("hex");
}

async function verifyChecksums(bundleDirectory) {
  const findings = [];
  let entries;
  try {
    entries = parseChecksums(
      await fs.readFile(path.join(bundleDirectory, "SHA256SUMS.txt"), "utf8"),
    );
  } catch {
    return {
      valid: false,
      checkedFiles: 0,
      findings: [
        finding("FAIL", "checksums_missing", "SHA256SUMS.txt is missing.", "integrity"),
      ],
    };
  }

  let checkedFiles = 0;
  const root = path.resolve(bundleDirectory);
  for (const entry of entries) {
    if (entry.error) {
      findings.push(finding("FAIL", "checksum_line_invalid", entry.error, "integrity"));
      continue;
    }
    const resolved = path.resolve(root, entry.relativePath);
    const relative = path.relative(root, resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      findings.push(
        finding(
          "FAIL",
          "checksum_path_escape",
          `Checksum path escapes bundle: ${entry.relativePath}`,
          "integrity",
        ),
      );
      continue;
    }
    try {
      const actual = await sha256File(resolved);
      checkedFiles += 1;
      if (actual !== entry.expected) {
        findings.push(
          finding(
            "FAIL",
            "checksum_mismatch",
            `Checksum mismatch: ${entry.relativePath}`,
            "integrity",
          ),
        );
      }
    } catch {
      findings.push(
        finding(
          "FAIL",
          "checksum_file_missing",
          `Checksummed file is missing: ${entry.relativePath}`,
          "integrity",
        ),
      );
    }
  }
  if (entries.length === 0) {
    findings.push(
      finding("FAIL", "checksums_empty", "SHA256SUMS.txt contains no entries.", "integrity"),
    );
  }
  return {
    valid: !findings.some((item) => item.severity === "FAIL"),
    checkedFiles,
    findings,
  };
}

async function resolveBundleDirectory(inputPath) {
  const resolved = path.resolve(inputPath);
  const stat = await fs.stat(resolved).catch(() => null);
  if (stat === null) throw new Error(`Field-test input does not exist: ${resolved}`);

  if (stat.isFile()) {
    if (path.basename(resolved) !== "coordinate-free-diagnostics.txt") {
      throw new Error("A file input must be coordinate-free-diagnostics.txt.");
    }
    return path.dirname(resolved);
  }

  const direct = path.join(resolved, "coordinate-free-diagnostics.txt");
  if ((await fs.stat(direct).catch(() => null))?.isFile()) return resolved;

  const candidates = (await fs.readdir(resolved, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("pem-field-test-"))
    .map((entry) => entry.name)
    .sort();
  if (candidates.length === 0) {
    throw new Error(`No pem-field-test-* bundle exists under ${resolved}.`);
  }
  return path.join(resolved, candidates.at(-1));
}

function evaluateManifest(manifest) {
  const findings = [];
  if (manifest.packageName !== EXPECTED_PACKAGE) {
    findings.push(
      finding(
        "FAIL",
        "manifest_package_invalid",
        `Unexpected package: ${manifest.packageName}`,
        "integrity",
      ),
    );
  }
  if (manifest.autoUpload !== false) {
    findings.push(
      finding(
        "FAIL",
        "automatic_upload_not_disabled",
        "Manifest must declare autoUpload=false.",
        "privacy",
      ),
    );
  }
  if (manifest.containsRawLocation !== true) {
    findings.push(
      finding(
        "FAIL",
        "raw_location_warning_missing",
        "Manifest must explicitly declare containsRawLocation=true.",
        "privacy",
      ),
    );
  }
  if (!stringValue(manifest.warning)) {
    findings.push(
      finding("WARN", "manifest_warning_missing", "Privacy warning is missing.", "privacy"),
    );
  }
  return findings;
}

function markdownCell(value) {
  return String(value ?? "—").replaceAll("|", "\\|").replaceAll("\n", " ");
}

function formatMinutes(values) {
  const minutes = durationMinutes(values);
  return minutes === null ? "—" : minutes.toFixed(1);
}

function nextAction(status) {
  if (status === "FAIL") {
    return "同じ条件を再度歩かず、USB bundleを保持したままコード・エミュレータ側へ戻す。";
  }
  if (status === "INCONCLUSIVE") {
    return "製品FAILとは判定しない。bundleを保持し、指摘されたS0手順を1つの探索で満たして再実施する。";
  }
  if (status === "WARN") {
    return "主観レビューと警告理由を確認し、S1へ進む条件を個別に判断する。";
  }
  return "主観レビューを記録し、問題がなければS1条件へ進む。";
}

function renderMarkdown(report) {
  const evaluated = report.evaluatedExploration?.values ?? {};
  const findings = report.findings.length
    ? report.findings
    : [finding("INFO", "all_objective_checks_passed", "All objective S0 checks passed.")];
  return [
    "# Field-test objective S0 report",
    "",
    `- Objective status: **${report.status}**`,
    `- Bundle: \`${markdownCell(report.bundleName)}\``,
    `- Mode: \`${report.mode}\``,
    `- Evaluated exploration: ${markdownCell(report.evaluatedExplorationIndex)}`,
    `- Selection: ${markdownCell(report.selectionReason)}`,
    "- Subjective review required: **yes**",
    `- Next action: ${report.nextAction}`,
    "",
    "> This report is not the product Go / Narrow / Stop decision. Map recognizability, pocket UX, safety, and differentiation from Timeline remain human judgments.",
    "",
    "## Evaluated exploration",
    "",
    "| Item | Value |",
    "|---|---|",
    `| Device | ${markdownCell(evaluated.device_manufacturer)} ${markdownCell(evaluated.device_model)} / Android ${markdownCell(evaluated.android_version)} |`,
    `| App | ${markdownCell(evaluated.app_version_name)} / ${markdownCell(evaluated.app_package)} |`,
    `| Start | ${markdownCell(evaluated.session_started_at_iso_utc)} |`,
    `| End | ${markdownCell(evaluated.session_ended_at_iso_utc)} |`,
    `| Duration | ${formatMinutes(evaluated)} min |`,
    `| Samples | raw ${markdownCell(evaluated.raw_samples)} / accepted ${markdownCell(evaluated.accepted_samples)} / rejected ${markdownCell(evaluated.rejected_samples)} |`,
    `| Accuracy | median ${markdownCell(evaluated.accuracy_m_median)} m / p95 ${markdownCell(evaluated.accuracy_m_p95)} m / max ${markdownCell(evaluated.accuracy_m_max)} m |`,
    `| Observation gap | p95 ${markdownCell(evaluated.sample_gap_ms_p95)} ms / max ${markdownCell(evaluated.sample_gap_ms_max)} ms |`,
    `| Callback gap | p95 ${markdownCell(evaluated.callback_gap_ms_p95)} ms / max ${markdownCell(evaluated.callback_gap_ms_max)} ms |`,
    `| Battery | ${markdownCell(evaluated.start_battery_percent)}% → ${markdownCell(evaluated.end_battery_percent)}% / consumed ${markdownCell(evaluated.battery_consumed_percentage_points)} pt |`,
    `| Marker | completed ${markdownCell(evaluated.marker_input_completed)} / cancelled ${markdownCell(evaluated.marker_input_cancelled)} |`,
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
    "| # | Status | Start | Duration min | Raw | Accepted | p95 observation gap ms | Marker |",
    "|---:|---|---|---:|---:|---:|---:|---:|",
    ...report.explorations.map(({ index, values, objectiveStatus }) =>
      `| ${index} | ${objectiveStatus} | ${markdownCell(values.session_started_at_iso_utc)} | ${formatMinutes(values)} | ${markdownCell(values.raw_samples)} | ${markdownCell(values.accepted_samples)} | ${markdownCell(values.sample_gap_ms_p95)} | ${markdownCell(values.marker_input_completed)} |`,
    ),
    "",
    "## Privacy boundary",
    "",
    "- This analyzer reads the coordinate-free summary, manifest, and checksums.",
    "- It does not parse the raw SQLite/tar location history.",
    "- The raw bundle remains local and is not uploaded.",
    "- Exact coordinates, map IDs/names, marker text, and map images are not written to this report.",
    "",
  ].join("\n");
}

function selectExploration(parsed, explorationIndex) {
  if (parsed.explorations.length === 0) {
    return { selected: null, reason: "no-exploration" };
  }
  if (explorationIndex !== null) {
    return {
      selected:
        parsed.explorations.find((item) => item.index === explorationIndex) ?? null,
      reason: "explicit-exploration-index",
    };
  }
  return {
    selected: parsed.explorations.at(-1) ?? null,
    reason:
      parsed.explorations.length === 1
        ? "only-exploration"
        : "latest-exploration-default; use --exploration-index for retrospective selection",
  };
}

export async function analyzeFieldTestBundle(
  inputPath = DEFAULT_INPUT,
  {
    outputDirectory = null,
    mode = "s0",
    generatedAt = new Date().toISOString(),
    explorationIndex = null,
  } = {},
) {
  const bundleDirectory = await resolveBundleDirectory(inputPath);
  const [summaryText, manifestText, checksumResult] = await Promise.all([
    fs.readFile(path.join(bundleDirectory, "coordinate-free-diagnostics.txt"), "utf8"),
    fs.readFile(path.join(bundleDirectory, "manifest.json"), "utf8"),
    verifyChecksums(bundleDirectory),
  ]);
  const parsed = parseCoordinateFreeSummary(summaryText);
  const manifest = JSON.parse(manifestText);
  const globalFindings = [
    ...checksumResult.findings,
    ...evaluateManifest(manifest),
    ...evaluatePrivacy(parsed),
  ];

  for (const duplicate of parsed.duplicateKeys) {
    globalFindings.push(
      finding(
        "FAIL",
        "duplicate_summary_key",
        `Duplicate key '${duplicate.key}' in section ${duplicate.section}.`,
        "integrity",
      ),
    );
  }
  if (parsed.explorations.length === 0) {
    globalFindings.push(
      finding(
        "FAIL",
        "exploration_missing",
        "The summary contains no exploration section.",
        "integrity",
      ),
    );
  }
  const declaredCount = numberValue(parsed.metadata.exploration_count);
  if (declaredCount !== null && declaredCount !== parsed.explorations.length) {
    globalFindings.push(
      finding(
        "WARN",
        "exploration_count_mismatch",
        `Header declares ${declaredCount}; parsed ${parsed.explorations.length}.`,
        "integrity",
      ),
    );
  }

  const evaluated = parsed.explorations.map((item) => {
    const evaluation = evaluateExploration(item.values, { mode });
    return {
      index: item.index,
      values: sanitizeValues(item.values),
      lifecycle: evaluation.lifecycle,
      objectiveStatus: evaluation.status,
      findings: evaluation.findings,
    };
  });

  const selection = selectExploration(parsed, explorationIndex);
  if (explorationIndex !== null && selection.selected === null) {
    globalFindings.push(
      finding(
        "FAIL",
        "requested_exploration_missing",
        `Requested exploration index ${explorationIndex} is not present.`,
        "integrity",
      ),
    );
  }
  const selectedEvaluation =
    selection.selected === null
      ? null
      : evaluated.find((item) => item.index === selection.selected.index) ?? null;
  const findings = [
    ...globalFindings,
    ...(selectedEvaluation?.findings ?? []),
  ];
  if (parsed.explorations.length > 1) {
    findings.push(
      finding(
        "INFO",
        "multiple_explorations_present",
        `${parsed.explorations.length} explorations are present. Objective requirements are never combined across sessions.`,
        "protocol",
      ),
    );
  }

  const status = statusFor(findings);
  const latestExploration = evaluated.at(-1) ?? null;
  const report = {
    schemaVersion: REPORT_SCHEMA_VERSION,
    generatedAt,
    mode,
    status,
    subjectiveReviewRequired: true,
    productDecisionAutomated: false,
    bundleName: path.basename(bundleDirectory),
    integrity: {
      valid: checksumResult.valid,
      checkedFiles: checksumResult.checkedFiles,
    },
    manifest: {
      packageName: manifest.packageName ?? null,
      containsRawLocation: manifest.containsRawLocation ?? null,
      autoUpload: manifest.autoUpload ?? null,
    },
    explorations: evaluated,
    latestExploration,
    evaluatedExplorationIndex: selectedEvaluation?.index ?? null,
    evaluatedExploration: selectedEvaluation,
    selectionReason: selection.reason,
    findings,
    nextAction: nextAction(status),
  };

  const reportDirectory = path.resolve(
    outputDirectory ?? path.join(bundleDirectory, "analysis"),
  );
  await fs.mkdir(reportDirectory, { recursive: true });
  const jsonPath = path.join(reportDirectory, "objective-s0-report.json");
  const markdownPath = path.join(reportDirectory, "objective-s0-report.md");
  await Promise.all([
    fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8"),
    fs.writeFile(markdownPath, renderMarkdown(report), "utf8"),
  ]);
  return { report, bundleDirectory, reportDirectory, jsonPath, markdownPath };
}

function parseArguments(argv) {
  let inputPath = DEFAULT_INPUT;
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
      const value = argv[++index];
      explorationIndex = Number(value);
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

export async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  const result = await analyzeFieldTestBundle(options.inputPath, options);
  console.log(`Objective S0 status: ${result.report.status}`);
  console.log(`Evaluated exploration: ${result.report.evaluatedExplorationIndex ?? "none"}`);
  console.log(`Selection: ${result.report.selectionReason}`);
  console.log(`Markdown: ${result.markdownPath}`);
  console.log(`JSON: ${result.jsonPath}`);
  console.log(`Next action: ${result.report.nextAction}`);
  if (options.failExit && result.report.status === "FAIL") process.exitCode = 2;
  if (options.failExit && result.report.status === "INCONCLUSIVE") process.exitCode = 3;
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
