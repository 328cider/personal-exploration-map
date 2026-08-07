import assert from "node:assert/strict";
import test from "node:test";

import {
  MAPPING_ENGINE_API_VERSION,
  type MappingEngine,
  type MappingEngineListener,
} from "../src/index.ts";
import type { PersonalMapSnapshot } from "../../mapping-core/src/index.ts";

test("applications use explicit commands instead of mutable core sessions", async () => {
  const calls: string[] = [];
  const listeners = new Set<MappingEngineListener>();

  const engine: MappingEngine = {
    async createPersonalMap(command) {
      calls.push(`create-map:${command.name}`);
      return { personalMapId: command.requestedId ?? "map-1" };
    },
    async startExploration(command) {
      calls.push(`start:${command.personalMapId}`);
      return { explorationId: command.requestedId ?? "session-1" };
    },
    async ingestPositionSamples(command) {
      calls.push(`ingest:${command.samples.length}`);
      return {
        persistedSampleCount: command.samples.length,
        acceptedSampleCount: command.samples.length,
        rejectedSampleCount: 0,
      };
    },
    async addMarker(command) {
      calls.push(`marker:${command.marker.label}`);
    },
    async endExploration(command) {
      calls.push(`end:${command.explorationId}`);
      return { map: {} as PersonalMapSnapshot };
    },
    async getPersonalMap() {
      return null;
    },
    async listPersonalMaps() {
      return [];
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };

  const created = await engine.createPersonalMap({
    name: "My map",
    createdAtMs: 1_000,
  });
  const started = await engine.startExploration({
    personalMapId: created.personalMapId,
    name: "First exploration",
    startedAtMs: 2_000,
    trackingProviderId: "gnss",
  });
  await engine.ingestPositionSamples({
    personalMapId: created.personalMapId,
    explorationId: started.explorationId,
    samples: [],
  });
  await engine.addMarker({
    personalMapId: created.personalMapId,
    explorationId: started.explorationId,
    marker: {
      recordedAtMs: 3_000,
      category: "interesting",
      label: "Found it",
    },
  });
  await engine.endExploration({
    personalMapId: created.personalMapId,
    explorationId: started.explorationId,
    endedAtMs: 4_000,
  });

  assert.equal(MAPPING_ENGINE_API_VERSION, "3");
  assert.deepEqual(calls, [
    "create-map:My map",
    "start:map-1",
    "ingest:0",
    "marker:Found it",
    "end:session-1",
  ]);
  assert.equal(listeners.size, 0);
});
