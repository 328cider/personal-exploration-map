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
    failures.push(`Missing renderer file: ${relativePath}`);
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
    } else if (/\.(?:ts|tsx|js|mjs)$/u.test(name)) {
      files.push(relative(root, absolutePath).replaceAll("\\", "/"));
    }
  }
  return files;
}

const requiredAnchors = new Map([
  [
    "apps/mobile/src/components/TrackCanvas.tsx",
    [
      "react-native-svg",
      "buildTrackCanvasGeometry",
      "geometry.strokes",
      "geometry.endpoints",
      "geometry.markers",
    ],
  ],
  [
    "apps/mobile/src/rendering/trackGeometry.ts",
    [
      "Every ExplorationSession remains an independent source segment",
      "explorationId",
      "confidenceBand",
      "pathData",
    ],
  ],
  [
    "apps/mobile/test/trackGeometry.test.ts",
    [
      "two exploration sessions remain separate SVG stroke sources",
      "confidence changes split one session",
    ],
  ],
  [
    "apps/mobile/scripts/benchmark-renderer.ts",
    ["m0-small", "m1-growing", "stress", "10_000"],
  ],
]);

for (const [file, anchors] of requiredAnchors) {
  if (!requireFile(file)) {
    continue;
  }
  const content = read(file);
  for (const anchor of anchors) {
    if (!content.includes(anchor)) {
      failures.push(`Missing renderer anchor in ${file}: ${anchor}`);
    }
  }
}

if (requireFile("apps/mobile/package.json")) {
  const mobilePackage = JSON.parse(read("apps/mobile/package.json"));
  const version = mobilePackage.dependencies?.["react-native-svg"];
  if (version !== "15.15.4") {
    failures.push(
      `apps/mobile must pin react-native-svg 15.15.4; found ${String(version)}.`,
    );
  }
}

const pureGeometry = requireFile(
  "apps/mobile/src/rendering/trackGeometry.ts",
)
  ? read("apps/mobile/src/rendering/trackGeometry.ts")
  : "";
for (const forbidden of [
  "react-native-svg",
  'from "react-native"',
  "from 'react-native'",
  'from "expo',
  "from 'expo",
]) {
  if (pureGeometry.includes(forbidden)) {
    failures.push(
      `Pure renderer geometry must not depend on platform rendering APIs: ${forbidden}`,
    );
  }
}

for (const directory of [
  "packages/mapping-core",
  "packages/mapping-engine",
  "packages/experience-sdk",
  "packages/sqlite-adapter",
]) {
  for (const file of collectSourceFiles(directory)) {
    if (read(file).includes("react-native-svg")) {
      failures.push(
        `react-native-svg leaked outside the mobile renderer boundary: ${file}`,
      );
    }
  }
}

const trackCanvas = requireFile(
  "apps/mobile/src/components/TrackCanvas.tsx",
)
  ? read("apps/mobile/src/components/TrackCanvas.tsx")
  : "";
for (const forbiddenMutation of [
  "appendPositionSample",
  "createExplorationSession",
  "endExploration",
  "addMarker(",
  "ingestPositionSamples",
]) {
  if (trackCanvas.includes(forbiddenMutation)) {
    failures.push(
      `Renderer must remain read-only and cannot call canonical mutation: ${forbiddenMutation}`,
    );
  }
}

if (failures.length > 0) {
  console.error("Renderer boundary checks failed:\n");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exitCode = 1;
} else {
  console.log("Renderer boundary checks passed.");
}
