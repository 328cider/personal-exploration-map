import assert from "node:assert/strict";
import test from "node:test";

import {
  createMappingEngine,
  type MappingEntityKind,
  type MappingRepositoryPort,
  type MappingRepositoryWriter,
  type StoredExploration,
  type StoredPersonalMap,
  type TrackingProviderPort,
  type TrackingRuntimeStatus,
} from "../src/index.ts";
import type {
  CreatePersonalMapSnapshotInput,
  MapMarker,
  RawPositionSample,
} from "../../mapping-core/src/index.ts";

interface ExplorationData {
  record: StoredExploration;
  samples: RawPositionSample[];
  markers: MapMarker[];
}

class CompensationRepository
  implements MappingRepositoryPort, MappingRepositoryWriter
{
  readonly maps = new Map<string, StoredPersonalMap>();
  readonly explorations = new Map<string, ExplorationData>();

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
    this.maps.set(record.id, { ...record });
  }

  async createExploration(record: StoredExploration): Promise<void> {
    if (!this.maps.has(record.personalMapId)) {
      throw new Error(`Missing PersonalMap: ${record.personalMapId}`);
    }
    this.explorations.set(record.id, {
      record: { ...record },
      samples: [],
      markers: [],
    });
  }

  async deleteExploration(explorationId: string): Promise<void> {
    this.explorations.delete(explorationId);
  }

  async deletePersonalMapIfOnlyEmptyExploration(
    personalMapId: string,
    explorationId: string,
  ): Promise<boolean> {
    const children = [...this.explorations.values()].filter(
      (data) => data.record.personalMapId === personalMapId,
    );
    const only = children[0];
    if (
      !this.maps.has(personalMapId) ||
      children.length !== 1 ||
      only === undefined ||
      only.record.id !== explorationId ||
      only.record.endedAtMs !== undefined ||
      only.samples.length > 0 ||
      only.markers.length > 0
    ) {
      return false;
    }
    this.explorations.delete(explorationId);
    this.maps.delete(personalMapId);
    return true;
  }

  async appendPositionSamples(
    explorationId: string,
    samples: readonly RawPositionSample[],
  ): Promise<readonly RawPositionSample[]> {
    const data = this.explorations.get(explorationId);
    if (data === undefined) {
      throw new Error(`Missing exploration: ${explorationId}`);
    }
    data.samples.push(...samples);
    return samples;
  }

  async appendMarker(
    explorationId: string,
    marker: MapMarker,
  ): Promise<boolean> {
    const data = this.explorations.get(explorationId);
    if (data === undefined) {
      throw new Error(`Missing exploration: ${explorationId}`);
    }
    data.markers.push(marker);
    return true;
  }

  async completeExploration(
    explorationId: string,
    endedAtMs: number,
  ): Promise<void> {
    const data = this.explorations.get(explorationId);
    if (data === undefined) {
      throw new Error(`Missing exploration: ${explorationId}`);
    }
    data.record = { ...data.record, endedAtMs };
  }

  async loadExploration() {
    return null;
  }

  async loadPersonalMapReplayInput(
    personalMapId: string,
  ): Promise<CreatePersonalMapSnapshotInput | null> {
    const map = this.maps.get(personalMapId);
    if (map === undefined) {
      return null;
    }
    return {
      id: map.id,
      name: map.name,
      explorations: [],
    };
  }

  async listPersonalMaps() {
    return [...this.maps.values()].map((map) => ({
      id: map.id,
      name: map.name,
      explorationCount: [...this.explorations.values()].filter(
        (data) => data.record.personalMapId === map.id,
      ).length,
      updatedAtMs: map.updatedAtMs,
    }));
  }
}

class FirstExplorationProvider implements TrackingProviderPort {
  readonly id = "gnss";
  readonly coordinateKind = "geographic" as const;
  readonly starts: string[] = [];
  fail = false;
  onStart?: (input: {
    readonly personalMapId: string;
    readonly explorationId: string;
  }) => Promise<void>;

  async start(input: {
    readonly personalMapId: string;
    readonly explorationId: string;
  }): Promise<void> {
    this.starts.push(`${input.personalMapId}:${input.explorationId}`);
    await this.onStart?.(input);
    if (this.fail) {
      throw new Error("provider start failed");
    }
  }

  async stop(): Promise<void> {}

