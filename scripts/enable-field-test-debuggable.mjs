import { readFile, writeFile } from "node:fs/promises";

if (process.env.APP_VARIANT !== "field-test") {
  throw new Error(
    "Refusing to enable debuggable release outside APP_VARIANT=field-test.",
  );
}

const path = "apps/mobile/android/app/build.gradle";
const source = await readFile(path, "utf8");
if (source.includes("// FIELD_TEST_DEBUGGABLE")) {
  console.log("Field-test release is already marked debuggable.");
  process.exit(0);
}

const releaseBlock = /(\brelease\s*\{\s*\r?\n)/u;
const matches = [...source.matchAll(new RegExp(releaseBlock.source, "gu"))];
if (matches.length !== 1) {
  throw new Error(
    `${path}: expected one release build-type block, found ${matches.length}.`,
  );
}

const updated = source.replace(
  releaseBlock,
  "$1            // FIELD_TEST_DEBUGGABLE: USB-only local diagnostics via adb run-as.\n            debuggable true\n",
);
await writeFile(path, updated, "utf8");
console.log("Enabled debuggable=true for the isolated Field-test release variant.");
