import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "..");
const workflowsDir = path.join(root, ".github", "workflows");

const failures = [];

function requireText(file, text, label = text) {
  const content = fs.readFileSync(path.join(root, file), "utf8");
  if (!content.includes(text)) {
    failures.push(`${file}: missing ${label}`);
  }
  return content;
}

const prWorkflows = [
  "core.yml",
  "mobile-static.yml",
  "product-governance.yml",
  "simplify-benchmark.yml",
  "explored-space-fixtures.yml",
  "devex-field-test.yml",
  "emulator-harness-only.yml",
];

for (const name of prWorkflows) {
  const file = path.join(".github", "workflows", name);
  const content = requireText(file, "pull_request:");
  if (!content.includes("github.event.pull_request.draft == false")) {
    failures.push(`${file}: pull-request jobs must skip while Draft`);
  }
  if (!content.includes("cancel-in-progress: true")) {
    failures.push(`${file}: superseded runs must cancel`);
  }
}

const devex = fs.readFileSync(path.join(workflowsDir, "devex-field-test.yml"), "utf8");
for (const output of ["docker_required", "apk_required", "emulator_required"]) {
  if (!devex.includes(`${output}:`)) {
    failures.push(`devex-field-test.yml: missing classifier output ${output}`);
  }
  if (!devex.includes(`needs.classify.outputs.${output} == 'true'`)) {
    failures.push(`devex-field-test.yml: heavy lane is not gated by ${output}`);
  }
}
for (const required of [
  "github.event_name == 'schedule'",
  "-PreactNativeArchitectures=arm64-v8a,x86_64",
  "needs.field-test-apk.result == 'success'",
]) {
  if (!devex.includes(required)) {
    failures.push(`devex-field-test.yml: missing ${required}`);
  }
}
if (devex.includes("arm64-v8a,armeabi-v7a,x86,x86_64")) {
  failures.push("devex-field-test.yml: four-ABI Android compilation is forbidden");
}

const governance = fs.readFileSync(
  path.join(workflowsDir, "product-governance.yml"),
  "utf8",
);
for (const required of [
  '      - ".github/workflows/**"',
  "node scripts/check-ci-budget-policy.mjs",
]) {
  if (!governance.includes(required)) {
    failures.push(`product-governance.yml: missing ${required}`);
  }
}

const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
if (packageJson.scripts?.["check:ci-budget"] !== "node scripts/check-ci-budget-policy.mjs") {
  failures.push("package.json: check:ci-budget must own the CI policy script");
}
if (!packageJson.scripts?.check?.includes("check:ci-budget")) {
  failures.push("package.json: npm run check must include check:ci-budget");
}

const agents = fs.readFileSync(path.join(root, "AGENTS.md"), "utf8");
const policy = fs.readFileSync(path.join(root, "docs", "CI_BUDGET_POLICY.md"), "utf8");
for (const required of [
  "docs/CI_BUDGET_POLICY.md",
  "実装・レビュー修正・format・ローカル検証中はPRをDraftに保つ",
  "CIを起動するためだけのpush",
]) {
  if (!agents.includes(required)) {
    failures.push(`AGENTS.md: missing ${required}`);
  }
}
for (const required of ["Codex, ChatGPT", "Do not request an unchanged rerun"]) {
  if (!policy.includes(required)) {
    failures.push(`docs/CI_BUDGET_POLICY.md: missing ${required}`);
  }
}

if (failures.length > 0) {
  console.error("CI budget policy checks failed:\n");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("CI budget policy checks passed.");