  async status(): Promise<TrackingRuntimeStatus> {
    return {
      running: false,
      providerId: null,
      explorationId: null,
    };
  }
}

function deterministicIdFactory() {
  const counts = new Map<MappingEntityKind, number>();
  return (kind: MappingEntityKind): string => {
    const next = (counts.get(kind) ?? 0) + 1;
    counts.set(kind, next);
    return `${kind}-${next}`;
  };
}

function createHarness() {
  const repository = new CompensationRepository();
  const provider = new FirstExplorationProvider();
  const engine = createMappingEngine({
    repository,
    trackingProviders: [provider],
    idFactory: deterministicIdFactory(),
  });
  return { engine, provider, repository };
}

test("map and first exploration are committed as one successful use case", async () => {
  const { engine, provider, repository } = createHarness();
  const events: string[] = [];
  engine.subscribe(({ event }) => events.push(event.type));

  const result = await engine.createPersonalMapWithFirstExploration({
    personalMapName: "My world",
    explorationName: "First walk",
    createdAtMs: 1_000,
    startedAtMs: 1_100,
    trackingProviderId: provider.id,
  });

  assert.deepEqual(result, {
    personalMapId: "personal-map-1",
    explorationId: "exploration-1",
  });
  assert.equal(repository.maps.size, 1);
  assert.equal(repository.explorations.size, 1);
  assert.deepEqual(provider.starts, ["personal-map-1:exploration-1"]);
  assert.deepEqual(events, ["exploration.started"]);
});

test("first provider failure removes the empty provisional PersonalMap", async () => {
  const { engine, provider, repository } = createHarness();
  provider.fail = true;
  const events: string[] = [];
  engine.subscribe(({ event }) => events.push(event.type));

  await assert.rejects(
    engine.createPersonalMapWithFirstExploration({
      personalMapName: "Failed map",
      explorationName: "Failed first walk",
      createdAtMs: 1_000,
      startedAtMs: 1_000,
      trackingProviderId: provider.id,
    }),
    /provider start failed/u,
  );

  assert.equal(repository.maps.size, 0);
  assert.equal(repository.explorations.size, 0);
  assert.deepEqual(events, []);
});

test("automatic compensation preserves a provisional map once evidence exists", async () => {
  const { engine, provider, repository } = createHarness();
  provider.fail = true;
  provider.onStart = async ({ explorationId }) => {
    await repository.runInTransaction((writer) =>
      writer.appendPositionSamples(explorationId, [
        {
          id: "early-evidence",
          recordedAtMs: 1_050,
          source: "gnss",
          position: {
            kind: "geographic",
            latitude: 35,
            longitude: 139,
          },
          confidence: 0.9,
        },
      ]),
    );
  };

  await assert.rejects(
    engine.createPersonalMapWithFirstExploration({
      personalMapName: "Evidence map",
      explorationName: "First walk",
      createdAtMs: 1_000,
      startedAtMs: 1_000,
      trackingProviderId: provider.id,
    }),
    (error: unknown) => {
      assert.ok(error instanceof AggregateError);
      assert.match(error.message, /could not be safely compensated/u);
      return true;
    },
  );

  assert.equal(repository.maps.size, 1);
  assert.equal(repository.explorations.size, 1);
  assert.equal(
    repository.explorations.get("exploration-1")?.samples.length,
    1,
  );
});

test("conditional compensation never deletes a PersonalMap with another session", async () => {
  const { repository } = createHarness();
  await repository.runInTransaction(async (writer) => {
    await writer.createPersonalMap({
      id: "map-existing",
      name: "Existing map",
      createdAtMs: 1_000,
      updatedAtMs: 2_000,
    });
    await writer.createExploration({
      id: "session-existing",
      personalMapId: "map-existing",
      name: "Completed session",
      startedAtMs: 1_000,
      endedAtMs: 1_500,
      trackingProviderId: "gnss",
    });
    await writer.createExploration({
      id: "session-provisional",
      personalMapId: "map-existing",
      name: "Provisional session",
      startedAtMs: 2_000,
      trackingProviderId: "gnss",
    });
  });

  const removed = await repository.runInTransaction((writer) =>
    writer.deletePersonalMapIfOnlyEmptyExploration(
      "map-existing",
      "session-provisional",
    ),
  );

  assert.equal(removed, false);
  assert.equal(repository.maps.size, 1);
  assert.equal(repository.explorations.size, 2);
});
