import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import test from "node:test";

import type {
  MapMarker,
  RawPositionSample,
} from "../../mapping-core/src/index.ts";
import {
  buildPersonalMapBundle,
  PersonalMapBundleStagingError,
  stagePersonalMapBundleImport,
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
    name: "Private map",
    createdAtMs: 1_000,
    updatedAtMs: 5_000,
  };
}

function exploration(id: string, startedAtMs: number): StoredExploration {
  return {
    id,
    personalMapId: "map-1",
    name: `Exploration ${id}`,
    startedAtMs,
    endedAtMs: startedAtMs + 2_000,
    trackingProviderId: "gnss-background",
  };
}

function rawSamples(): RawPositionSample[] {
  return [
    {
      id: "sample-valid",
      recordedAtMs: 1_100,
      source: "gnss",
      position: {
        kind: "geographic",
        latitude: 35.681,
        longitude: 139.767,
        altitudeMeters: -0,
      },
      horizontalAccuracyMeters: 5,
      headingDegrees: 90,
      speedMetersPerSecond: 1.2,
      confidence: 0.9,
    },
    {
      id: "sample-rejected-evidence",
      recordedAtMs: Number.NaN,
      source: "simulation",
      position: {
        kind: "geographic",
        latitude: Number.NaN,
        longitude: Number.POSITIVE_INFINITY,
      },
      horizontalAccuracyMeters: Number.NEGATIVE_INFINITY,
      confidence: Number.NaN,
    },
  ];
}

