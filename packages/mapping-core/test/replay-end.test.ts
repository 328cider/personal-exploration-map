import assert from "node:assert/strict";
import test from "node:test";

import {
  createMapSnapshot,
  replayExploration,
  type RawPositionSample,
} from "../src/index.ts";

function sample(id: string, recordedAtMs: number, latitude: number): RawPositionSample {
  return {
    id,
    recordedAtMs,
    source: "gnss",
    position: {
      kind: "geographic",
      latitude,
      longitude: 139,
    },
    horizontalAccuracyMeters: 5,
    confidence: 0.95,
  };
}

test("replay preserves a late platform callback but excludes it after exploration end", () => {
  const session = replayExploration({
    id: "completed-exploration",
    name: "Completed exploration",
    startedAtMs: 1_000,
    endedAtMs: 2_500,
    samples: [
      sample("before-end", 2_000, 35),
      sample("after-end", 3_000, 35.00001),
    ],
  });
  const snapshot = createMapSnapshot(session);

  assert.equal(session.status, "completed");
  assert.equal(session.endedAtMs, 2_500);
  assert.equal(session.rawSamples.length, 2);
  assert.equal(session.track.length, 1);
  assert.deepEqual(session.rejectedSamples, [
    { sampleId: "after-end", reason: "sample-after-session-end" },
  ]);
  assert.equal(snapshot.stats.rawSampleCount, 2);
  assert.equal(snapshot.stats.acceptedSampleCount, 1);
  assert.equal(snapshot.stats.rejectedSampleCount, 1);
});
