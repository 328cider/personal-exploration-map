import assert from "node:assert/strict";
import test from "node:test";

import {
  appendPositionSample,
  createExplorationSession,
  type RawPositionSample,
} from "../src/index.ts";

function gnssSample(input: {
  id: string;
  time: number;
  latitude: number;
  longitude: number;
  accuracy?: number;
}): RawPositionSample {
  return {
    id: input.id,
    recordedAtMs: input.time,
    source: "gnss",
    position: {
      kind: "geographic",
      latitude: input.latitude,
      longitude: input.longitude,
    },
    ...(input.accuracy === undefined
      ? {}
      : { horizontalAccuracyMeters: input.accuracy }),
    confidence: 0.9,
  };
}

test("raw evidence is preserved when a GPS jump is rejected", () => {
  let session = createExplorationSession({
    id: "quality-1",
    name: "quality",
    startedAtMs: 0,
  }).session;

  session = appendPositionSample(
    session,
    gnssSample({
      id: "start",
      time: 1_000,
      latitude: 35,
      longitude: 139,
      accuracy: 5,
    }),
  ).session;
  session = appendPositionSample(
    session,
    gnssSample({
      id: "jump",
      time: 2_000,
      latitude: 35.1,
      longitude: 139.1,
      accuracy: 5,
    }),
  ).session;

  assert.equal(session.rawSamples.length, 2);
  assert.equal(session.track.length, 1);
  assert.deepEqual(session.rejectedSamples, [
    { sampleId: "jump", reason: "implausible-jump" },
  ]);
});

test("very inaccurate samples are kept raw but excluded from the map", () => {
  let session = createExplorationSession({
    id: "quality-2",
    name: "accuracy",
    startedAtMs: 0,
  }).session;

  session = appendPositionSample(
    session,
    gnssSample({
      id: "poor",
      time: 1_000,
      latitude: 35,
      longitude: 139,
      accuracy: 250,
    }),
  ).session;

  assert.equal(session.rawSamples.length, 1);
  assert.equal(session.track.length, 0);
  assert.equal(session.rejectedSamples[0]?.reason, "accuracy-too-low");
});

test("geographic and local samples cannot silently share a frame", () => {
  let session = createExplorationSession({
    id: "quality-3",
    name: "frame",
    startedAtMs: 0,
  }).session;

  session = appendPositionSample(
    session,
    gnssSample({
      id: "gnss",
      time: 1_000,
      latitude: 35,
      longitude: 139,
    }),
  ).session;
  session = appendPositionSample(session, {
    id: "local",
    recordedAtMs: 2_000,
    source: "pdr",
    position: { kind: "local", xMeters: 1, yMeters: 1 },
    confidence: 0.7,
  }).session;

  assert.equal(session.track.length, 1);
  assert.equal(
    session.rejectedSamples.at(-1)?.reason,
    "coordinate-frame-mismatch",
  );
});
