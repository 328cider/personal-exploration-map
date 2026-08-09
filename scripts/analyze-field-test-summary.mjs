#!/usr/bin/env node

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const EXPECTED_PACKAGE = "com.cider328.personalexplorationmap.fieldtest";
const DEFAULT_INPUT = "artifacts/device-bundles";
const REPORT_SCHEMA_VERSION = 1;

const SEVERITY_RANK = {
  INFO: 0,
  WARN: 1,
  FAIL: 2,
};

const PROHIBITED_KEY_PATTERNS = [
  /(^|_)(latitude|longitude)(_|$)/i,
  /(^|_)(local_x|local_y|x_meters|y_meters)(_|$)/i,
  /(^|_)(personal_map_id|exploration_id|map_name|marker_text)(_|$)/i,
];

function parseScalar(value) {
  const trimmed = value.trim();
  if (trimmed === "null") {
    return null;
  }
  if (trimmed === "true") {
    return true;
  }
  if (trimmed === "false") {
    return false;
  }
  if (/^-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(trimmed)) {
    return Number(trimmed);
  }
  return trimmed;
}

export function parseCoordinateFreeSummary(text) {
  const normalized = text.replaceAll("\r\n", "\n");
  const metadata = {};
  const explorations = [];
  const duplicateKeys = [];
  let title = "";
  let current = null;

  for (const rawLine of normalized.split("\n")) {
    const line = rawLine.trim();
    if (line.length === 0) {
      continue;
    }
    const section = /^\[exploration_(\d+)\]$/.exec(line);
    if (section !== null) {
      current = {
        index: Number(section[1]),
        values: {},
      };
      explorations.push(current);
      continue;
    }

    const separator = line.indexOf("=");
    if (separator < 1) {
      if (title.length === 0) {
        title = line;
      }
      continue;
    }

    const key = line.slice(0, separator).trim();
    const value = parseScalar(line.slice(separator + 1));
    const target = current?.values ?? metadata;
    if (Object.hasOwn(target, key)) {
      duplicateKeys.push({ section: current?.index ?? 0, key });
    }
    target[key] = value;
  }

  return { title, metadata, explorations, duplicateKeys };
}

function finding(severity, code, message) {
  return { severity, code, message };
}

function asNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asBoolean(value) {
  return typeof value === "boolean" ? value : null;
}

