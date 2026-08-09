import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import test from "node:test";

import type {
  RawPositionSample,
} from "../../mapping-core/src/index.ts";
import {
  buildPersonalMapBundle,
  PersonalMapBundleValidationError,
  validatePersonalMapBundle,
  type PersonalMapBundleBuildResult,
  type PersonalMapBundleLogicalArchive,
  type PersonalMapBundleManifest,
  type PersonalMapBundleSha256Port,
  type StoredExploration,
  type StoredPersonalMap,
} from "../src/index.ts";

const HASHER: PersonalMapBundleSha256Port = {
  sha256Utf8(content) {
    return createHash("sha256").update(content, "utf8").digest("hex");
  },
};

function map(): StoredPersonalMap {
  return {
    id: "map-1",
    name: "Private map name",
    createdAtMs: 1_000,
    updatedAtMs: 5_000,
  };
}

function exploration(): StoredExploration {
  return {
    id: "session-1",
    personalMapId: "map-1",
    name: "Private exploration name",
    startedAtMs: 1_000,
    endedAtMs: 5_000,
    trackingProviderId: "gnss-background",
  };
}

function samples(): RawPositionSample[] {
  return [
    {
      id: "sample-1",
      recordedAtMs: 1_100,
      source: "gnss",
      position: {
        kind: "geographic",
        latitude: 35.681,
        longitude: 139.767,
      },
      horizontalAccuracyMeters: 5,
      confidence: 0.9,
    },
    {
      id: "sample-2",
      recordedAtMs: 1_200,
      source: "simulation",
      position: {
        kind: "geographic",
        latitude: Number.NaN,
        longitude: Number.POSITIVE_INFINITY,
      },
      confidence: Number.NaN,
    },
  ];
}

async function build(): Promise<PersonalMapBundleBuildResult> {
  return buildPersonalMapBundle(
    {
      personalMap: map(),
      frameAtExport: {
        kind: "geographic-local",
        originLatitude: 35.681,
        originLongitude: 139.767,
      },
      explorations: [
        {
          record: exploration(),
          rawSamples: samples(),
          markers: [
            {
              id: "marker-1",
              recordedAtMs: 1_300,
              category: "interesting",
              label: "Private marker",
              sourcePosition: {
                kind: "geographic",
                latitude: 35.6811,
                longitude: 139.7671,
              },
            },
          ],
        },
      ],
    },
    { exportedAtMs: 10_000, hasher: HASHER },
  );
}

function archive(
  result: PersonalMapBundleBuildResult,
): PersonalMapBundleLogicalArchive {
  return {
    manifestContent: result.manifestContent,
    files: result.files.map(({ path, content }) => ({ path, content })),
  };
}

