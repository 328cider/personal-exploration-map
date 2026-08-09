#!/usr/bin/env node

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const EXPECTED_PACKAGE = "com.cider328.personalexplorationmap.fieldtest";
const DEFAULT_INPUT = "artifacts/device-bundles";
const REPORT_SCHEMA_VERSION = 1;
const SEVERITY_RANK = { INFO: 0, WARN: 1, FAIL: 2 };

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

function finding(severity, code, message) {
  return { severity, code, message };
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

function sanitizeExploration(exploration) {
  const safeValues = {};
  for (const field of SAFE_REPORT_FIELDS) {
    if (Object.hasOwn(exploration.values, field)) {
      safeValues[field] = exploration.values[field];
    }
  }
  safeValues.lifecycle_count = lifecycleFrom(exploration.values).length;
  return {
    index: exploration.index,
    values: safeValues,
    lifecycle: lifecycleFrom(exploration.values),
  };
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
      ),
    );
  }
  return findings;
}

function requireFields(values, fields, findings) {
  for (const field of fields) {
    if (!Object.hasOwn(values, field) || values[field] === null || values[field] === "") {
      findings.push(
        finding("FAIL", "required_field_missing", `Required field '${field}' is missing.`),
      );
    }
  }
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
      finding("FAIL", "unexpected_package", `Expected ${EXPECTED_PACKAGE}; got ${values.app_package}.`),
    );
  }
  if (booleanValue(values.app_debuggable) !== true) {
    findings.push(
      finding(
        "FAIL",
        "field_test_not_debuggable",
        "The collected package is not the USB-debuggable Field-test build.",
      ),
    );
  }
  if (values.provider !== "gnss-background") {
    findings.push(
      finding("WARN", "unexpected_provider", `Expected gnss-background; got ${values.provider}.`),
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
      findings.push(finding("FAIL", "required_permission_missing", `${key} is not true.`));
    }
  }

  const rawSamples = numberValue(values.raw_samples);
  const acceptedSamples = numberValue(values.accepted_samples);
  if (rawSamples === null || rawSamples <= 0) {
    findings.push(finding("FAIL", "no_raw_samples", "No raw location samples were recorded."));
  }
  if (acceptedSamples === null || acceptedSamples <= 0) {
    findings.push(
      finding("FAIL", "no_accepted_samples", "No samples were accepted into the derived route."),
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
      ),
    );
  } else if (received !== null && persisted !== null && persisted + duplicates > received) {
    findings.push(
      finding(
        "WARN",
        "callback_accounting_inconsistent",
        `Persisted plus duplicate samples (${persisted + duplicates}) exceed received samples (${received}).`,
      ),
    );
  }

  const failedBatches = numberValue(values.callback_failed_batches);
  if (failedBatches !== null && failedBatches > 0) {
    findings.push(
      finding("FAIL", "callback_batch_failed", `${failedBatches} callback batch(es) failed.`),
    );
  }

  const lastError = stringValue(values.last_error_kind);
  if (lastError && lastError !== "none") {
    findings.push(
      finding(
        "FAIL",
        "operational_error",
        `${lastError}: ${stringValue(values.last_error_message) ?? "no message"}`,
      ),
    );
  }

  const gaps120 = numberValue(values.sample_gap_at_least_120s) ?? 0;
  const gaps60 = numberValue(values.sample_gap_at_least_60s) ?? 0;
  const gaps30 = numberValue(values.sample_gap_at_least_30s) ?? 0;
  if (gaps120 > 0) {
    findings.push(
      finding("FAIL", "sample_gap_120s", `${gaps120} sample gap(s) were at least 120 seconds.`),
    );
  } else if (gaps60 > 0) {
    findings.push(
      finding("WARN", "sample_gap_60s", `${gaps60} sample gap(s) were at least 60 seconds.`),
    );
  } else if (gaps30 > 0) {
    findings.push(
      finding("WARN", "sample_gap_30s", `${gaps30} sample gap(s) were at least 30 seconds.`),
    );
  }

  const acceptanceRate = numberValue(values.acceptance_rate);
  if (acceptanceRate !== null && acceptanceRate < 0.5) {
    findings.push(
      finding(
        "WARN",
        "low_acceptance_rate",
        `Acceptance rate is ${(acceptanceRate * 100).toFixed(1)}%.`,
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
        finding("FAIL", "lifecycle_event_missing", `Lifecycle event '${required}' is missing.`),
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
          "FAIL",
          "background_recovery_missing",
          "S0 did not contain both background and active app-state evidence.",
        ),
      );
    }
    if ((numberValue(values.marker_input_completed) ?? 0) < 1) {
      findings.push(finding("FAIL", "marker_not_completed", "S0 requires one completed marker input."));
    }
  }

  const minutes = durationMinutes(values);
  if (mode === "s0" && minutes !== null && (minutes < 4 || minutes > 15)) {
    findings.push(
      finding(
        "WARN",
        "s0_duration_outside_target",
        `S0 duration is ${minutes.toFixed(1)} minutes; target is 5–10 minutes.`,
      ),
    );
  }

  for (const key of ["start_battery_percent", "end_battery_percent"]) {
    if (numberValue(values[key]) === null) {
      findings.push(finding("WARN", "battery_value_missing", `${key} was not provided.`));
    }
  }
  if (booleanValue(values.start_power_save_mode) === true) {
    findings.push(finding("WARN", "power_save_enabled", "Battery saver was enabled at start."));
  }
  if (booleanValue(values.start_battery_optimization_enabled) === true) {
    findings.push(
      finding(
        "WARN",
        "battery_optimization_enabled",
        "The app was subject to battery optimization at start.",
      ),
    );
  }

  const thermal = numberValue(values.end_thermal_status);
  if (thermal === null) {
    findings.push(finding("WARN", "thermal_value_missing", "Thermal status was not provided."));
  } else if (thermal >= 4) {
    findings.push(finding("FAIL", "thermal_critical", `End thermal status was ${thermal}.`));
  } else if (thermal >= 2) {
    findings.push(finding("WARN", "thermal_elevated", `End thermal status was ${thermal}.`));
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
      ),
    );
  }

  return { findings, lifecycle: events };
}