function asString(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function durationMinutes(values) {
  const durationMs = asNumber(values.duration_ms);
  return durationMs === null ? null : durationMs / 60_000;
}

function lifecycle(values) {
  const count = Math.max(0, Math.trunc(asNumber(values.lifecycle_count) ?? 0));
  const events = [];
  for (let index = 1; index <= count; index += 1) {
    events.push({
      kind: asString(values[`lifecycle_${index}_kind`]) ?? "",
      detail: asString(values[`lifecycle_${index}_detail`]) ?? "",
      offsetMs: asNumber(values[`lifecycle_${index}_offset_ms`]),
    });
  }
  return events;
}

function evaluatePrivacy(parsed) {
  const findings = [];
  const keySets = [
    { section: "metadata", keys: Object.keys(parsed.metadata) },
    ...parsed.explorations.map((item) => ({
      section: `exploration_${item.index}`,
      keys: Object.keys(item.values),
    })),
  ];

  for (const keySet of keySets) {
    for (const key of keySet.keys) {
      if (PROHIBITED_KEY_PATTERNS.some((pattern) => pattern.test(key))) {
        findings.push(
          finding(
            "FAIL",
            "coordinate_key_present",
            `${keySet.section} contains prohibited key '${key}'.`,
          ),
        );
      }
    }
  }

  if (parsed.metadata.privacy !== "no_coordinates_no_map_names_no_ids_no_marker_text_no_map_images") {
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
      "start_background_location_granted",
      "end_background_location_granted",
      "start_notification_granted",
      "end_notification_granted",
      "raw_samples",
      "accepted_samples",
      "callback_received_samples",
      "callback_persisted_samples",
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
  if (asBoolean(values.app_debuggable) !== true) {
    findings.push(
      finding("FAIL", "field_test_not_debuggable", "The collected package is not the USB-debuggable Field-test build."),
    );
  }
  if (values.provider !== "gnss-background") {
    findings.push(
      finding("WARN", "unexpected_provider", `Expected gnss-background for S0; got ${values.provider}.`),
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
    if (asBoolean(values[key]) !== true) {
      findings.push(
        finding("FAIL", "required_permission_missing", `${key} is not true.`),
      );
    }
  }

  const rawSamples = asNumber(values.raw_samples);
  const acceptedSamples = asNumber(values.accepted_samples);
  const receivedSamples = asNumber(values.callback_received_samples);
  const persistedSamples = asNumber(values.callback_persisted_samples);
  const failedBatches = asNumber(values.callback_failed_batches);
  if (rawSamples === null || rawSamples <= 0) {
    findings.push(finding("FAIL", "no_raw_samples", "No raw location samples were recorded."));
  }
  if (acceptedSamples === null || acceptedSamples <= 0) {
    findings.push(finding("FAIL", "no_accepted_samples", "No location samples were accepted into the derived route."));
  }
  if (
    receivedSamples !== null &&
    persistedSamples !== null &&
    persistedSamples < receivedSamples
  ) {
    findings.push(
      finding(
        "FAIL",
        "callback_samples_not_persisted",
        `Persisted callback samples (${persistedSamples}) are fewer than received samples (${receivedSamples}).`,
      ),
    );
  }
  if (failedBatches !== null && failedBatches > 0) {
    findings.push(
      finding("FAIL", "callback_batch_failed", `${failedBatches} callback batch(es) failed.`),
    );
  }

  const lastError = asString(values.last_error_kind);
  if (lastError !== null && lastError !== "none") {
    findings.push(
      finding(
        "FAIL",
        "operational_error",
        `${lastError}: ${asString(values.last_error_message) ?? "no message"}`,
      ),
    );
  }

  const gaps120 = asNumber(values.sample_gap_at_least_120s) ?? 0;
  const gaps60 = asNumber(values.sample_gap_at_least_60s) ?? 0;
  const gaps30 = asNumber(values.sample_gap_at_least_30s) ?? 0;
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

  const acceptanceRate = asNumber(values.acceptance_rate);
  if (acceptanceRate !== null && acceptanceRate < 0.5) {
    findings.push(
      finding(
        "WARN",
        "low_acceptance_rate",
        `Acceptance rate is ${(acceptanceRate * 100).toFixed(1)}%.`,
      ),
    );
  }

  const events = lifecycle(values);
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
    if ((asNumber(values.marker_input_completed) ?? 0) < 1) {
      findings.push(
        finding("FAIL", "marker_not_completed", "S0 requires one completed marker input."),
      );
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
    if (asNumber(values[key]) === null) {
      findings.push(
        finding("WARN", "battery_value_missing", `${key} was not provided by the device.`),
      );
    }
  }
  if (asBoolean(values.start_power_save_mode) === true) {
    findings.push(
      finding("WARN", "power_save_enabled", "Battery saver was enabled at session start."),
    );
  }
  if (asBoolean(values.start_battery_optimization_enabled) === true) {
    findings.push(
      finding(
        "WARN",
        "battery_optimization_enabled",
        "The app was subject to battery optimization at session start.",
      ),
    );
  }
  const thermal = asNumber(values.end_thermal_status);
  if (thermal === null) {
    findings.push(
      finding("WARN", "thermal_value_missing", "Thermal status was not provided by the device."),
    );
  } else if (thermal >= 4) {
    findings.push(
      finding("FAIL", "thermal_critical", `End thermal status was ${thermal}.`),
    );
  } else if (thermal >= 2) {
    findings.push(
      finding("WARN", "thermal_elevated", `End thermal status was ${thermal}.`),
    );
  }

  const durationMs = asNumber(values.duration_ms);
  const snapshotDurationMs = asNumber(values.snapshot_elapsed_duration_ms);
  if (
    durationMs !== null &&
    snapshotDurationMs !== null &&
    Math.abs(durationMs - snapshotDurationMs) > 15_000
  ) {
    findings.push(
      finding(
        "WARN",
        "snapshot_duration_mismatch",
        `Session and environment elapsed durations differ by ${Math.round(Math.abs(durationMs - snapshotDurationMs) / 1000)} seconds.`,
      ),
    );
  }

  return { findings, lifecycle: events };
}

function statusFor(findings) {
  const maximum = findings.reduce(
    (rank, item) => Math.max(rank, SEVERITY_RANK[item.severity] ?? 0),
    0,
  );
  return maximum >= SEVERITY_RANK.FAIL
    ? "FAIL"
    : maximum >= SEVERITY_RANK.WARN
      ? "WARN"
      : "PASS";
}

async function sha256File(filePath) {
  const bytes = await fs.readFile(filePath);
  return createHash("sha256").update(bytes).digest("hex");
}

function parseChecksums(text) {
  return text
    .replaceAll("\r\n", "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = /^([a-fA-F0-9]{64})\s{2}(.+)$/.exec(line);
      return match === null
        ? { error: `Malformed checksum line: ${line}` }
        : { expected: match[1].toLowerCase(), relativePath: match[2] };
    });
}

async function verifyChecksums(bundleDirectory) {
  const findings = [];
  const checksumPath = path.join(bundleDirectory, "SHA256SUMS.txt");
  let text;
  try {
    text = await fs.readFile(checksumPath, "utf8");
  } catch {
    return {
      valid: false,
      checkedFiles: 0,
      findings: [finding("FAIL", "checksums_missing", "SHA256SUMS.txt is missing.")],
    };
  }

  const entries = parseChecksums(text);
  const bundleRoot = path.resolve(bundleDirectory) + path.sep;
  let checkedFiles = 0;
  for (const entry of entries) {
    if (entry.error !== undefined) {
      findings.push(finding("FAIL", "checksum_line_invalid", entry.error));
      continue;
    }
    const resolved = path.resolve(bundleDirectory, entry.relativePath);
    if (!resolved.startsWith(bundleRoot)) {
      findings.push(
        finding("FAIL", "checksum_path_escape", `Checksum path escapes the bundle: ${entry.relativePath}`),
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
    valid: findings.every((item) => item.severity !== "FAIL"),
    checkedFiles,
    findings,
  };
}

async function resolveBundleDirectory(inputPath) {
  const resolvedInput = path.resolve(inputPath);
  let stat;
  try {
    stat = await fs.stat(resolvedInput);
  } catch {
    throw new Error(`Field-test input does not exist: ${resolvedInput}`);
  }

  if (stat.isFile()) {
    if (path.basename(resolvedInput) !== "coordinate-free-diagnostics.txt") {
      throw new Error("A file input must be coordinate-free-diagnostics.txt.");
    }
    return path.dirname(resolvedInput);
  }

  const directSummary = path.join(resolvedInput, "coordinate-free-diagnostics.txt");
  try {
    if ((await fs.stat(directSummary)).isFile()) {
      return resolvedInput;
    }
  } catch {
    // Search child bundle directories below.
  }

  const entries = await fs.readdir(resolvedInput, { withFileTypes: true });
  const candidates = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("pem-field-test-"))
    .map((entry) => entry.name)
    .sort();
  if (candidates.length === 0) {
    throw new Error(`No pem-field-test-* bundle exists under ${resolvedInput}.`);
  }
  return path.join(resolvedInput, candidates.at(-1));
}

function evaluateManifest(manifest) {
  const findings = [];
  if (manifest.packageName !== EXPECTED_PACKAGE) {
    findings.push(
      finding("FAIL", "manifest_package_invalid", `Unexpected manifest package: ${manifest.packageName}`),
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
  if (typeof manifest.warning !== "string" || manifest.warning.length === 0) {
    findings.push(
      finding("WARN", "manifest_warning_missing", "Raw-location privacy warning is missing."),
    );
  }
  return findings;
}

function markdownCell(value) {
  return String(value ?? "—")
    .replaceAll("|", "\\|")
    .replaceAll("\n", " ");
}

function formatMinutes(value) {
  const minutes = durationMinutes(value);
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
  const findings = report.findings.length > 0
    ? report.findings
    : [finding("INFO", "all_objective_checks_passed", "All objective S0 checks passed.")];
  const lines = [
    "# Field-test objective S0 report",
    "",
    `- Objective status: **${report.status}**`,
    `- Bundle: \`${markdownCell(report.bundleName)}\``,
    `- Mode: \`${report.mode}\``,
    `- Subjective review required: **yes**`,
    `- Next action: ${nextAction(report.status)}`,
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
    ...report.explorations.map((exploration) => {
      const values = exploration.values;
      return `| ${exploration.index} | ${markdownCell(values.session_started_at_iso_utc)} | ${formatMinutes(values)} | ${markdownCell(values.raw_samples)} | ${markdownCell(values.accepted_samples)} | ${markdownCell(values.sample_gap_ms_p95)} | ${markdownCell(values.marker_input_completed)} |`;
    }),
    "",
    "## Privacy boundary",
    "",
    "- This analyzer reads the coordinate-free summary, manifest, and checksums.",
    "- It does not parse the raw SQLite/tar location history.",
    "- The raw bundle remains local and is not uploaded.",
    "- Exact coordinates, map IDs/names, marker text, and map images are not written to this report.",
    "",
  ];
  return lines.join("\n");
}

export async function analyzeFieldTestBundle(
  inputPath = DEFAULT_INPUT,
  { outputDirectory = null, mode = "s0", generatedAt = new Date().toISOString() } = {},
) {
  const bundleDirectory = await resolveBundleDirectory(inputPath);
  const summaryPath = path.join(bundleDirectory, "coordinate-free-diagnostics.txt");
  const manifestPath = path.join(bundleDirectory, "manifest.json");
  const [summaryText, manifestText, checksumResult] = await Promise.all([
    fs.readFile(summaryPath, "utf8"),
    fs.readFile(manifestPath, "utf8"),
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
      finding("FAIL", "exploration_missing", "The coordinate-free summary contains no exploration section."),
    );
  }

  const latestExploration = parsed.explorations.at(-1) ?? null;
  let latestLifecycle = [];
  if (latestExploration !== null) {
    const evaluated = evaluateExploration(latestExploration.values, { mode });
    findings.push(...evaluated.findings);
    latestLifecycle = evaluated.lifecycle;
  }

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
    explorations: parsed.explorations,
    latestExploration,
    latestLifecycle,
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
  if (mode !== "s0" && mode !== "generic") {
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
  if (options.failExit && result.report.status === "FAIL") {
    process.exitCode = 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
