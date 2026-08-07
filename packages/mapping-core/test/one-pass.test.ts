import assert from "node:assert/strict";
import test from "node:test";

import {
  appendPositionSample,
  createExplorationSession,
  createMapSnapshot,
  type RawPositionSample,
} from "../src/index.ts";

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

test("a single traversal creates a map immediately", () => {
  let session = createExplorationSession({
    id: "exploration-1",
    name: "one pass",
    startedAtMs: 1_000,
    localFrameLabel: "test-space",
  }).session;

  session = appendPositionSample(
    session,
    localSample("sample-1", 1_000, 0, 0),
  ).session;
  session = appendPositionSample(
    session,
    localSample("sample-2", 2_000, 10, 0),
  ).session;

  const snapshot = createMapSnapshot(session);
  assert.equal(snapshot.track.length, 2);
  assert.equal(snapshot.stats.distanceMeters, 10);
  assert.equal(snapshot.stats.rejectedSampleCount, 0);
});

test("repeat visits are not a registration requirement", () => {
  let session = createExplorationSession({
    id: "exploration-2",
    name: "L route",
    startedAtMs: 1_000,
    localFrameLabel: "test-space",
  }).session;

  const samples = [
    localSample("a", 1_000, 0, 0),
    localSample("b", 2_000, 8, 0),
    localSample("c", 3_000, 8, 6),
  ];
  for (const sample of samples) {
    session = appendPositionSample(session, sample).session;
  }

  const snapshot = createMapSnapshot(session);
  assert.deepEqual(
    snapshot.track.map((point) => [point.xMeters, point.yMeters]),
    [
      [0, 0],
      [8, 0],
      [8, 6],
    ],
  );
  assert.equal(snapshot.stats.distanceMeters, 14);
});