function marker(): MapMarker {
  return {
    id: "marker-1",
    recordedAtMs: 1_500,
    category: "entrance",
    label: "Private entrance",
    note: "Private note",
    xMeters: -0,
    yMeters: 2.5,
    sourcePosition: {
      kind: "geographic",
      latitude: 35.6811,
      longitude: 139.7671,
    },
  };
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
          record: exploration("later", 3_000),
          rawSamples: [],
          markers: [],
        },
        {
          record: exploration("first", 1_000),
          rawSamples: rawSamples(),
          markers: [marker()],
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

function replaceFileAndManifest(
  source: PersonalMapBundleLogicalArchive,
  filePath: string,
  content: string,
): PersonalMapBundleLogicalArchive {
  const manifest = JSON.parse(source.manifestContent) as PersonalMapBundleManifest;
  const hash = createHash("sha256").update(content, "utf8").digest("hex");
  return {
    manifestContent: `${JSON.stringify(
      {
        ...manifest,
        files: manifest.files.map((file) =>
          file.path === filePath
            ? {
                ...file,
                sha256: hash,
                byteLength: Buffer.byteLength(content, "utf8"),
              }
            : file,
        ),
      },
      null,
      2,
    )}\n`,
    files: source.files.map((file) =>
      file.path === filePath ? { path: filePath, content } : file,
    ),
  };
}

function updateExplorationCount(
  source: PersonalMapBundleLogicalArchive,
  explorationId: string,
  field: "rawSampleCount" | "markerCount",
  count: number,
): PersonalMapBundleLogicalArchive {
  const manifest = JSON.parse(source.manifestContent) as PersonalMapBundleManifest;
  return {
    ...source,
    manifestContent: `${JSON.stringify(
      {
        ...manifest,
        explorations: manifest.explorations.map((item) =>
          item.id === explorationId ? { ...item, [field]: count } : item,
        ),
      },
      null,
      2,
    )}\n`,
  };
}

function expectStagingCode(
  operation: Promise<unknown>,
  code: PersonalMapBundleStagingError["code"],
): Promise<void> {
  return assert.rejects(operation, (error: unknown) => {
    assert.ok(error instanceof PersonalMapBundleStagingError);
    assert.equal(error.code, code);
    return true;
  });
}

test("builder output stages exact records without repository writes", async () => {
  const staged = await stagePersonalMapBundleImport(
    archive(await build()),
    HASHER,
  );

  assert.deepEqual(staged.personalMap, map());
  assert.deepEqual(staged.frameAtExport, {
    kind: "geographic-local",
    originLatitude: 35.681,
    originLongitude: 139.767,
  });
  assert.deepEqual(
    staged.explorations.map((item) => item.record.id),
    ["first", "later"],
  );
  assert.equal(staged.explorations[0]?.record.trackingProviderId, "gnss-background");
  assert.equal(staged.explorations[0]?.rawSamples.length, 2);
  assert.equal(staged.explorations[0]?.markers.length, 1);
  assert.equal(staged.validation.rawSampleCount, 2);
  assert.equal(staged.validation.markerCount, 1);
});

test("raw rejected evidence restores NaN, infinities, and negative zero exactly", async () => {
  const staged = await stagePersonalMapBundleImport(
    archive(await build()),
    HASHER,
  );
  const valid = staged.explorations[0]!.rawSamples[0]!;
  const invalid = staged.explorations[0]!.rawSamples[1]!;

  assert.equal(valid.position.kind, "geographic");
  if (valid.position.kind === "geographic") {
    assert.ok(Object.is(valid.position.altitudeMeters, -0));
  }
  assert.ok(Number.isNaN(invalid.recordedAtMs));
  assert.ok(Number.isNaN(invalid.confidence));
  assert.equal(invalid.horizontalAccuracyMeters, Number.NEGATIVE_INFINITY);
  assert.equal(invalid.position.kind, "geographic");
  if (invalid.position.kind === "geographic") {
    assert.ok(Number.isNaN(invalid.position.latitude));
    assert.equal(invalid.position.longitude, Number.POSITIVE_INFINITY);
  }
  const restoredMarker = staged.explorations[0]!.markers[0]!;
  assert.ok(Object.is(restoredMarker.xMeters, -0));
  assert.equal(restoredMarker.note, "Private note");
});

test("non-canonical number token fails after integrity validation", async () => {
  const original = archive(await build());
  const filePath = "observations/0001.ndjson";
  const lines = original.files
    .find((file) => file.path === filePath)!
    .content.trimEnd()
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  lines[0]!.confidence = "0.90";
  const modified = replaceFileAndManifest(
    original,
    filePath,
    `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`,
  );

  await expectStagingCode(
    stagePersonalMapBundleImport(modified, HASHER),
    "invalid-number-token",
  );
});

test("unsupported raw source fails after integrity validation", async () => {
  const original = archive(await build());
  const filePath = "observations/0001.ndjson";
  const lines = original.files
    .find((file) => file.path === filePath)!
    .content.trimEnd()
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  lines[0]!.source = "camera-vio";
  const modified = replaceFileAndManifest(
    original,
    filePath,
    `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`,
  );

  await expectStagingCode(
    stagePersonalMapBundleImport(modified, HASHER),
    "invalid-raw-sample",
  );
});

test("marker evidence requires finite timestamp and supported category", async () => {
  const original = archive(await build());
  const filePath = "markers/0001.json";
  const markers = JSON.parse(
    original.files.find((file) => file.path === filePath)!.content,
  ) as Array<Record<string, unknown>>;

  markers[0]!.recordedAtMs = "NaN";
  let modified = replaceFileAndManifest(
    original,
    filePath,
    `${JSON.stringify(markers, null, 2)}\n`,
  );
  await expectStagingCode(
    stagePersonalMapBundleImport(modified, HASHER),
    "invalid-marker",
  );

  markers[0]!.recordedAtMs = "1500";
  markers[0]!.category = "inferred-building";
  modified = replaceFileAndManifest(
    original,
    filePath,
    `${JSON.stringify(markers, null, 2)}\n`,
  );
  await expectStagingCode(
    stagePersonalMapBundleImport(modified, HASHER),
    "invalid-marker",
  );
});

test("frame hints cannot introduce out-of-range geographic origins", async () => {
  const original = archive(await build());
  const filePath = "personal-map.json";
  const value = JSON.parse(
    original.files.find((file) => file.path === filePath)!.content,
  ) as Record<string, unknown>;
  value.frameAtExport = {
    kind: "geographic-local",
    originLatitude: "91",
    originLongitude: "139.767",
  };
  const modified = replaceFileAndManifest(
    original,
    filePath,
    `${JSON.stringify(value, null, 2)}\n`,
  );

  await expectStagingCode(
    stagePersonalMapBundleImport(modified, HASHER),
    "invalid-frame",
  );
});

test("duplicate raw and marker identities are rejected at staging", async () => {
  const original = archive(await build());
  const rawPath = "observations/0001.ndjson";
  const rawLine = original.files
    .find((file) => file.path === rawPath)!
    .content.trimEnd()
    .split("\n")[0]!;
  let modified = replaceFileAndManifest(
    original,
    rawPath,
    `${rawLine}\n${rawLine}\n`,
  );
  modified = updateExplorationCount(
    modified,
    "first",
    "rawSampleCount",
    2,
  );
  await expectStagingCode(
    stagePersonalMapBundleImport(modified, HASHER),
    "duplicate-sample-id",
  );

  const markerPath = "markers/0001.json";
  const markerValue = JSON.parse(
    original.files.find((file) => file.path === markerPath)!.content,
  ) as unknown[];
  modified = replaceFileAndManifest(
    original,
    markerPath,
    `${JSON.stringify([markerValue[0], markerValue[0]], null, 2)}\n`,
  );
  modified = updateExplorationCount(
    modified,
    "first",
    "markerCount",
    2,
  );
  await expectStagingCode(
    stagePersonalMapBundleImport(modified, HASHER),
    "duplicate-marker-id",
  );
});
