import assert from "node:assert/strict";
import test from "node:test";

import {
  createMappingEngine,
  type LoadedExploration,
  type MappingEntityKind,
  type MappingRepositoryPort,
  type MappingRepositoryWriter,
  type PersonalMapListItem,
  type StoredExploration,
  type StoredPersonalMap,
  type TrackingCoordinateKind,
  type TrackingProviderPort,
  type TrackingRuntimeStatus,
} from "../src/index.ts";
import type {
  CreatePersonalMapSnapshotInput,
  MapMarker,
  RawPositionSample,
  ReplayExplorationInput,
} from "../../mapping-core/src/index.ts";

interface StoredExplorationData {
  record: StoredExploration;
  samples: RawPositionSample[];
  markers: MapMarker[];
}

class InMemoryRepository
  implements MappingRepositoryPort, MappingRepositoryWriter
{
  readonly maps = new Map<string, StoredPersonalMap>();
  readonly explorations = new Map<string, StoredExplorationData>();

  async runInTransaction<T>(
    operation: (writer: MappingRepositoryWriter) => Promise<T>,
  ): Promise<T> {
    const mapsBefore = new Map(
      [...this.maps].map(([id, record]) => [id, { ...record }]),
    );
    const explorationsBefore = new Map(
      [...this.explorations].map(([id, data]) => [
        id,
        {
          record: { ...data.record },
          samples: [...data.samples],
          markers: [...data.markers],
        },
      ]),
    );

    try {
      return await operation(this);
    } catch (error) {
      this.maps.clear();
      for (const [id, record] of mapsBefore) {
        this.maps.set(id, record);
      }
      this.explorations.clear();
      for (const [id, data] of explorationsBefore) {
        this.explorations.set(id, data);
      }
      throw error;
    }
  }

  async createPersonalMap(record: StoredPersonalMap): Promise<void> {
    if (this.maps.has(record.id)) {
      throw new Error(`Duplicate personal map: ${record.id}`);
    }
    this.maps.set(record.id, { ...record });
  }

  async createExploration(record: StoredExploration): Promise<void> {
    if (!this.maps.has(record.personalMapId)) {
      throw new Error(`Missing personal map: ${record.personalMapId}`);
    }
    if (this.explorations.has(record.id)) {
      throw new Error(`Duplicate exploration: ${record.id}`);
    }
    this.explorations.set(record.id, {
      record: { ...record },
      samples: [],
      markers: [],
    });
    this.touchMap(record.personalMapId, record.startedAtMs);
  }

  async deleteExploration(explorationId: string): Promise<void> {
    this.explorations.delete(explorationId);
  }

  async appendPositionSamples(
    explorationId: string,
    samples: readonly RawPositionSample[],
  ): Promise<readonly RawPositionSample[]> {
    const data = this.requireData(explorationId);
    const existingIds = new Set(data.samples.map((sample) => sample.id));
    const inserted = samples.filter((sample) => !existingIds.has(sample.id));
    data.samples.push(...inserted);
    const lastTimestamp = inserted.reduce(
      (maximum, sample) => Math.max(maximum, sample.recordedAtMs),
      data.record.startedAtMs,
    );
    this.touchMap(data.record.personalMapId, lastTimestamp);
    return inserted;
  }

  async appendMarker(
    explorationId: string,
    marker: MapMarker,
  ): Promise<boolean> {
    const data = this.requireData(explorationId);
    if (data.markers.some((stored) => stored.id === marker.id)) {
      return false;
    }
    data.markers.push(marker);
    this.touchMap(data.record.personalMapId, marker.recordedAtMs);
    return true;
  }

  async completeExploration(
    explorationId: string,
    endedAtMs: number,
  ): Promise<void> {
    const data = this.requireData(explorationId);
    data.record = { ...data.record, endedAtMs };
    this.touchMap(data.record.personalMapId, endedAtMs);
  }

  async loadExploration(
    personalMapId: string,
    explorationId: string,
  ): Promise<LoadedExploration | null> {
    const data = this.explorations.get(explorationId);
    if (data === undefined || data.record.personalMapId !== personalMapId) {
      return null;
    }
    return {
      record: { ...data.record },
      replay: this.toReplay(data),
    };
  }

  async loadPersonalMapReplayInput(
    personalMapId: string,
  ): Promise<CreatePersonalMapSnapshotInput | null> {
    const map = this.maps.get(personalMapId);
    if (map === undefined) {
      return null;
    }
    const explorations = [...this.explorations.values()]
      .filter((data) => data.record.personalMapId === personalMapId)
      .sort((first, second) =>
        first.record.startedAtMs - second.record.startedAtMs,
      )
      .map((data) => this.toReplay(data));
    return {
      id: map.id,
      name: map.name,
      explorations,
      simplifyToleranceMeters: 0,
    };
  }

  async listPersonalMaps(): Promise<readonly PersonalMapListItem[]> {
    return [...this.maps.values()]
      .sort((first, second) => second.updatedAtMs - first.updatedAtMs)
      .map((map) => ({
        id: map.id,
        name: map.name,
        explorationCount: [...this.explorations.values()].filter(
          (data) => data.record.personalMapId === map.id,
        ).length,
        updatedAtMs: map.updatedAtMs,
      }));
  }

  private requireData(explorationId: string): StoredExplorationData {
    const data = this.explorations.get(explorationId);
    if (data === undefined) {
      throw new Error(`Missing exploration: ${explorationId}`);
    }
    return data;
  }

  private toReplay(data: StoredExplorationData): ReplayExplorationInput {
    return {
      id: data.record.id,
      name: data.record.name,
      startedAtMs: data.record.startedAtMs,
      ...(data.record.endedAtMs === undefined
        ? {}
        : { endedAtMs: data.record.endedAtMs }),
      samples: [...data.samples],
      markers: [...data.markers],
      ...(data.record.localFrameLabel === undefined
        ? {}
        : { localFrameLabel: data.record.localFrameLabel }),
    };
  }

  private touchMap(personalMapId: string, updatedAtMs: number): void {
    const map = this.maps.get(personalMapId);
    if (map !== undefined) {
      this.maps.set(personalMapId, {
        ...map,
        updatedAtMs: Math.max(map.updatedAtMs, updatedAtMs),
      });
    }
  }
}

