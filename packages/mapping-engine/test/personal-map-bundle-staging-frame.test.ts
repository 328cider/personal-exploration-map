import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  buildPersonalMapBundle,
  stagePersonalMapBundleImport,
  type PersonalMapBundleSha256Port,
} from "../src/index.ts";

const HASHER: PersonalMapBundleSha256Port = {
  sha256Utf8(content) {
    return createHash("sha256").update(content, "utf8").digest("hex");
  },
};

async function stage(frameAtExport: Parameters<typeof buildPersonalMapBundle>[0]["frameAtExport"]) {
  const built = await buildPersonalMapBundle(
    {
      personalMap: {
        id: `map-${frameAtExport.kind}`,
        name: "Private map",
        createdAtMs: 1_000,
        updatedAtMs: 2_000,
      },
      frameAtExport,
      explorations: [],
    },
    { exportedAtMs: 3_000, hasher: HASHER },
  );
  return stagePersonalMapBundleImport(
    {
      manifestContent: built.manifestContent,
      files: built.files.map(({ path, content }) => ({ path, content })),
    },
    HASHER,
  );
}

test("local frame label is preserved without geographic promotion", async () => {
  const staged = await stage({ kind: "local", label: "building-a" });
  assert.deepEqual(staged.frameAtExport, {
    kind: "local",
    label: "building-a",
  });
});

test("unresolved frame remains unresolved", async () => {
  const staged = await stage({ kind: "unresolved" });
  assert.deepEqual(staged.frameAtExport, { kind: "unresolved" });
});
