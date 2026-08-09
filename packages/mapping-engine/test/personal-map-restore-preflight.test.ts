import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import type {
  MapMarker,
  RawPositionSample,
} from "../../mapping-core/src/index.ts";
import {
  buildPersonalMapBundle,
  PersonalMapRestorePreflightError,
  preflightPersonalMapRestoreNew,
  stagePersonalMapBundleImport,
  type PersonalMapRestoreCollisionPort,
  type PersonalMapBundleSha256Port,
  type RawSampleRestoreIdentity,
  type StoredExploration,
} from "../src/index.ts";

const HASHER: PersonalMapBundleSha256Port = {
  sha256Utf8(content) {
    return createHash("sha256").update(content, "utf8").digest("hex");
  },
};

function exploration(id: string, startedAtMs: number): StoredExploration {
  return {
    id,
    personalMapId: "map-restore",
    name: `Session ${id}`,
    startedAtMs,
    endedAtMs: startedAtMs + 1_000,
    trackingProviderId: "gnss-background",
  };
}

function sample(id: string, recordedAtMs: number): RawPositionSample {
  return {
    id,
    recordedAtMs,
    source: "gnss",
    position: {
      kind: "geographic",
      latitude: 35.681,
      longitude: 139.767,
    },
    confidence: 0.9,
  };
}

function marker(id: string, recordedAtMs: number): MapMarker {
  return {
    id,
    recordedAtMs,
    category: "interesting",
    label: id,
    sourcePosition: {
      kind: "geographic",
      latitude: 35.6811,
      longitude: 139.7671,
    },
  };
}

async function staged() {
  const built = await buildPersonalMapBundle(
    {
      personalMap: {
        id: "map-restore",
        name: "Private map",
        createdAtMs: 1_000,
        updatedAtMs: 5_000,
      },
      frameAtExport: {
        kind: "geographic-local",
        originLatitude: 35.681,
        originLongitude: 139.767,
      },
      explorations: [
        {
          record: exploration("session-b", 2_000),
          rawSamples: [sample("sample-b", 2_100)],
          markers: [marker("marker-b", 2_200)],
        },
        {
          record: exploration("session-a", 1_000),
          rawSamples: [sample("sample-a", 1_100)],
          markers: [marker("marker-a", 1_200)],
        },
      ],
    },
    { exportedAtMs: 10_000, hasher: HASHER },
  );
  return stagePersonalMapBundleImport(
    {
      manifestContent: built.manifestContent,
      files: built.files.map(({ path, content }) => ({ path, content })),
    },
    HASHER,
  );
}

class CollisionPort implements PersonalMapRestoreCollisionPort {
  readonly calls: {
    personalMaps: string[][];
    explorations: string[][];
    rawSamples: RawSampleRestoreIdentity[][];
    markers: string[][];
  } = {
    personalMaps: [],
    explorations: [],
    rawSamples: [],
    markers: [],
  };

  constructor(
    private readonly result: {
      readonly personalMaps?: readonly string[];
      readonly explorations?: readonly string[];
      readonly rawSamples?: readonly RawSampleRestoreIdentity[];
      readonly markers?: readonly string[];
    } = {},
  ) {}

  async findExistingPersonalMapIds(candidateIds: readonly string[]) {
    this.calls.personalMaps.push([...candidateIds]);
    return this.result.personalMaps ?? [];
  }

  async findExistingExplorationIds(candidateIds: readonly string[]) {
    this.calls.explorations.push([...candidateIds]);
    return this.result.explorations ?? [];
  }

  async findExistingRawSampleIdentities(
    candidates: readonly RawSampleRestoreIdentity[],
  ) {
    this.calls.rawSamples.push(candidates.map((item) => ({ ...item })));
    return this.result.rawSamples ?? [];
  }

  async findExistingMarkerIds(candidateIds: readonly string[]) {
    this.calls.markers.push([...candidateIds]);
    return this.result.markers ?? [];
  }
}

test("restore-new preflight batches every identity class and returns a deterministic plan", async () => {
  const port = new CollisionPort();
  const plan = await preflightPersonalMapRestoreNew(await staged(), port);

  assert.deepEqual(plan, {
    mode: "restore-new",
    personalMapId: "map-restore",
    explorationIds: ["session-a", "session-b"],
    rawSampleCount: 2,
    markerCount: 2,
    frameKind: "geographic-local",
    replayRequired: true,
  });
  assert.deepEqual(port.calls.personalMaps, [["map-restore"]]);
  assert.deepEqual(port.calls.explorations, [["session-a", "session-b"]]);
  assert.deepEqual(port.calls.rawSamples, [
    [
      { explorationId: "session-a", sampleId: "sample-a" },
      { explorationId: "session-b", sampleId: "sample-b" },
    ],
  ]);
  assert.deepEqual(port.calls.markers, [["marker-a", "marker-b"]]);
});

test("all collision classes are aggregated in deterministic order", async () => {
  const port = new CollisionPort({
    personalMaps: ["map-restore", "map-restore"],
    explorations: ["session-b"],
    rawSamples: [
      { explorationId: "session-b", sampleId: "sample-b" },
      { explorationId: "session-a", sampleId: "sample-a" },
    ],
    markers: ["marker-b", "marker-a"],
  });

  await assert.rejects(
    preflightPersonalMapRestoreNew(await staged(), port),
    (error: unknown) => {
      assert.ok(error instanceof PersonalMapRestorePreflightError);
      assert.equal(error.code, "identity-collision");
      assert.deepEqual(error.collisions, [
        { kind: "personal-map", id: "map-restore" },
        { kind: "exploration", id: "session-b" },
        {
          kind: "raw-sample",
          explorationId: "session-a",
          id: "sample-a",
        },
        {
          kind: "raw-sample",
          explorationId: "session-b",
          id: "sample-b",
        },
        { kind: "marker", id: "marker-a" },
        { kind: "marker", id: "marker-b" },
      ]);
      return true;
    },
  );
});

test("collision port cannot inject an unrequested identity", async () => {
  const port = new CollisionPort({
    explorations: ["not-in-the-bundle"],
  });

  await assert.rejects(
    preflightPersonalMapRestoreNew(await staged(), port),
    (error: unknown) => {
      assert.ok(error instanceof PersonalMapRestorePreflightError);
      assert.equal(error.code, "invalid-collision-port-result");
      assert.deepEqual(error.collisions, []);
      return true;
    },
  );
});

test("raw-sample identity uses both session and sample ID", async () => {
  const port = new CollisionPort({
    rawSamples: [
      { explorationId: "session-a", sampleId: "sample-a" },
    ],
  });

  await assert.rejects(
    preflightPersonalMapRestoreNew(await staged(), port),
    (error: unknown) => {
      assert.ok(error instanceof PersonalMapRestorePreflightError);
      assert.deepEqual(error.collisions, [
        {
          kind: "raw-sample",
          explorationId: "session-a",
          id: "sample-a",
        },
      ]);
      return true;
    },
  );
});