class FakeTrackingProvider implements TrackingProviderPort {
  readonly id: string;
  readonly coordinateKind: TrackingCoordinateKind;
  readonly starts: string[] = [];
  readonly stops: string[] = [];
  failStart = false;
  private runningExplorationId: string | null = null;

  constructor(
    id = "gnss",
    coordinateKind: TrackingCoordinateKind = "geographic",
  ) {
    this.id = id;
    this.coordinateKind = coordinateKind;
  }

  async start(input: {
    readonly personalMapId: string;
    readonly explorationId: string;
  }): Promise<void> {
    if (this.failStart) {
      throw new Error("provider start failed");
    }
    this.starts.push(`${input.personalMapId}:${input.explorationId}`);
    this.runningExplorationId = input.explorationId;
  }

  async stop(explorationId: string): Promise<void> {
    this.stops.push(explorationId);
    if (this.runningExplorationId === explorationId) {
      this.runningExplorationId = null;
    }
  }

  async status(): Promise<TrackingRuntimeStatus> {
    return {
      running: this.runningExplorationId !== null,
      providerId: this.runningExplorationId === null ? null : this.id,
      explorationId: this.runningExplorationId,
    };
  }
}

function deterministicIdFactory() {
  const counters = new Map<MappingEntityKind, number>();
  return (kind: MappingEntityKind): string => {
    const next = (counters.get(kind) ?? 0) + 1;
    counters.set(kind, next);
    return `${kind}-${next}`;
  };
}

function geographicSample(
  id: string,
  recordedAtMs: number,
  latitude: number,
  longitude: number,
): RawPositionSample {
  return {
    id,
    recordedAtMs,
    source: "gnss",
    position: { kind: "geographic", latitude, longitude },
    horizontalAccuracyMeters: 5,
    confidence: 0.95,
  };
}

function localSample(
  id: string,
  recordedAtMs: number,
  xMeters: number,
  yMeters: number,
): RawPositionSample {
  return {
    id,
    recordedAtMs,
    source: "simulation",
    position: { kind: "local", xMeters, yMeters },
    confidence: 1,
  };
}

