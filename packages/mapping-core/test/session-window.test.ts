import assert from "node:assert/strict";
import test from "node:test";

import {
  appendPositionSample,
  createExplorationSession,
  replayExploration,
  type RawPositionSample,
} from "../src/index.ts";

function geographicSample(
  id: string,
  recordedAtMs: number,
  latitude: number,
): RawPositionSample {
  return {
    id,
    recordedAtMs,
    source: "gnss",
    position: {
      kind: "geographic",
      latitude,
      longitude: 139,
    },
    horizontalAccuracyMeters: 8,
    confidence: 0.95,
  };
}

test("a cached pre-start fix remains raw but cannot establish the frame", () => {
  let session = createExplorationSession({
    id: "exploration",
    name: "Pocket walk",
    startedAtMs: 10_000,
  }).session;

  const cached = geographicSample("cached", 9_000, 35);
  const cachedMutation = appendPositionSample(session, cached);
  session = cachedMutation.session;

  assert.deepEqual(session.rawSamples, [cached]);
  assert.deepEqual(session.track, []);
  assert.deepEqual(session.frame, { kind: "unresolved" });
  assert.deepEqual(session.rejectedSamples, [
    { sampleId: "cached", reason: "sample-before-session-start" },
  ]);
  assert.equal(cachedMutation.events[0]?.type, "position.rejected");

  const firstInside = geographicSample("inside", 11_000, 35.001);
  session = appendPositionSample(session, firstInside).session;

  assert.equal(session.rawSamples.length, 2);
  assert.deepEqual(
    session.track.map((point) => point.sampleId),
    ["inside"],
  );
  assert.deepEqual(session.frame, {
    kind: "geographic-local",
    originLatitude: 35.001,
    originLongitude: 139,
  });
});

test("replay preserves cached evidence and derives from the first in-window fix", () => {
  const cached = geographicSample("cached", 8_000, 34.9);
  const firstInside = geographicSample("inside-1", 10_000, 35.1);
  const secondInside = geographicSample("inside-2", 15_000, 35.10001);

  const session = replayExploration({
    id: "exploration",
    name: "Replay",
    startedAtMs: 10_000,
    endedAtMs: 20_000,
    samples: [secondInside, cached, firstInside],
  });

  assert.deepEqual(
    session.rawSamples.map((sample) => sample.id),
    ["cached", "inside-1", "inside-2"],
  );
  assert.deepEqual(
    session.track.map((point) => point.sampleId),
    ["inside-1", "inside-2"],
  );
  assert.deepEqual(session.rejectedSamples, [
    { sampleId: "cached", reason: "sample-before-session-start" },
  ]);
  assert.deepEqual(session.frame, {
    kind: "geographic-local",
    originLatitude: 35.1,
    originLongitude: 139,
  });
});

test("a non-finite timestamp is retained as raw evidence and rejected", () => {
  const initial = createExplorationSession({
    id: "exploration",
    name: "Pocket walk",
    startedAtMs: 10_000,
  }).session;
  const invalid = geographicSample("invalid-time", Number.NaN, 35);

  const mutation = appendPositionSample(initial, invalid);

  assert.equal(mutation.session.rawSamples.length, 1);
  assert.ok(Number.isNaN(mutation.session.rawSamples[0]?.recordedAtMs));
  assert.deepEqual(mutation.session.track, []);
  assert.deepEqual(mutation.session.frame, { kind: "unresolved" });
  assert.deepEqual(mutation.session.rejectedSamples, [
    { sampleId: "invalid-time", reason: "invalid-timestamp" },
  ]);
  assert.equal(mutation.events[0]?.type, "position.rejected");
  assert.equal(mutation.events[0]?.occurredAtMs, 10_000);
});
