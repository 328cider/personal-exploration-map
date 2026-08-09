import assert from "node:assert/strict";
import test from "node:test";

import type {
  MapFrame,
  MapMarker,
  RawPositionSample,
} from "../../mapping-core/src/index.ts";
import {
  loadPersonalMapBundleExportInput,
  PersonalMapBundleReadError,
  type PersonalMapBundleMarkerGroup,
  type PersonalMapBundleRawSampleGroup,
  type PersonalMapBundleReadRepositoryPort,
  type StoredExploration,
  type StoredPersonalMap,
} from "../src/index.ts";

const MAP: StoredPersonalMap = {
  id: "map-1",
  name: "Private map",
  createdAtMs: 1_000,
  updatedAtMs: 5_000,
};

const FRAME: MapFrame = {
  kind: "geographic-local",
  originLatitude: 35.681,
  originLongitude: 139.767,
};

function exploration(id: string, startedAtMs: number): StoredExploration {
  return {
    id,
    personalMapId: MAP.id,
    name: id,
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
  };
}

class Repository implements PersonalMapBundleReadRepositoryPort {
  readonly calls: {
    mapIds: string[];
    frameIds: string[];
    explorationMapIds: string[];
    rawBatches: string[][];
    markerBatches: string[][];
  } = {
    mapIds: [],
    frameIds: [],
    explorationMapIds: [],
    rawBatches: [],
    markerBatches: [],
  };

  constructor(
    readonly values: {
      readonly map?: StoredPersonalMap | null;
      readonly frame?: MapFrame;
      readonly explorations?: readonly StoredExploration[];
      readonly rawGroups?: readonly PersonalMapBundleRawSampleGroup[];
      readonly markerGroups?: readonly PersonalMapBundleMarkerGroup[];
    } = {},
  ) {}

  async loadPersonalMapRecord(personalMapId: string) {
    this.calls.mapIds.push(personalMapId);
    return this.values.map === undefined ? MAP : this.values.map;
  }

  async loadFrameAtExport(personalMapId: string) {
    this.calls.frameIds.push(personalMapId);
    return this.values.frame ?? FRAME;
  }

  async listExplorationRecords(personalMapId: string) {
    this.calls.explorationMapIds.push(personalMapId);
    return this.values.explorations ?? [
      exploration("session-b", 2_000),
      exploration("session-a", 1_000),
    ];
  }

  async loadRawSampleGroups(explorationIds: readonly string[]) {
    this.calls.rawBatches.push([...explorationIds]);
    return this.values.rawGroups ?? [
      { explorationId: "session-b", samples: [sample("sample-b", 2_100)] },
      { explorationId: "session-a", samples: [sample("sample-a", 1_100)] },
    ];
  }

  async loadMarkerGroups(explorationIds: readonly string[]) {
    this.calls.markerBatches.push([...explorationIds]);
    return this.values.markerGroups ?? [
      { explorationId: "session-b", markers: [] },
      { explorationId: "session-a", markers: [marker("marker-a", 1_200)] },
    ];
  }
}

function expectCode(
  operation: Promise<unknown>,
  code: PersonalMapBundleReadError["code"],
): Promise<void> {
  return assert.rejects(operation, (error: unknown) => {
    assert.ok(error instanceof PersonalMapBundleReadError);
    assert.equal(error.code, code);
    return true;
  });
}

test("canonical evidence is loaded in batched read-only queries and ordered deterministically", async () => {
  const repository = new Repository();
  const result = await loadPersonalMapBundleExportInput(repository, {
    personalMapId: MAP.id,
    producer: { appVersion: "0.1.0" },
  });

  assert.equal(result.personalMap, MAP);
  assert.equal(result.frameAtExport, FRAME);
  assert.deepEqual(
    result.explorations.map((item) => item.record.id),
    ["session-a", "session-b"],
  );
  assert.deepEqual(
    result.explorations.map((item) => item.rawSamples[0]?.id ?? null),
    ["sample-a", "sample-b"],
  );
  assert.deepEqual(
    result.explorations.map((item) => item.markers.map((entry) => entry.id)),
    [["marker-a"], []],
  );
  assert.deepEqual(result.producer, { appVersion: "0.1.0" });
  assert.deepEqual(repository.calls, {
    mapIds: [MAP.id],
    frameIds: [MAP.id],
    explorationMapIds: [MAP.id],
    rawBatches: [["session-a", "session-b"]],
    markerBatches: [["session-a", "session-b"]],
  });
});

test("missing PersonalMap stops before frame or evidence queries", async () => {
  const repository = new Repository({ map: null });
  await expectCode(
    loadPersonalMapBundleExportInput(repository, { personalMapId: MAP.id }),
    "personal-map-not-found",
  );
  assert.deepEqual(repository.calls, {
    mapIds: [MAP.id],
    frameIds: [],
    explorationMapIds: [],
    rawBatches: [],
    markerBatches: [],
  });
});

test("cross-map and duplicate ExplorationSession records fail closed", async () => {
  const crossMap = {
    ...exploration("cross-map", 1_000),
    personalMapId: "other-map",
  };
  await expectCode(
    loadPersonalMapBundleExportInput(
      new Repository({ explorations: [crossMap] }),
      { personalMapId: MAP.id },
    ),
    "record-id-mismatch",
  );

  const duplicate = exploration("duplicate", 1_000);
  await expectCode(
    loadPersonalMapBundleExportInput(
      new Repository({ explorations: [duplicate, duplicate] }),
      { personalMapId: MAP.id },
    ),
    "duplicate-exploration-id",
  );
});

test("evidence groups must be exactly one per requested ExplorationSession", async () => {
  const records = [exploration("session-a", 1_000)];
  await expectCode(
    loadPersonalMapBundleExportInput(
      new Repository({ explorations: records, rawGroups: [] }),
      { personalMapId: MAP.id },
    ),
    "missing-evidence-group",
  );

  await expectCode(
    loadPersonalMapBundleExportInput(
      new Repository({
        explorations: records,
        rawGroups: [
          { explorationId: "session-a", samples: [] },
          { explorationId: "session-a", samples: [] },
        ],
        markerGroups: [{ explorationId: "session-a", markers: [] }],
      }),
      { personalMapId: MAP.id },
    ),
    "duplicate-evidence-group",
  );

  await expectCode(
    loadPersonalMapBundleExportInput(
      new Repository({
        explorations: records,
        rawGroups: [{ explorationId: "session-a", samples: [] }],
        markerGroups: [{ explorationId: "unexpected", markers: [] }],
      }),
      { personalMapId: MAP.id },
    ),
    "unexpected-evidence-group",
  );
});

test("a map with no explorations still receives empty batch queries", async () => {
  const repository = new Repository({
    explorations: [],
    rawGroups: [],
    markerGroups: [],
  });
  const result = await loadPersonalMapBundleExportInput(repository, {
    personalMapId: MAP.id,
  });

  assert.deepEqual(result.explorations, []);
  assert.deepEqual(repository.calls.rawBatches, [[]]);
  assert.deepEqual(repository.calls.markerBatches, [[]]);
});
