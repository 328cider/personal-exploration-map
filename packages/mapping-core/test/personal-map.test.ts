import assert from "node:assert/strict";
import test from "node:test";

import {
  createPersonalMapSnapshot,
  type RawPositionSample,
} from "../src/index.ts";

function gnssSample(
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
    horizontalAccuracyMeters: 4,
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
    source: "pdr",
    position: { kind: "local", xMeters, yMeters },
    confidence: 0.8,
  };
}

test("multiple geographic explorations remain separate map segments", () => {
  const map = createPersonalMapSnapshot({
    id: "map-1",
    name: "My map",
    explorations: [
      {
        id: "first",
        name: "First",
        startedAtMs: 0,
        endedAtMs: 10_000,
        samples: [
          gnssSample("a", 0, 35, 139),
          gnssSample("b", 10_000, 35.0001, 139),
        ],
      },
      {
        id: "second",
        name: "Second",
        startedAtMs: 86_400_000,
        endedAtMs: 86_410_000,
        samples: [
          gnssSample("c", 86_400_000, 35, 139.0001),
          gnssSample("d", 86_410_000, 35.0001, 139.0001),
        ],
      },
    ],
  });

  assert.equal(map.frame.kind, "geographic-local");
  assert.equal(map.segments.length, 2);
  assert.deepEqual(
    map.segments.map((segment) => segment.explorationId),
    ["first", "second"],
  );
  assert.equal(map.segments[0]?.track.length, 2);
  assert.equal(map.segments[1]?.track.length, 2);
  assert.equal(map.stats.explorationCount, 2);
  assert.equal(map.stats.acceptedSampleCount, 4);
  assert.ok(map.stats.distanceMeters > 20);
  assert.ok(map.stats.distanceMeters < 24);

  const secondStart = map.segments[1]?.track[0];
  assert.ok(secondStart !== undefined);
  assert.ok(secondStart.xMeters > 8);
  assert.ok(secondStart.xMeters < 10.5);
});

test("markers are reprojected into the personal map frame", () => {
  const map = createPersonalMapSnapshot({
    id: "map-markers",
    name: "Markers",
    explorations: [
      {
        id: "first",
        name: "First",
        startedAtMs: 0,
        samples: [gnssSample("a", 0, 35, 139)],
      },
      {
        id: "second",
        name: "Second",
        startedAtMs: 100_000,
        samples: [gnssSample("b", 100_000, 35, 139.0001)],
        markers: [
          {
            id: "marker",
            recordedAtMs: 100_000,
            category: "interesting",
            label: "Found",
            sourcePosition: {
              kind: "geographic",
              latitude: 35,
              longitude: 139.0001,
            },
          },
        ],
      },
    ],
  });

  const marker = map.markers[0];
  assert.ok(marker?.xMeters !== undefined);
  assert.ok(marker.xMeters > 8);
  assert.ok(marker.xMeters < 10.5);
});

test("local explorations require an explicit shared frame label", () => {
  assert.throws(
    () =>
      createPersonalMapSnapshot({
        id: "map-local",
        name: "Local",
        explorations: [
          {
            id: "first",
            name: "First",
            startedAtMs: 0,
            samples: [localSample("a", 0, 0, 0)],
          },
          {
            id: "second",
            name: "Second",
            startedAtMs: 10_000,
            samples: [localSample("b", 10_000, 0, 0)],
          },
        ],
      }),
    /explicit local frame label/,
  );

  const map = createPersonalMapSnapshot({
    id: "map-local-anchored",
    name: "Local anchored",
    explorations: [
      {
        id: "first",
        name: "First",
        startedAtMs: 0,
        localFrameLabel: "shared-origin",
        samples: [localSample("a", 0, 0, 0)],
      },
      {
        id: "second",
        name: "Second",
        startedAtMs: 10_000,
        localFrameLabel: "shared-origin",
        samples: [localSample("b", 10_000, 3, 4)],
      },
    ],
  });
  assert.equal(map.frame.kind, "local");
  assert.equal(map.segments.length, 2);
});

test("geographic and local explorations cannot be silently combined", () => {
  assert.throws(
    () =>
      createPersonalMapSnapshot({
        id: "map-mixed",
        name: "Mixed",
        explorations: [
          {
            id: "geo",
            name: "Geo",
            startedAtMs: 0,
            samples: [gnssSample("a", 0, 35, 139)],
          },
          {
            id: "local",
            name: "Local",
            startedAtMs: 10_000,
            localFrameLabel: "inside",
            samples: [localSample("b", 10_000, 0, 0)],
          },
        ],
      }),
    /explicit anchor transform/,
  );
});