function statusFor(findings) {
  const rank = findings.reduce(
    (current, item) => Math.max(current, SEVERITY_RANK[item.severity] ?? 0),
    0,
  );
  if (rank >= SEVERITY_RANK.FAIL) return "FAIL";
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
      findings: [finding("FAIL", "checksums_missing", "SHA256SUMS.txt is missing.")],
    };
  }

  let checkedFiles = 0;
  const root = path.resolve(bundleDirectory);
  for (const entry of entries) {
    if (entry.error) {
      findings.push(finding("FAIL", "checksum_line_invalid", entry.error));
      continue;
    }
    const resolved = path.resolve(root, entry.relativePath);
    const relative = path.relative(root, resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      findings.push(
        finding("FAIL", "checksum_path_escape", `Checksum path escapes bundle: ${entry.relativePath}`),
      );
      continue;
    }
    try {
      const actual = await sha256File(resolved);
      checkedFiles += 1;
      if (actual !== entry.expected) {
        findings.push(
          finding("FAIL", "checksum_mismatch", `Checksum mismatch: ${entry.relativePath}`),
        );
      }
    } catch {
      findings.push(
        finding("FAIL", "checksum_file_missing", `Checksummed file is missing: ${entry.relativePath}`),
      );
    }
  }
  if (entries.length === 0) {
    findings.push(finding("FAIL", "checksums_empty", "SHA256SUMS.txt contains no entries."));
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
      finding("FAIL", "manifest_package_invalid", `Unexpected package: ${manifest.packageName}`),
    );
  }
  if (manifest.autoUpload !== false) {
    findings.push(
      finding("FAIL", "automatic_upload_not_disabled", "Manifest must declare autoUpload=false."),
    );
  }
  if (manifest.containsRawLocation !== true) {
    findings.push(
      finding(
        "FAIL",
        "raw_location_warning_missing",
        "Manifest must explicitly declare containsRawLocation=true.",
      ),
    );
  }
  if (!stringValue(manifest.warning)) {
    findings.push(finding("WARN", "manifest_warning_missing", "Privacy warning is missing."));
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
  if (status === "WARN") {
    return "主観レビューと警告理由を確認し、S1へ進む条件を個別に判断する。";
  }
  return "主観レビューを記録し、問題がなければS1条件へ進む。";
}

