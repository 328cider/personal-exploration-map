import assert from "node:assert/strict";
import test from "node:test";

import type {
  PersonalMapSnapshot,
  PersonalMapTrackSegment,
  TrackPoint,
} from "../../mapping-core/src/index.ts";
import { buildPersonalMapGeoJson } from "../src/index.ts";
import {
  cutLineStringAtAntimeridian,
  type AntimeridianPosition,
} from "../src/geojsonAntimeridian.ts";

function longitudeDeltas(
  coordinates: readonly AntimeridianPosition[],
): readonly number[] {
  return coordinates
    .slice(1)
    .map((position, index) => Math.abs(position[0] - coordinates[index]![0]));
}

function geographicPoint(
  id: string,
  recordedAtMs: number,
  longitude: number,
  latitude: number,
  altitudeMeters?: number,
): TrackPoint {
  return {
    sampleId: id,
    recordedAtMs,
    source: "gnss",
    sourcePosition: {
      kind: "geographic",
      longitude,
      latitude,
      ...(altitudeMeters === undefined ? {} : { altitudeMeters }),
    },
    xMeters: 0,
    yMeters: 0,
    confidence: 0.9,
  };
}

function snapshot(points: readonly TrackPoint[]): PersonalMapSnapshot {
  const segment: PersonalMapTrackSegment = {
    explorationId: "session-antimeridian",
    startedAtMs: 1_000,
    endedAtMs: 2_000,
    track: points,
  };
  return {
    personalMapId: "map-antimeridian",
    name: "Dateline walk",
    frame: {
      kind: "geographic-local",
      originLatitude: points[0]?.sourcePosition.kind === "geographic"
        ? points[0].sourcePosition.latitude
        : 0,
      originLongitude: points[0]?.sourcePosition.kind === "geographic"
        ? points[0].sourcePosition.longitude
        : 0,
    },
    segments: [segment],
    markers: [],
    bounds: null,
    stats: {
      explorationCount: 1,
      rawSampleCount: points.length,
      acceptedSampleCount: points.length,
      rejectedSampleCount: 0,
      distanceMeters: 0,
      durationMs: 1_000,
      markerCount: 0,
    },
    revision: 1,
  };
}

test("eastward antimeridian crossing becomes two RFC 7946 parts", () => {
  const geometry = cutLineStringAtAntimeridian([
    [170, 45],
    [-170, 45],
  ]);

  assert.deepEqual(geometry, {
    type: "MultiLineString",
    coordinates: [
      [
        [170, 45],
        [180, 45],
      ],
      [
        [-180, 45],
        [-170, 45],
      ],
    ],
  });
});

test("westward antimeridian crossing uses the opposite boundary signs", () => {
  const geometry = cutLineStringAtAntimeridian([
    [-170, 45],
    [170, 45],
  ]);

  assert.deepEqual(geometry, {
    type: "MultiLineString",
    coordinates: [
      [
        [-170, 45],
        [-180, 45],
      ],
      [
        [180, 45],
        [170, 45],
      ],
    ],
  });
});

test("boundary latitude and altitude are interpolated", () => {
  const geometry = cutLineStringAtAntimeridian([
    [179, 10, 100],
    [-179, 12, 200],
  ]);

  assert.deepEqual(geometry, {
    type: "MultiLineString",
    coordinates: [
      [
        [179, 10, 100],
        [180, 11, 150],
      ],
      [
        [-180, 11, 150],
        [-179, 12, 200],
      ],
    ],
  });
});

test("a point already on the antimeridian chooses the non-crossing equivalent", () => {
  const geometry = cutLineStringAtAntimeridian([
    [-180, 40],
    [179, 41],
  ]);

  assert.deepEqual(geometry, {
    type: "LineString",
    coordinates: [
      [180, 40],
      [179, 41],
    ],
  });
});

test("repeated crossings preserve source order and keep every output edge local", () => {
  const geometry = cutLineStringAtAntimeridian([
    [170, 0],
    [-170, 10],
    [170, 20],
  ]);

  assert.equal(geometry.type, "MultiLineString");
  if (geometry.type !== "MultiLineString") {
    return;
  }
  assert.equal(geometry.coordinates.length, 3);
  for (const part of geometry.coordinates) {
    assert.ok(part.length >= 2);
    assert.ok(longitudeDeltas(part).every((delta) => delta <= 180));
  }
  assert.deepEqual(geometry.coordinates[0]?.[0], [170, 0]);
  assert.deepEqual(geometry.coordinates.at(-1)?.at(-1), [170, 20]);
});

test("GeoJSON keeps one exploration feature and uses MultiLineString only when needed", () => {
  const result = buildPersonalMapGeoJson(
    snapshot([
      geographicPoint("a", 1_000, 170, 45),
      geographicPoint("b", 2_000, -170, 45),
    ]),
  );

  assert.equal(result.document.features.length, 1);
  const feature = result.document.features[0];
  assert.equal(feature?.properties.kind, "exploration-track");
  if (feature?.properties.kind !== "exploration-track") {
    return;
  }
  assert.equal(feature.geometry.type, "MultiLineString");
  assert.equal(feature.properties.explorationId, "session-antimeridian");
  assert.equal(feature.properties.pointCount, 2);
  assert.equal(feature.properties.partCount, 2);
});

test("ordinary GeoJSON tracks remain LineString features", () => {
  const result = buildPersonalMapGeoJson(
    snapshot([
      geographicPoint("a", 1_000, 139, 35),
      geographicPoint("b", 2_000, 139.001, 35.001),
    ]),
  );

  const feature = result.document.features[0];
  assert.equal(feature?.properties.kind, "exploration-track");
  if (feature?.properties.kind !== "exploration-track") {
    return;
  }
  assert.equal(feature.geometry.type, "LineString");
  assert.equal(feature.properties.pointCount, 2);
  assert.equal(feature.properties.partCount, 1);
});

test("invalid or insufficient coordinates fail before emitting invalid geometry", () => {
  assert.throws(
    () => cutLineStringAtAntimeridian([[139, 35]]),
    /at least two positions/,
  );
  assert.throws(
    () =>
      cutLineStringAtAntimeridian([
        [181, 35],
        [179, 35],
      ]),
    /Invalid geographic position/,
  );
});
