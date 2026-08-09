import assert from "node:assert/strict";
import test from "node:test";

import type {
  MapMarker,
  PersonalMapSnapshot,
  PersonalMapTrackSegment,
  TrackPoint,
} from "../../mapping-core/src/index.ts";
import { serializePersonalMapGpx } from "../src/index.ts";
import { normalizeGpxLongitude } from "../src/gpxCoordinates.ts";

function point(id: string, longitude: number): TrackPoint {
  return {
    sampleId: id,
    recordedAtMs: 1_000,
    source: "gnss",
    sourcePosition: {
      kind: "geographic",
      latitude: 10,
      longitude,
    },
    xMeters: 0,
    yMeters: 0,
    confidence: 0.9,
  };
}

function snapshot(
  track: readonly TrackPoint[],
  markers: readonly MapMarker[] = [],
): PersonalMapSnapshot {
  const segment: PersonalMapTrackSegment = {
    explorationId: "session-dateline",
    startedAtMs: 1_000,
    endedAtMs: 2_000,
    track,
  };
  return {
    personalMapId: "map-dateline",
    name: "Dateline",
    frame: {
      kind: "geographic-local",
      originLatitude: 10,
      originLongitude: 180,
    },
    segments: [segment],
    markers,
    bounds: null,
    stats: {
      explorationCount: 1,
      rawSampleCount: track.length,
      acceptedSampleCount: track.length,
      rejectedSampleCount: 0,
      distanceMeters: 0,
      durationMs: 1_000,
      markerCount: markers.length,
    },
    revision: 1,
  };
}

test("GPX maps equivalent +180 longitude to schema-valid -180", () => {
  const result = serializePersonalMapGpx(
    snapshot([point("a", 180), point("b", 179.9)]),
  );

  assert.match(result.content, /<trkpt lat="10" lon="-180">/);
  assert.equal(result.content.includes('lon="180"'), false);
});

test("GPX applies the same +180 normalization to marker waypoints", () => {
  const marker: MapMarker = {
    id: "marker-dateline",
    recordedAtMs: 1_500,
    category: "interesting",
    label: "Boundary",
    sourcePosition: {
      kind: "geographic",
      latitude: 10.5,
      longitude: 180,
    },
  };
  const result = serializePersonalMapGpx(
    snapshot([point("a", 179.8), point("b", 179.9)], [marker]),
  );

  assert.match(result.content, /<wpt lat="10.5" lon="-180">/);
  assert.equal(result.content.includes('lon="180"'), false);
});

test("ordinary and -180 GPX longitudes remain unchanged", () => {
  assert.equal(normalizeGpxLongitude(-180), -180);
  assert.equal(normalizeGpxLongitude(139.767), 139.767);
});

test("GPX longitude normalization rejects values outside geographic bounds", () => {
  assert.throws(() => normalizeGpxLongitude(180.000001), /GPX longitude/);
  assert.throws(() => normalizeGpxLongitude(-180.000001), /GPX longitude/);
  assert.throws(() => normalizeGpxLongitude(Number.NaN), /GPX longitude/);
});