test("the headless engine owns a complete canonical mapping lifecycle", async () => {
  const repository = new InMemoryRepository();
  const provider = new FakeTrackingProvider();
  const engine = createMappingEngine({
    repository,
    trackingProviders: [provider],
    idFactory: deterministicIdFactory(),
  });
  const eventTypes: string[] = [];
  engine.subscribe(({ event }) => eventTypes.push(event.type));
  engine.subscribe(() => {
    throw new Error("presentation listener failure");
  });

  const { personalMapId } = await engine.createPersonalMap({
    name: "My world",
    createdAtMs: 1_000,
  });
  const { explorationId } = await engine.startExploration({
    personalMapId,
    name: "First walk",
    startedAtMs: 2_000,
    trackingProviderId: "gnss",
  });

  const samples = [
    geographicSample("sample-1", 2_500, 35, 139),
    geographicSample("sample-2", 3_500, 35.00001, 139.00001),
    geographicSample("sample-jump", 4_500, 36, 140),
  ];
  const ingested = await engine.ingestPositionSamples({
    personalMapId,
    explorationId,
    samples,
  });
  assert.deepEqual(ingested, {
    persistedSampleCount: 3,
    acceptedSampleCount: 2,
    rejectedSampleCount: 1,
  });

  const duplicate = await engine.ingestPositionSamples({
    personalMapId,
    explorationId,
    samples,
  });
  assert.deepEqual(duplicate, {
    persistedSampleCount: 0,
    acceptedSampleCount: 0,
    rejectedSampleCount: 0,
  });

  await engine.addMarker({
    personalMapId,
    explorationId,
    marker: {
      requestedId: "marker-1",
      recordedAtMs: 4_000,
      category: "interesting",
      label: "Found place",
    },
  });

  const completed = await engine.endExploration({
    personalMapId,
    explorationId,
    endedAtMs: 5_000,
  });

  assert.equal(personalMapId, "personal-map-1");
  assert.equal(explorationId, "exploration-1");
  assert.deepEqual(provider.starts, ["personal-map-1:exploration-1"]);
  assert.deepEqual(provider.stops, ["exploration-1"]);
  assert.deepEqual(eventTypes, [
    "exploration.started",
    "position.accepted",
    "position.accepted",
    "position.rejected",
    "marker.added",
    "exploration.ended",
  ]);

  const map = completed.map;
  assert.equal(map.stats.explorationCount, 1);
  assert.equal(map.stats.rawSampleCount, 3);
  assert.equal(map.stats.acceptedSampleCount, 2);
  assert.equal(map.stats.rejectedSampleCount, 1);
  assert.equal(map.stats.markerCount, 1);
  assert.equal(map.segments.length, 1);
  assert.equal(map.segments[0]?.track.length, 2);
  assert.equal(map.markers[0]?.id, "marker-1");
  assert.notEqual(map.markers[0]?.xMeters, undefined);
  assert.notEqual(map.markers[0]?.yMeters, undefined);

  const listed = await engine.listPersonalMaps();
  assert.deepEqual(listed, [
    {
      id: personalMapId,
      name: "My world",
      explorationCount: 1,
      updatedAtMs: 5_000,
    },
  ]);
});

test("a provider start failure compensates the persisted exploration record", async () => {
  const repository = new InMemoryRepository();
  const provider = new FakeTrackingProvider();
  provider.failStart = true;
  const engine = createMappingEngine({
    repository,
    trackingProviders: [provider],
    idFactory: deterministicIdFactory(),
  });
  const events: string[] = [];
  engine.subscribe(({ event }) => events.push(event.type));

  const { personalMapId } = await engine.createPersonalMap({
    name: "Map",
    createdAtMs: 1_000,
  });

  await assert.rejects(
    engine.startExploration({
      personalMapId,
      name: "Failed walk",
      startedAtMs: 2_000,
      trackingProviderId: "gnss",
    }),
    /provider start failed/u,
  );

  assert.equal(repository.explorations.size, 0);
  assert.deepEqual(events, []);
  const map = await engine.getPersonalMap({ personalMapId });
  assert.equal(map?.stats.explorationCount, 0);
});

