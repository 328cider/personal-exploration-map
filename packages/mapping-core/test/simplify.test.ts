import assert from "node:assert/strict";
import test from "node:test";

import { simplifyTrack, type TrackPoint } from "../src/index.ts";

function point(id: string, xMeters: number, yMeters: number): TrackPoint {
  return {
    sampleId: id,
    recordedAtMs: Number(id.replace(/\D/g, "")) || 0,
    source: "simulation",
    sourcePosition: { kind: "local", xMeters, yMeters },
    xMeters,
    yMeters,
    confidence: 1,
  };
}

test("simplification removes near-collinear noise but preserves a turn", () => {
  const track = [
    point("p0", 0, 0),
    point("p1", 2, 0.1),
    point("p2", 4, -0.1),
    point("p3", 6, 0),
    point("p4", 6, 4),
  ];

  const simplified = simplifyTrack(track, 0.25);
  assert.deepEqual(
    simplified.map((item) => item.sampleId),
    ["p0", "p3", "p4"],
  );
});
