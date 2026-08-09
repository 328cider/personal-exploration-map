import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  buildPersonalMapBundle,
  PersonalMapBundleValidationError,
  validatePersonalMapBundle,
  type PersonalMapBundleSha256Port,
} from "../src/index.ts";

const HASHER: PersonalMapBundleSha256Port = {
  sha256Utf8(content) {
    return createHash("sha256").update(content, "utf8").digest("hex");
  },
};

test("manifest.json is supplied separately and cannot masquerade as a content file", async () => {
  const built = await buildPersonalMapBundle(
    {
      personalMap: {
        id: "map-empty",
        name: "Empty map",
        createdAtMs: 1_000,
        updatedAtMs: 1_000,
      },
      frameAtExport: { kind: "unresolved" },
      explorations: [],
    },
    { exportedAtMs: 2_000, hasher: HASHER },
  );

  await assert.rejects(
    validatePersonalMapBundle(
      {
        manifestContent: built.manifestContent,
        files: [
          ...built.files.map(({ path, content }) => ({ path, content })),
          { path: "manifest.json", content: built.manifestContent },
        ],
      },
      HASHER,
    ),
    (error: unknown) => {
      assert.ok(error instanceof PersonalMapBundleValidationError);
      assert.equal(error.code, "unexpected-file");
      assert.equal(error.path, "manifest.json");
      return true;
    },
  );
});
