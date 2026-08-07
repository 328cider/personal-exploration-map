import assert from "node:assert/strict";
import test from "node:test";

import {
  createMapSnapshot,
  replayExploration,
  type MapMarker,
  type RawPositionSample,
} from "../src/index.ts";

const samples: RawPositionSample[] = [
  {
    id: "s1",
    recordedAtMs: 1_000,
    source: "simulation",
    position: { kind: "local", xMeters: 0, yMeters: 0 },
    confidence: 1,
  },
  {
    id: "s2",
    recordedAtMs: 2_000,
    source: "simulation",
    position: { kind: "local", xMeters: 10, yMeters: 0 },
    confidence: 1,
  },
  {
    id: "s3",
    recordedAtMs: 3_000,
    source: "simulation",
    position: { kind: "local", xMeters: 20, yMeters: 0 },
    confidence: 1,
  },
];

const markers: MapMarker[] = [
  {
    id: "m1",
    recordedAtMs: 2_100,
    category: "interesting",
    label: "found here",
    sourcePosition: { kind: "local", xMeters: 10, yMeters: 0 },
  },
];

test("replay keeps a marker at its recorded position rather than the route end", () => {
  const session = replayExploration({
    id: "replay",
    name: "replay",
    startedAtMs: 1_000,
    endedAtMs: 3_000,
    localFrameLabel: "local",
    samples,
    markers,
  });
  const snapshot = createMapSnapshot(session);

  assert.equal(snapshot.markers[0]?.xMeters, 10);
  assert.equal(snapshot.markers[0]?.yMeters, 0);
  assert.equal(snapshot.stats.markerCount, 1);
});
