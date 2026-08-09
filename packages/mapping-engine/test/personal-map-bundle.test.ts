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
  encodePersonalMapBundleNumber,
  PERSONAL_MAP_BUNDLE_FORMAT,
  PERSONAL_MAP_BUNDLE_NUMBER_ENCODING,
  PersonalMapBundleBuildError,
  type PersonalMapBundleExportInput,
  type PersonalMapBundleSha256Port,
  type StoredExploration,
  type StoredPersonalMap,
} from "../src/index.ts";

const SHA256_HASHER: PersonalMapBundleSha256Port = {
  sha256Utf8(content) {
    return createHash("sha256").update(content, "utf8").digest("hex");
  },
};

function personalMap(): StoredPersonalMap {
  return {
    id: "map/private-id",
    name: "東京の探索 & private label",
    createdAtMs: 1_000,
    updatedAtMs: 5_000,
  };
}

function exploration(
  id: string,
  startedAtMs: number,
  options: {
    readonly provider?: string;
    readonly frameLabel?: string;
  } = {},
): StoredExploration {
  return {
    id,
    personalMapId: "map/private-id",
    name: `探索 ${id}`,
    startedAtMs,
    endedAtMs: startedAtMs + 1_000,
    trackingProviderId: options.provider ?? "gnss-background",
    ...(options.frameLabel === undefined
      ? {}
      : { localFrameLabel: options.frameLabel }),
  };
}