function renderMarkdown(report) {
  const latest = report.latestExploration?.values ?? {};
  const findings = report.findings.length
    ? report.findings
    : [finding("INFO", "all_objective_checks_passed", "All objective S0 checks passed.")];
  return [
    "# Field-test objective S0 report",
    "",
    `- Objective status: **${report.status}**`,
    `- Bundle: \`${markdownCell(report.bundleName)}\``,
    `- Mode: \`${report.mode}\``,
    "- Subjective review required: **yes**",
    `- Next action: ${report.nextAction}`,
    "",
    "> This report is not the product Go / Narrow / Stop decision. Map recognizability, pocket UX, safety, and differentiation from Timeline remain human judgments.",
    "",
    "## Latest exploration",
    "",
    "| Item | Value |",
    "|---|---|",
    `| Device | ${markdownCell(latest.device_manufacturer)} ${markdownCell(latest.device_model)} / Android ${markdownCell(latest.android_version)} |`,
    `| App | ${markdownCell(latest.app_version_name)} / ${markdownCell(latest.app_package)} |`,
    `| Start | ${markdownCell(latest.session_started_at_iso_utc)} |`,
    `| End | ${markdownCell(latest.session_ended_at_iso_utc)} |`,
    `| Duration | ${formatMinutes(latest)} min |`,
    `| Samples | raw ${markdownCell(latest.raw_samples)} / accepted ${markdownCell(latest.accepted_samples)} / rejected ${markdownCell(latest.rejected_samples)} |`,
    `| Accuracy | median ${markdownCell(latest.accuracy_m_median)} m / p95 ${markdownCell(latest.accuracy_m_p95)} m / max ${markdownCell(latest.accuracy_m_max)} m |`,
    `| Gap | p95 ${markdownCell(latest.sample_gap_ms_p95)} ms / max ${markdownCell(latest.sample_gap_ms_max)} ms |`,
    `| Battery | ${markdownCell(latest.start_battery_percent)}% → ${markdownCell(latest.end_battery_percent)}% / consumed ${markdownCell(latest.battery_consumed_percentage_points)} pt |`,
    `| Marker | completed ${markdownCell(latest.marker_input_completed)} / cancelled ${markdownCell(latest.marker_input_cancelled)} |`,
    `| Last error | ${markdownCell(latest.last_error_kind)} / ${markdownCell(latest.last_error_message)} |`,
    "",
    "## Findings",
    "",
    "| Severity | Code | Detail |",
    "|---|---|---|",
    ...findings.map(
      (item) => `| ${item.severity} | \`${markdownCell(item.code)}\` | ${markdownCell(item.message)} |`,
    ),
    "",
    "## All explorations in the coordinate-free summary",
    "",
    "| # | Start | Duration min | Raw | Accepted | p95 gap ms | Marker |",
    "|---:|---|---:|---:|---:|---:|---:|",
    ...report.explorations.map(({ index, values }) =>
      `| ${index} | ${markdownCell(values.session_started_at_iso_utc)} | ${formatMinutes(values)} | ${markdownCell(values.raw_samples)} | ${markdownCell(values.accepted_samples)} | ${markdownCell(values.sample_gap_ms_p95)} | ${markdownCell(values.marker_input_completed)} |`,
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

export async function analyzeFieldTestBundle(
  inputPath = DEFAULT_INPUT,
  { outputDirectory = null, mode = "s0", generatedAt = new Date().toISOString() } = {},
) {
  const bundleDirectory = await resolveBundleDirectory(inputPath);
  const [summaryText, manifestText, checksumResult] = await Promise.all([
    fs.readFile(path.join(bundleDirectory, "coordinate-free-diagnostics.txt"), "utf8"),
    fs.readFile(path.join(bundleDirectory, "manifest.json"), "utf8"),
    verifyChecksums(bundleDirectory),
  ]);
  const parsed = parseCoordinateFreeSummary(summaryText);
  const manifest = JSON.parse(manifestText);
  const findings = [
    ...checksumResult.findings,
    ...evaluateManifest(manifest),
    ...evaluatePrivacy(parsed),
  ];

  for (const duplicate of parsed.duplicateKeys) {
    findings.push(
      finding(
        "FAIL",
        "duplicate_summary_key",
        `Duplicate key '${duplicate.key}' in section ${duplicate.section}.`,
      ),
    );
  }
  if (parsed.explorations.length === 0) {
    findings.push(
      finding("FAIL", "exploration_missing", "The summary contains no exploration section."),
    );
  }
  const declaredCount = numberValue(parsed.metadata.exploration_count);
  if (declaredCount !== null && declaredCount !== parsed.explorations.length) {
    findings.push(
      finding(
        "WARN",
        "exploration_count_mismatch",
        `Header declares ${declaredCount}; parsed ${parsed.explorations.length}.`,
      ),
    );
  }

  const latestRaw = parsed.explorations.at(-1) ?? null;
  if (latestRaw) findings.push(...evaluateExploration(latestRaw.values, { mode }).findings);

  const explorations = parsed.explorations.map(sanitizeExploration);
  const latestExploration = explorations.at(-1) ?? null;
  const status = statusFor(findings);
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
    explorations,
    latestExploration,
    findings,
    nextAction: nextAction(status),
  };

  const reportDirectory = path.resolve(outputDirectory ?? path.join(bundleDirectory, "analysis"));
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
  let positionalSeen = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--output-dir") {
      outputDirectory = argv[++index];
    } else if (argument === "--mode") {
      mode = argv[++index];
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
  return { inputPath, outputDirectory, mode, failExit };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const result = await analyzeFieldTestBundle(options.inputPath, options);
  console.log(`Objective S0 status: ${result.report.status}`);
  console.log(`Markdown: ${result.markdownPath}`);
  console.log(`JSON: ${result.jsonPath}`);
  console.log(`Next action: ${result.report.nextAction}`);
  if (options.failExit && result.report.status === "FAIL") process.exitCode = 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
