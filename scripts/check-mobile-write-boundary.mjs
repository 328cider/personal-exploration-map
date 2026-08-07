import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { join, relative, resolve } from "node:path";

const root = process.cwd();
const failures = [];

function read(relativePath) {
  return readFileSync(resolve(root, relativePath), "utf8");
}

function requireFile(relativePath) {
  if (!existsSync(resolve(root, relativePath))) {
    failures.push(`Missing mobile boundary file: ${relativePath}`);
    return false;
  }
  return true;
}

function collectSourceFiles(directory) {
  const absoluteDirectory = resolve(root, directory);
  if (!existsSync(absoluteDirectory)) {
    return [];
  }
  const files = [];
  for (const name of readdirSync(absoluteDirectory)) {
    const absolutePath = join(absoluteDirectory, name);
    const stats = statSync(absolutePath);
    if (stats.isDirectory()) {
      files.push(...collectSourceFiles(relative(root, absolutePath)));
    } else if (/\.(?:ts|tsx)$/u.test(name)) {
      files.push(relative(root, absolutePath).replaceAll("\\", "/"));
    }
  }
  return files;
}

const requiredAnchors = new Map([
  [
    "apps/mobile/App.tsx",
    [
      "startNewPersonalMapExploration",
      "addConfirmedMarker",
      "endActiveExploration",
      "createDemoPersonalMap",
      "AppState.addEventListener",
      "app.session.recovered",
      "loadPersonalMapTrackingDiagnostics",
    ],
  ],
  [
    "apps/mobile/src/mapping/mobileMappingRuntime.ts",
    [
      "createMappingEngine",
      "sqliteMappingRepository",
      "createPersonalMapWithFirstExploration",
      "ingestPositionSamples",
      "startExploration",
      "addMarker",
      "endExploration",
      "callback.received",
      "callback.persisted",
      "callback.failed",
      "recordMarkerInputTiming",
    ],
  ],
  [
    "apps/mobile/src/diagnostics/trackingDiagnostics.ts",
    [
      "createSqliteTrackingDiagnosticsStore",
      "recordTrackingDiagnosticBestEffort",
      "createExplorationTrackingDiagnostics",
    ],
  ],
  [
    "apps/mobile/src/components/TrackingDiagnosticsPanel.tsx",
    ["受動記録の計測", "sample gap", "callback batches"],
  ],
  [
    "apps/mobile/src/tracking/backgroundLocationTask.ts",
    [
      "ingestActiveLocationBatch",
      "recordBackgroundTaskError",
      '"background"',
    ],
  ],
  [
    "apps/mobile/src/tracking/locationRecorder.ts",
    [
      "TrackingProviderPort",
      "setActiveTrackingContext",
      "provider.start.requested",
      "provider.started",
      "provider.stop.requested",
      "provider.stopped",
    ],
  ],
  [
    "apps/mobile/src/storage/explorationRepository.ts",
    ["getExplorationSummary", "getLiveExplorationStats", "loadExplorationMap"],
  ],
]);

for (const [file, anchors] of requiredAnchors) {
  if (!requireFile(file)) {
    continue;
  }
  const content = read(file);
  for (const anchor of anchors) {
    if (!content.includes(anchor)) {
      failures.push(`Missing mobile write-boundary anchor in ${file}: ${anchor}`);
    }
  }
}

const app = requireFile("apps/mobile/App.tsx")
  ? read("apps/mobile/App.tsx")
  : "";
for (const forbidden of [
  "createExploration(",
  "appendLocationBatch(",
  "addMarkerToExploration(",
  "completeExploration(",
  "createDemoExploration(",
]) {
  if (app.includes(forbidden)) {
    failures.push(`App.tsx still uses legacy canonical write: ${forbidden}`);
  }
}

const mobileRuntime = requireFile(
  "apps/mobile/src/mapping/mobileMappingRuntime.ts",
)
  ? read("apps/mobile/src/mapping/mobileMappingRuntime.ts")
  : "";
if (
  /startNewPersonalMapExploration[\s\S]*?createPersonalMap\s*\(/u.test(
    mobileRuntime,
  )
) {
  failures.push(
    "New-map flow must use createPersonalMapWithFirstExploration rather than separate create/start commands.",
  );
}

const backgroundTask = requireFile(
  "apps/mobile/src/tracking/backgroundLocationTask.ts",
)
  ? read("apps/mobile/src/tracking/backgroundLocationTask.ts")
  : "";
if (backgroundTask.includes("explorationRepository")) {
  failures.push(
    "Background location task must ingest through mobileMappingRuntime, not explorationRepository.",
  );
}

const readRepository = requireFile(
  "apps/mobile/src/storage/explorationRepository.ts",
)
  ? read("apps/mobile/src/storage/explorationRepository.ts")
  : "";
for (const token of [".runAsync(", ".execAsync(", "withExclusiveTransactionAsync"]) {
  if (readRepository.includes(token)) {
    failures.push(
      `Read-only explorationRepository contains a write-capable SQLite call: ${token}`,
    );
  }
}

const canonicalSqlPatterns = [
  /INSERT\s+(?:OR\s+IGNORE\s+)?INTO\s+personal_maps/iu,
  /INSERT\s+(?:OR\s+IGNORE\s+)?INTO\s+explorations/iu,
  /INSERT\s+(?:OR\s+IGNORE\s+)?INTO\s+position_samples/iu,
  /INSERT\s+(?:OR\s+IGNORE\s+)?INTO\s+markers/iu,
  /UPDATE\s+explorations\s+SET\s+status/iu,
];
for (const file of collectSourceFiles("apps/mobile/src")) {
  const content = read(file);
  for (const pattern of canonicalSqlPatterns) {
    if (pattern.test(content)) {
      failures.push(
        `Mobile app source writes canonical mapping tables directly: ${file}: ${pattern}`,
      );
    }
  }
}

const diagnosticsSource = requireFile(
  "apps/mobile/src/diagnostics/trackingDiagnostics.ts",
)
  ? read("apps/mobile/src/diagnostics/trackingDiagnostics.ts")
  : "";
for (const forbidden of [
  "appendPositionSample",
  "createExplorationSession",
  "createPersonalMapSnapshot",
  "endExploration",
]) {
  if (diagnosticsSource.includes(forbidden)) {
    failures.push(
      `Operational diagnostics must not own canonical mapping mutation: ${forbidden}`,
    );
  }
}

if (failures.length > 0) {
  console.error("Mobile canonical write-boundary checks failed:\n");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exitCode = 1;
} else {
  console.log("Mobile canonical write-boundary checks passed.");
}
