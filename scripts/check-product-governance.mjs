import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const failures = [];

const requiredFragments = new Map([
  [
    "PRODUCT_CONSTITUTION.md",
    [
      "## Product purpose",
      "## Durable product invariants",
      "Canonical map writes are controlled",
      "明示的に制御されたapplication boundary",
      "## Required review for every product or architecture change",
      "Map-write authority",
      "## Constitution change protocol",
      "Build / Adopt / Benchmark",
    ],
  ],
  [
    "AGENTS.md",
    [
      "## Required reading order",
      "PRODUCT_CONSTITUTION.md",
      "## Before implementation",
      "canonical mapを書き換える主体",
      "## Constitution changes",
      "node scripts/check-product-governance.mjs",
    ],
  ],
  [
    "CURRENT_DIRECTION.md",
    ["PRODUCT_CONSTITUTION.md", "短期的な開発方針"],
  ],
  [
    ".github/pull_request_template.md",
    [
      "## Product-constitution review",
      "### Passive-first UX",
      "### Map truth",
      "### Map-write authority",
      "### Build / Adopt / Benchmark",
      "### Replaceable game layer",
      "### Privacy and safety",
      "## Constitution change",
    ],
  ],
  [
    ".github/ISSUE_TEMPLATE/feature.yml",
    [
      "Constitution alignment",
      "Passive-first UX check",
      "Map-truth details and uncertainty",
      "Canonical map-write authority",
      "OSS / standard reuse",
      "Replaceable game-layer check",
      "Privacy and safety",
      "Validation and stop criteria",
    ],
  ],
]);

for (const [relativePath, fragments] of requiredFragments) {
  const absolutePath = resolve(root, relativePath);
  if (!existsSync(absolutePath)) {
    failures.push(`Missing governance file: ${relativePath}`);
    continue;
  }

  const content = readFileSync(absolutePath, "utf8");
  for (const fragment of fragments) {
    if (!content.includes(fragment)) {
      failures.push(`Missing required governance anchor in ${relativePath}: ${fragment}`);
    }
  }
}

const adrDirectory = resolve(root, "docs/adr");
if (!existsSync(adrDirectory)) {
  failures.push("Missing ADR directory: docs/adr");
} else {
  const numbers = new Map();
  for (const file of readdirSync(adrDirectory).filter((name) =>
    /^\d{4}-.+\.md$/u.test(name),
  )) {
    const filenameNumber = file.slice(0, 4);
    const existing = numbers.get(filenameNumber) ?? [];
    existing.push(file);
    numbers.set(filenameNumber, existing);

    const content = readFileSync(resolve(adrDirectory, file), "utf8");
    const headingMatch = content.match(/^# ADR (\d{4}):/u);
    if (headingMatch === null) {
      failures.push(`ADR is missing a numbered H1 heading: docs/adr/${file}`);
    } else if (headingMatch[1] !== filenameNumber) {
      failures.push(
        `ADR filename and heading numbers differ: docs/adr/${file} uses ADR ${headingMatch[1]}.`,
      );
    }
  }

  for (const [number, files] of numbers) {
    if (files.length > 1) {
      failures.push(
        `Duplicate ADR number ${number}: ${files.map((file) => `docs/adr/${file}`).join(", ")}`,
      );
    }
  }
}

const changedFiles = (process.env.GOVERNANCE_CHANGED_FILES ?? "")
  .split(/\r?\n/u)
  .map((file) => file.trim())
  .filter(Boolean);

if (changedFiles.includes("PRODUCT_CONSTITUTION.md")) {
  const hasNewAdr = changedFiles.some((file) =>
    /^docs\/adr\/\d{4}-.+\.md$/u.test(file),
  );
  if (!hasNewAdr) {
    failures.push(
      "PRODUCT_CONSTITUTION.md changed without a new numbered ADR under docs/adr/.",
    );
  }
}

if (failures.length > 0) {
  console.error("Product governance checks failed:\n");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exitCode = 1;
} else {
  console.log("Product governance checks passed.");
}