function hash(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function replaceFileAndManifest(
  source: PersonalMapBundleLogicalArchive,
  path: string,
  content: string,
): PersonalMapBundleLogicalArchive {
  const manifest = JSON.parse(source.manifestContent) as PersonalMapBundleManifest;
  const files = manifest.files.map((file) =>
    file.path === path
      ? {
          ...file,
          sha256: hash(content),
          byteLength: Buffer.byteLength(content, "utf8"),
        }
      : file,
  );
  return {
    manifestContent: `${JSON.stringify({ ...manifest, files }, null, 2)}\n`,
    files: source.files.map((file) =>
      file.path === path ? { path, content } : file,
    ),
  };
}

function expectCode(
  operation: Promise<unknown>,
  code: PersonalMapBundleValidationError["code"],
): Promise<void> {
  return assert.rejects(operation, (error: unknown) => {
    assert.ok(error instanceof PersonalMapBundleValidationError);
    assert.equal(error.code, code);
    return true;
  });
}

test("a freshly built logical bundle validates before any import transaction", async () => {
  const built = await build();
  const result = await validatePersonalMapBundle(archive(built), HASHER);

  assert.equal(result.personalMapId, "map-1");
  assert.equal(result.explorationCount, 1);
  assert.equal(result.rawSampleCount, 2);
  assert.equal(result.markerCount, 1);
  assert.equal(result.fileCount, 4);
  assert.equal(result.manifest.containsDerivedMap, false);
  assert.equal(result.manifest.containsGameState, false);
});

test("content tampering is rejected by SHA-256 before import", async () => {
  const built = await build();
  const original = archive(built);
  const tampered: PersonalMapBundleLogicalArchive = {
    ...original,
    files: original.files.map((file) =>
      file.path === "observations/0001.ndjson"
        ? { ...file, content: `${file.content}{"id":"injected"}\n` }
        : file,
    ),
  };

  await expectCode(
    validatePersonalMapBundle(tampered, HASHER),
    "checksum-mismatch",
  );
});

test("missing and unlisted files fail closed", async () => {
  const built = await build();
  const original = archive(built);

  await expectCode(
    validatePersonalMapBundle(
      {
        ...original,
        files: original.files.filter(
          (file) => file.path !== "markers/0001.json",
        ),
      },
      HASHER,
    ),
    "missing-file",
  );

  await expectCode(
    validatePersonalMapBundle(
      {
        ...original,
        files: [
          ...original.files,
          { path: "unexpected.json", content: "{}\n" },
        ],
      },
      HASHER,
    ),
    "unexpected-file",
  );
});

test("path traversal and duplicate archive paths are rejected", async () => {
  const built = await build();
  const original = archive(built);
  const manifest = JSON.parse(
    original.manifestContent,
  ) as PersonalMapBundleManifest;
  const unsafeManifest: PersonalMapBundleManifest = {
    ...manifest,
    files: manifest.files.map((file, index) =>
      index === 0 ? { ...file, path: "../private.json" } : file,
    ),
  };

  await expectCode(
    validatePersonalMapBundle(
      {
        manifestContent: `${JSON.stringify(unsafeManifest, null, 2)}\n`,
        files: original.files,
      },
      HASHER,
    ),
    "unsafe-path",
  );

  await expectCode(
    validatePersonalMapBundle(
      {
        ...original,
        files: [...original.files, original.files[0]!],
      },
      HASHER,
    ),
    "duplicate-path",
  );
});

test("unsupported versions and privacy/profile drift are rejected", async () => {
  const built = await build();
  const original = archive(built);
  const manifest = JSON.parse(
    original.manifestContent,
  ) as PersonalMapBundleManifest;

  await expectCode(
    validatePersonalMapBundle(
      {
        ...original,
        manifestContent: `${JSON.stringify({ ...manifest, schemaVersion: 2 }, null, 2)}\n`,
      },
      HASHER,
    ),
    "unsupported-schema-version",
  );

  await expectCode(
    validatePersonalMapBundle(
      {
        ...original,
        manifestContent: `${JSON.stringify({ ...manifest, containsGameState: true }, null, 2)}\n`,
      },
      HASHER,
    ),
    "privacy-boundary-invalid",
  );
});

test("inventory count drift is rejected even when hashes remain valid", async () => {
  const built = await build();
  const original = archive(built);
  const manifest = JSON.parse(
    original.manifestContent,
  ) as PersonalMapBundleManifest;
  const changed: PersonalMapBundleManifest = {
    ...manifest,
    explorations: manifest.explorations.map((item) => ({
      ...item,
      rawSampleCount: item.rawSampleCount + 1,
    })),
  };

  await expectCode(
    validatePersonalMapBundle(
      {
        ...original,
        manifestContent: `${JSON.stringify(changed, null, 2)}\n`,
      },
      HASHER,
    ),
    "count-mismatch",
  );
});

test("invalid NDJSON is rejected after its updated checksum is verified", async () => {
  const built = await build();
  const original = archive(built);
  const modified = replaceFileAndManifest(
    original,
    "observations/0001.ndjson",
    "{not-json}\n",
  );

  await expectCode(
    validatePersonalMapBundle(modified, HASHER),
    "invalid-ndjson-file",
  );
});

test("exploration record identity cannot be swapped behind a valid hash", async () => {
  const built = await build();
  const original = archive(built);
  const record = JSON.parse(
    original.files.find((file) => file.path === "explorations/0001.json")!
      .content,
  ) as Record<string, unknown>;
  const modified = replaceFileAndManifest(
    original,
    "explorations/0001.json",
    `${JSON.stringify({ ...record, id: "different-session" }, null, 2)}\n`,
  );

  await expectCode(
    validatePersonalMapBundle(modified, HASHER),
    "invalid-inventory",
  );
});

test("invalid hasher output is rejected rather than trusted", async () => {
  const built = await build();
  await expectCode(
    validatePersonalMapBundle(archive(built), {
      sha256Utf8: () => "not-a-sha256",
    }),
    "invalid-sha256",
  );
});
