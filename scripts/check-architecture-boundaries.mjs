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
    failures.push(`Missing architecture file: ${relativePath}`);
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

const requiredFiles = [
  "docs/FEATURE_PLACEMENT.md",
  "docs/adr/0006-headless-mapping-engine-and-experience-boundary.md",
  "packages/mapping-engine/package.json",
  "packages/mapping-engine/src/index.ts",
  "packages/experience-sdk/package.json",
  "packages/experience-sdk/src/index.ts",
  "packages/sqlite-adapter/package.json",
  "packages/sqlite-adapter/src/index.ts",
];
for (const file of requiredFiles) {
  requireFile(file);
}

const requiredAnchors = new Map([
  [
    "docs/FEATURE_PLACEMENT.md",
    [
      "地図の事実",
      "mapping-engine",
      "adapter",
      "renderer",
      "experience/game",
      "decision tree",
      "再利用されそう",
    ],
  ],
  [
    "docs/ARCHITECTURE.md",
    [
      "Headless mapping engine",
      "Package responsibilities",
      "Game-initiated corrections",
      "apps/game-*",
    ],
  ],
  [
    "AGENTS.md",
    [
      "docs/FEATURE_PLACEMENT.md",
      "## Layer ownership",
      "地図への唯一の書き込み窓口",
      "apps/game-*",
    ],
  ],
]);

for (const [file, anchors] of requiredAnchors) {
  if (!requireFile(file)) {
    continue;
  }
  const content = read(file);
  for (const anchor of anchors) {
    if (!content.includes(anchor)) {
      failures.push(`Missing architecture anchor in ${file}: ${anchor}`);
    }
  }
}

const mappingCoreExtensions = "packages/mapping-core/src/extensions.ts";
if (existsSync(resolve(root, mappingCoreExtensions))) {
  failures.push(
    `${mappingCoreExtensions} must not own game or overlay contracts; use experience-sdk.`,
  );
}

for (const file of collectSourceFiles("packages/mapping-core/src")) {
  const content = read(file);
  const forbiddenImports = [
    /from\s+["']react["']/u,
    /from\s+["']react-native["']/u,
    /from\s+["']expo(?:-[^"']+)?["']/u,
    /from\s+["']expo\//u,
    /from\s+["']@exploration-map\/mapping-engine["']/u,
    /from\s+["']@exploration-map\/experience-sdk["']/u,
    /from\s+["']@exploration-map\/sqlite-adapter["']/u,
  ];
  for (const pattern of forbiddenImports) {
    if (pattern.test(content)) {
      failures.push(`Forbidden outer-layer import in ${file}: ${pattern}`);
    }
  }
  for (const token of [
    "MappingExperience",
    "ExperienceCue",
    "DerivedOverlay",
  ]) {
    if (content.includes(token)) {
      failures.push(`Experience-layer symbol leaked into mapping-core: ${file}: ${token}`);
    }
  }
}

function readPackage(relativePath) {
  if (!requireFile(relativePath)) {
    return null;
  }
  try {
    return JSON.parse(read(relativePath));
  } catch (error) {
    failures.push(`Invalid package JSON at ${relativePath}: ${String(error)}`);
    return null;
  }
}

const corePackage = readPackage("packages/mapping-core/package.json");
if (corePackage !== null) {
  const dependencyNames = Object.keys(corePackage.dependencies ?? {});
  if (dependencyNames.length > 0) {
    failures.push(
      `mapping-core must remain dependency-free; found: ${dependencyNames.join(", ")}`,
    );
  }
}

for (const packagePath of [
  "packages/mapping-engine/package.json",
  "packages/experience-sdk/package.json",
]) {
  const packageJson = readPackage(packagePath);
  if (packageJson === null) {
    continue;
  }
  const dependencies = Object.keys(packageJson.dependencies ?? {});
  const forbidden = dependencies.filter(
    (name) => name !== "@exploration-map/mapping-core",
  );
  if (forbidden.length > 0) {
    failures.push(
      `${packagePath} contains non-domain dependencies: ${forbidden.join(", ")}`,
    );
  }
}

const sqlitePackage = readPackage("packages/sqlite-adapter/package.json");
if (sqlitePackage !== null) {
  const allowedDependencies = new Set([
    "@exploration-map/mapping-core",
    "@exploration-map/mapping-engine",
  ]);
  const forbidden = Object.keys(sqlitePackage.dependencies ?? {}).filter(
    (name) => !allowedDependencies.has(name),
  );
  if (forbidden.length > 0) {
    failures.push(
      `packages/sqlite-adapter/package.json contains non-domain dependencies: ${forbidden.join(", ")}`,
    );
  }
}

for (const file of collectSourceFiles("packages/sqlite-adapter/src")) {
  const content = read(file);
  for (const pattern of [
    /from\s+["']react["']/u,
    /from\s+["']react-native["']/u,
    /from\s+["']expo(?:-[^"']+)?["']/u,
    /from\s+["']expo\//u,
    /from\s+["']@exploration-map\/experience-sdk["']/u,
  ]) {
    if (pattern.test(content)) {
      failures.push(`Forbidden platform or game import in ${file}: ${pattern}`);
    }
  }
}

for (const file of collectSourceFiles("packages/experience-sdk/src")) {
  const content = read(file);
  const withoutTypeImports = content.replace(
    /import\s+type[\s\S]*?from\s+["'][^"']+["'];?/gu,
    "",
  );
  if (withoutTypeImports.includes("@exploration-map/mapping-core")) {
    failures.push(
      `experience-sdk may import mapping-core only as types: ${file}`,
    );
  }
}

const appsDirectory = resolve(root, "apps");
if (existsSync(appsDirectory)) {
  for (const entry of readdirSync(appsDirectory)) {
    if (!entry.startsWith("game-")) {
      continue;
    }
    for (const file of collectSourceFiles(`apps/${entry}`)) {
      const content = read(file);
      if (
        content.includes("@exploration-map/mapping-core") ||
        content.includes("packages/mapping-core")
      ) {
        failures.push(
          `Game app must use mapping-engine and experience-sdk, not mapping-core directly: ${file}`,
        );
      }
    }
  }
}

if (failures.length > 0) {
  console.error("Architecture boundary checks failed:\n");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exitCode = 1;
} else {
  console.log("Architecture boundary checks passed.");
}