test("provider declarations reject invalid local-frame arguments before side effects", async () => {
  const repository = new InMemoryRepository();
  const geographic = new FakeTrackingProvider("gnss", "geographic");
  const local = new FakeTrackingProvider("pdr", "local");
  const engine = createMappingEngine({
    repository,
    trackingProviders: [geographic, local],
    idFactory: deterministicIdFactory(),
  });
  const { personalMapId } = await engine.createPersonalMap({
    name: "Empty map",
    createdAtMs: 1_000,
  });

  await assert.rejects(
    engine.startExploration({
      personalMapId,
      name: "Local without frame",
      startedAtMs: 2_000,
      trackingProviderId: local.id,
    }),
    /requires a non-blank localFrameLabel/u,
  );
  await assert.rejects(
    engine.startExploration({
      personalMapId,
      name: "Geographic with local frame",
      startedAtMs: 3_000,
      trackingProviderId: geographic.id,
      localFrameLabel: "not-allowed",
    }),
    /must not receive a localFrameLabel/u,
  );

  assert.equal(repository.explorations.size, 0);
  assert.deepEqual(geographic.starts, []);
  assert.deepEqual(local.starts, []);
});

test("the engine prevents geographic and local PersonalMap frames from being mixed", async () => {
  const repository = new InMemoryRepository();
  const geographic = new FakeTrackingProvider("gnss", "geographic");
  const local = new FakeTrackingProvider("pdr", "local");
  const engine = createMappingEngine({
    repository,
    trackingProviders: [geographic, local],
    idFactory: deterministicIdFactory(),
  });

  const { personalMapId: geographicMapId } = await engine.createPersonalMap({
    name: "Geographic map",
    createdAtMs: 1_000,
  });
  const geographicExploration = await engine.startExploration({
    personalMapId: geographicMapId,
    name: "GNSS walk",
    startedAtMs: 2_000,
    trackingProviderId: geographic.id,
  });
  await engine.ingestPositionSamples({
    personalMapId: geographicMapId,
    explorationId: geographicExploration.explorationId,
    samples: [geographicSample("geo-1", 2_500, 35, 139)],
  });
  await engine.endExploration({
    personalMapId: geographicMapId,
    explorationId: geographicExploration.explorationId,
    endedAtMs: 3_000,
  });

  const explorationCountBeforeLocalRejection = repository.explorations.size;
  await assert.rejects(
    engine.startExploration({
      personalMapId: geographicMapId,
      name: "Unanchored local continuation",
      startedAtMs: 4_000,
      trackingProviderId: local.id,
      localFrameLabel: "building-a",
    }),
    /cannot extend geographic PersonalMap/u,
  );
  assert.equal(
    repository.explorations.size,
    explorationCountBeforeLocalRejection,
  );
  assert.deepEqual(local.starts, []);

  const { personalMapId: localMapId } = await engine.createPersonalMap({
    name: "Local map",
    createdAtMs: 5_000,
  });
  const localExploration = await engine.startExploration({
    personalMapId: localMapId,
    name: "PDR walk",
    startedAtMs: 6_000,
    trackingProviderId: local.id,
    localFrameLabel: "building-a",
  });
  await engine.ingestPositionSamples({
    personalMapId: localMapId,
    explorationId: localExploration.explorationId,
    samples: [localSample("local-1", 6_500, 0, 0)],
  });
  await engine.endExploration({
    personalMapId: localMapId,
    explorationId: localExploration.explorationId,
    endedAtMs: 7_000,
  });

  const geographicStartsBeforeRejection = geographic.starts.length;
  const explorationCountBeforeGeographicRejection = repository.explorations.size;
  await assert.rejects(
    engine.startExploration({
      personalMapId: localMapId,
      name: "Unanchored GNSS continuation",
      startedAtMs: 8_000,
      trackingProviderId: geographic.id,
    }),
    /cannot extend local PersonalMap/u,
  );
  assert.equal(geographic.starts.length, geographicStartsBeforeRejection);
  assert.equal(
    repository.explorations.size,
    explorationCountBeforeGeographicRejection,
  );

  await assert.rejects(
    engine.startExploration({
      personalMapId: localMapId,
      name: "Wrong local frame",
      startedAtMs: 9_000,
      trackingProviderId: local.id,
      localFrameLabel: "building-b",
    }),
    /does not match PersonalMap frame building-a/u,
  );

  const matching = await engine.startExploration({
    personalMapId: localMapId,
    name: "Matching local continuation",
    startedAtMs: 10_000,
    trackingProviderId: local.id,
    localFrameLabel: " building-a ",
  });
  assert.equal(
    repository.explorations.get(matching.explorationId)?.record.localFrameLabel,
    "building-a",
  );
  assert.equal(local.starts.length, 2);
});
