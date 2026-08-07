import assert from "node:assert/strict";
import test from "node:test";

import type {
  PersonalMapSnapshot,
  TrackPoint,
} from "@exploration-map/mapping-core";

import { buildTrackCanvasGeometry } from "../src/rendering/trackGeometry.ts";

function point(
  id: string,
  xMeters: number,
  yMeters: number,
  confidence = 0.9,
): TrackPoint {
  return {
    sampleId: id,
    recordedAtMs: Number(id.replace(/\D/gu, "")) || 1,
    source: "simulation",
    sourcePosition: {
      kind: "local",
      xMeters,
      yMeters,
    },
    xMeters,
    yMeters,
    confidence,
  };
}

function snapshot(input?: {
  readonly segments?: PersonalMapSnapshot["segments"];
  readonly markers?: PersonalMapSnapshot["markers"];
}): PersonalMapSnapshot {
  const segments = input?.segments ?? [];
  const allPoints = segments.flatMap((segment) => segment.track);
  const bounds =
    allPoints.length === 0
      ? null
      : {
          minX: Math.min(...allPoints.map((item) => item.xMeters)),
          minY: Math.min(...allPoints.map((item) => item.yMeters)),
          maxX: Math.max(...allPoints.map((item) => item.xMeters)),
          maxY: Math.max(...allPoints.map((item) => item.yMeters)),
        };
  const markers = input?.markers ?? [];

  return {
    personalMapId: "map-1",
    name: "Test map",
    frame: { kind: "local", label: "test-space" },
    segments,
    markers,
    bounds,
    stats: {
      explorationCount: segments.length,
      rawSampleCount: allPoints.length,
      acceptedSampleCount: allPoints.length,
      rejectedSampleCount: 0,
      distanceMeters: 0,
      durationMs: 0,
      markerCount: markers.length,
    },
    revision: allPoints.length + markers.length,
  };
}

test("two exploration sessions remain separate SVG stroke sources", () => {
  const geometry = buildTrackCanvasGeometry({
    snapshot: snapshot({
      segments: [
        {
          explorationId: "first",
          startedAtMs: 1,
          endedAtMs: 2,
          track: [point("a1", 0, 0), point("a2", 10, 0)],
        },
        {
          explorationId: "second",
          startedAtMs: 3,
          endedAtMs: 4,
          track: [point("b1", 90, 100), point("b2", 100, 100)],
        },
      ],
    }),
    width: 320,
    height: 240,
    padding: 20,
  });

  assert.equal(geometry.pointCount, 4);
  assert.equal(geometry.explorationCount, 2);
  assert.deepEqual(
    [...new Set(geometry.strokes.map((stroke) => stroke.explorationId))],
    ["first", "second"],
  );
  assert.equal(geometry.strokes.length, 2);
  assert.equal(geometry.endpoints.length, 4);
  assert.deepEqual(
    geometry.endpoints.map((endpoint) => [
      endpoint.explorationId,
      endpoint.kind,
    ]),
    [
      ["first", "start"],
      ["first", "end"],
      ["second", "start"],
      ["second", "end"],
    ],
  );

  const firstEnd = geometry.endpoints.find(
    (endpoint) =>
      endpoint.explorationId === "first" && endpoint.kind === "end",
  );
  const secondStart = geometry.endpoints.find(
    (endpoint) =>
      endpoint.explorationId === "second" && endpoint.kind === "start",
  );
  assert.notDeepEqual(firstEnd?.point, secondStart?.point);
  assert.equal(
    geometry.strokes.some(
      (stroke) =>
        stroke.explorationId === "first" &&
        stroke.pathData ===
          geometry.strokes.find(
            (candidate) => candidate.explorationId === "second",
          )?.pathData,
    ),
    false,
  );
});

test("confidence changes split one session into styled runs without adding points", () => {
  const geometry = buildTrackCanvasGeometry({
    snapshot: snapshot({
      segments: [
        {
          explorationId: "confidence-session",
          startedAtMs: 1,
          track: [
            point("p1", 0, 0, 0.9),
            point("p2", 10, 0, 0.9),
            point("p3", 20, 0, 0.2),
            point("p4", 30, 0, 0.2),
          ],
        },
      ],
    }),
    width: 300,
    height: 200,
  });

  assert.equal(geometry.strokes.length, 2);
  assert.deepEqual(
    geometry.strokes.map((stroke) => ({
      band: stroke.confidenceBand,
      opacity: stroke.opacity,
      pointCount: stroke.pointCount,
    })),
    [
      { band: "high", opacity: 0.9, pointCount: 2 },
      { band: "low", opacity: 0.4, pointCount: 3 },
    ],
  );
  assert.equal(
    geometry.strokes.every(
      (stroke) => stroke.explorationId === "confidence-session",
    ),
    true,
  );
});

test("confirmed markers and session endpoints share the same projection", () => {
  const geometry = buildTrackCanvasGeometry({
    snapshot: snapshot({
      segments: [
        {
          explorationId: "marker-session",
          startedAtMs: 1,
          track: [point("m1", 0, 0), point("m2", 20, 20)],
        },
      ],
      markers: [
        {
          id: "marker-1",
          recordedAtMs: 2,
          category: "interesting",
          label: "Found it",
          xMeters: 20,
          yMeters: 20,
          sourcePosition: {
            kind: "local",
            xMeters: 20,
            yMeters: 20,
          },
        },
      ],
    }),
    width: 300,
    height: 200,
  });

  const marker = geometry.markers[0];
  const endpoint = geometry.endpoints.find(
    (item) => item.kind === "end",
  );
  assert.equal(marker?.marker.label, "Found it");
  assert.deepEqual(marker?.point, endpoint?.point);
});

test("empty or not-yet-laid-out maps produce no drawable geometry", () => {
  const empty = buildTrackCanvasGeometry({
    snapshot: snapshot(),
    width: 320,
    height: 240,
  });
  assert.deepEqual(empty.strokes, []);
  assert.deepEqual(empty.endpoints, []);
  assert.deepEqual(empty.markers, []);

  const zeroWidth = buildTrackCanvasGeometry({
    snapshot: snapshot({
      segments: [
        {
          explorationId: "hidden",
          startedAtMs: 1,
          track: [point("z1", 0, 0), point("z2", 1, 1)],
        },
      ],
    }),
    width: 0,
    height: 240,
  });
  assert.equal(zeroWidth.pointCount, 2);
  assert.deepEqual(zeroWidth.strokes, []);
});
