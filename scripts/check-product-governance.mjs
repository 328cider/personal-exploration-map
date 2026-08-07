import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const failures = [];

const requiredFragments = new Map([
  [
    "PRODUCT_CONSTITUTION.md",
    [
      "## Product purpose",
      "## Durable product invariants",
      "## Required review for every product or architecture change",
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
