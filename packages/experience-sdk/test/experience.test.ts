import assert from "node:assert/strict";
import test from "node:test";

import type {
  MappingEvent,
  PersonalMapSnapshot,
} from "../../mapping-core/src/index.ts";
import type { MappingExperience } from "../src/index.ts";

interface FogState {
  readonly handledEvents: number;
}

test("an experience produces separate state and overlays without changing map truth", () => {
  const map = Object.freeze({
    personalMapId: "map-1",
    name: "My map",
    frame: { kind: "unresolved" },
    segments: Object.freeze([]),
    markers: Object.freeze([]),
    bounds: null,
    stats: Object.freeze({
      explorationCount: 0,
      rawSampleCount: 0,
      acceptedSampleCount: 0,
      rejectedSampleCount: 0,
      distanceMeters: 0,
      durationMs: 0,
      markerCount: 0,
    }),
    revision: 0,
  }) as unknown as PersonalMapSnapshot;
  const event = {
    type: "exploration.started",
    explorationId: "session-1",
    occurredAtMs: 1_000,
  } satisfies MappingEvent;

  const experience: MappingExperience<FogState> = {
    id: "fog-example",
    version: "1",
    createInitialState: () => ({ handledEvents: 0 }),
    onMappingEvent(input) {
      return {
        state: { handledEvents: input.state.handledEvents + 1 },
        overlays: [
          {
            experienceId: "fog-example",
            layerId: input.event.type,
            primitives: [],
          },
        ],
      };
    },
  };

  const before = JSON.stringify(map);
  const result = experience.onMappingEvent({
    event,
    map,
    state: experience.createInitialState(),
  });

  assert.equal(result.state.handledEvents, 1);
  assert.equal(result.overlays[0]?.experienceId, "fog-example");
  assert.equal(JSON.stringify(map), before);
});
