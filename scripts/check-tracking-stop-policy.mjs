import { readFile } from "node:fs/promises";

const source = await readFile(
  "apps/mobile/src/tracking/locationRecorder.ts",
  "utf8",
);

const requiredFragments = [
  "async function releaseContextAfterStopFailure",
  "canonicalCompletionContinues: true",
  '"background",\n          error,',
  '"foreground",\n          error,',
];

for (const fragment of requiredFragments) {
  if (!source.includes(fragment)) {
    throw new Error(
      `Tracking stop policy drifted; missing required fragment: ${fragment}`,
    );
  }
}

const stopBlocks = [...source.matchAll(/async stop\(explorationId\) \{([\s\S]*?)\n    \},/gu)].map(
  (match) => match[1] ?? "",
);

if (stopBlocks.length !== 2) {
  throw new Error(
    `Expected exactly two GNSS stop implementations, found ${stopBlocks.length}.`,
  );
}

for (const [index, block] of stopBlocks.entries()) {
  if (block.includes("throw error")) {
    throw new Error(
      `GNSS stop implementation ${index + 1} blocks canonical completion by rethrowing an operational stop failure.`,
    );
  }
  if (!block.includes("releaseContextAfterStopFailure")) {
    throw new Error(
      `GNSS stop implementation ${index + 1} no longer records and releases a failed stop safely.`,
    );
  }
}

console.log("Tracking provider stop policy checks passed.");