function rawSamples(): RawPositionSample[] {
  return [
    {
      id: "sample/one",
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
      id: "sample-invalid-but-preserved",
      recordedAtMs: 1_200,
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

function markers(): MapMarker[] {
  return [
    {
      id: "marker/private-id",
      recordedAtMs: 1_300,
      category: "interesting",
      label: "門 & 木",
      note: "private marker text",
      xMeters: -0,
      yMeters: 4.5,
      sourcePosition: {
        kind: "geographic",
        latitude: 35.6811,
        longitude: 139.7671,
      },
    },
  ];
}

function input(
  explorations: PersonalMapBundleExportInput["explorations"] = [
    {
      record: exploration("session/later", 2_000),
      rawSamples: [],
      markers: [],
    },
    {
      record: exploration("session/first", 1_000),
      rawSamples: rawSamples(),
      markers: markers(),
    },
  ],
): PersonalMapBundleExportInput {
  return {
    personalMap: personalMap(),
    frameAtExport: {
      kind: "geographic-local",
      originLatitude: 35.681,
      originLongitude: 139.767,
    },
    explorations,
    producer: {
      appVersion: "0.1.0",
      appBuild: "test",
    },
  };
}

function fileByPath(
  result: Awaited<ReturnType<typeof buildPersonalMapBundle>>,
  path: string,
) {
  const file = result.files.find((candidate) => candidate.path === path);
  assert.ok(file, `missing bundle file: ${path}`);
  return file;
}

test("number encoding preserves every JavaScript special numeric value", () => {
  assert.equal(encodePersonalMapBundleNumber(Number.NaN), "NaN");
  assert.equal(encodePersonalMapBundleNumber(Number.POSITIVE_INFINITY), "+Infinity");
  assert.equal(encodePersonalMapBundleNumber(Number.NEGATIVE_INFINITY), "-Infinity");
  assert.equal(encodePersonalMapBundleNumber(-0), "-0");
  assert.equal(encodePersonalMapBundleNumber(1.25), "1.25");
});

test("logical bundle preserves raw order, provider, frame, markers, and special numbers", async () => {
  const result = await buildPersonalMapBundle(input(), {
    exportedAtMs: 10_000,
    hasher: SHA256_HASHER,
  });

  assert.equal(result.manifest.format, PERSONAL_MAP_BUNDLE_FORMAT);
  assert.equal(
    result.manifest.numberEncoding,
    PERSONAL_MAP_BUNDLE_NUMBER_ENCODING,
  );
  assert.equal(result.manifest.containsRawLocation, true);
  assert.equal(result.manifest.containsDerivedMap, false);
  assert.equal(result.manifest.containsGameState, false);
  assert.equal(result.manifest.replayRequired, true);
  assert.equal(result.manifest.explorations.length, 2);

  // Explorations receive deterministic ordinal paths without exposing IDs or names.
  assert.equal(result.manifest.explorations[0]?.id, "session/first");
  assert.equal(result.manifest.explorations[0]?.recordPath, "explorations/0001.json");
  assert.equal(result.manifest.explorations[1]?.id, "session/later");
  for (const file of result.files) {
    assert.equal(file.path.includes("session"), false);
    assert.equal(file.path.includes("東京"), false);
  }

  const raw = fileByPath(result, "observations/0001.ndjson").content
    .trimEnd()
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  assert.equal(raw.length, 2);
  assert.equal(raw[0]?.id, "sample/one");
  assert.equal(raw[1]?.id, "sample-invalid-but-preserved");
  assert.deepEqual(raw[1]?.position, {
    kind: "geographic",
    latitude: "NaN",
    longitude: "+Infinity",
  });
  assert.equal(raw[1]?.horizontalAccuracyMeters, "-Infinity");
  assert.equal(raw[1]?.confidence, "NaN");

  const markerFile = fileByPath(result, "markers/0001.json");
  const markerDocument = JSON.parse(markerFile.content) as Array<
    Record<string, unknown>
  >;
  assert.equal(markerDocument[0]?.label, "門 & 木");
  assert.equal(markerDocument[0]?.note, "private marker text");
  assert.equal(markerDocument[0]?.xMeters, "-0");

  const explorationRecord = JSON.parse(
    fileByPath(result, "explorations/0001.json").content,
  ) as Record<string, unknown>;
  assert.equal(explorationRecord.trackingProviderId, "gnss-background");
  assert.equal(explorationRecord.personalMapId, "map/private-id");
});

test("manifest hashes and UTF-8 byte lengths match every logical content file", async () => {
  const result = await buildPersonalMapBundle(input(), {
    exportedAtMs: 10_000,
    hasher: SHA256_HASHER,
  });

  assert.equal(result.manifest.files.length, result.files.length);
  for (const file of result.files) {
    const manifestFile = result.manifest.files.find(
      (candidate) => candidate.path === file.path,
    );
    assert.ok(manifestFile);
    assert.equal(manifestFile.sha256, file.sha256);
    assert.equal(
      file.sha256,
      createHash("sha256").update(file.content, "utf8").digest("hex"),
    );
    assert.equal(file.byteLength, Buffer.byteLength(file.content, "utf8"));
    assert.equal(manifestFile.byteLength, file.byteLength);
  }
});

test("bundle output is deterministic for the same input, timestamp, and hasher", async () => {
  const first = await buildPersonalMapBundle(input(), {
    exportedAtMs: 10_000,
    hasher: SHA256_HASHER,
  });
  const second = await buildPersonalMapBundle(input(), {
    exportedAtMs: 10_000,
    hasher: SHA256_HASHER,
  });

  assert.equal(first.manifestContent, second.manifestContent);
  assert.deepEqual(first.files, second.files);
});

test("bundle rejects cross-map and duplicate canonical membership", async () => {
  const crossMap: StoredExploration = {
    ...exploration("wrong-map", 1_000),
    personalMapId: "another-map",
  };
  await assert.rejects(
    buildPersonalMapBundle(
      input([{ record: crossMap, rawSamples: [], markers: [] }]),
      { exportedAtMs: 10_000, hasher: SHA256_HASHER },
    ),
    (error: unknown) => {
      assert.ok(error instanceof PersonalMapBundleBuildError);
      assert.equal(error.code, "invalid-exploration");
      return true;
    },
  );

  const duplicate = exploration("duplicate", 1_000);
  await assert.rejects(
    buildPersonalMapBundle(
      input([
        { record: duplicate, rawSamples: [], markers: [] },
        { record: duplicate, rawSamples: [], markers: [] },
      ]),
      { exportedAtMs: 10_000, hasher: SHA256_HASHER },
    ),
    (error: unknown) => {
      assert.ok(error instanceof PersonalMapBundleBuildError);
      assert.equal(error.code, "duplicate-exploration-id");
      return true;
    },
  );
});

test("duplicate samples and markers are rejected instead of silently overwritten", async () => {
  const duplicateSample = rawSamples()[0]!;
  await assert.rejects(
    buildPersonalMapBundle(
      input([
        {
          record: exploration("samples", 1_000),
          rawSamples: [duplicateSample, duplicateSample],
          markers: [],
        },
      ]),
      { exportedAtMs: 10_000, hasher: SHA256_HASHER },
    ),
    (error: unknown) => {
      assert.ok(error instanceof PersonalMapBundleBuildError);
      assert.equal(error.code, "duplicate-sample-id");
      return true;
    },
  );

  const marker = markers()[0]!;
  await assert.rejects(
    buildPersonalMapBundle(
      input([
        {
          record: exploration("markers", 1_000),
          rawSamples: [],
          markers: [marker, marker],
        },
      ]),
      { exportedAtMs: 10_000, hasher: SHA256_HASHER },
    ),
    (error: unknown) => {
      assert.ok(error instanceof PersonalMapBundleBuildError);
      assert.equal(error.code, "duplicate-marker-id");
      return true;
    },
  );
});

test("invalid structural timestamps and invalid cryptographic adapters fail closed", async () => {
  await assert.rejects(
    buildPersonalMapBundle(
      {
        ...input(),
        personalMap: { ...personalMap(), updatedAtMs: Number.NaN },
      },
      { exportedAtMs: 10_000, hasher: SHA256_HASHER },
    ),
    (error: unknown) => {
      assert.ok(error instanceof PersonalMapBundleBuildError);
      assert.equal(error.code, "invalid-personal-map");
      return true;
    },
  );

  await assert.rejects(
    buildPersonalMapBundle(input(), {
      exportedAtMs: 10_000,
      hasher: { sha256Utf8: () => "not-a-sha256" },
    }),
    (error: unknown) => {
      assert.ok(error instanceof PersonalMapBundleBuildError);
      assert.equal(error.code, "invalid-sha256");
      return true;
    },
  );
});
