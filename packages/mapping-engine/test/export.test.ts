import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPersonalMapGeoJson,
  PersonalMapExportError,
  serializePersonalMapGeoJson,
  serializePersonalMapGpx,
} from "../src/index.ts";
import type {
  MapFrame,
  MapMarker,
  PersonalMapSnapshot,
  PersonalMapTrackSegment,
  TrackPoint,
} from "../../mapping-core/src/index.ts";

function trackPoint(input: {
  readonly id: string;
  readonly recordedAtMs: number;
  readonly latitude: number;
  readonly longitude: number;
  readonly altitudeMeters?: number;
  readonly confidence?: number;
  readonly accuracy?: number;
}): TrackPoint {
  return {
    sampleId: input.id,
    recordedAtMs: input.recordedAtMs,
    source: "gnss",
    sourcePosition: {
      kind: "geographic",
      latitude: input.latitude,
      longitude: input.longitude,
      ...(input.altitudeMeters === undefined
        ? {}
        : { altitudeMeters: input.altitudeMeters }),
    },
    xMeters: 0,
    yMeters: 0,
    ...(input.accuracy === undefined
      ? {}
      : { horizontalAccuracyMeters: input.accuracy }),
    confidence: input.confidence ?? 0.9,
  };
}

function segment(
  id: string,
  startedAtMs: number,
  points: readonly TrackPoint[],
): PersonalMapTrackSegment {
  return {
    explorationId: id,
    startedAtMs,
    endedAtMs: startedAtMs + 60_000,
    track: points,
  };
}

function snapshot(input: {
  readonly frame?: MapFrame;
  readonly segments?: readonly PersonalMapTrackSegment[];
  readonly markers?: readonly MapMarker[];
  readonly name?: string;
} = {}): PersonalMapSnapshot {
  const segments =
    input.segments ??
    [
      segment("session-a", 1_000, [
        trackPoint({
          id: "a-1",
          recordedAtMs: 1_000,
          latitude: 35.681,
          longitude: 139.767,
          altitudeMeters: 12.5,
          accuracy: 5,
        }),
        trackPoint({
          id: "a-2",
          recordedAtMs: 2_000,
          latitude: 35.6811,
          longitude: 139.7671,
          accuracy: 6,
        }),
      ]),
      segment("session-b", 100_000, [
        trackPoint({
          id: "b-1",
          recordedAtMs: 100_000,
          latitude: 35.682,
          longitude: 139.768,
        }),
        trackPoint({
          id: "b-2",
          recordedAtMs: 101_000,
          latitude: 35.6821,
          longitude: 139.7681,
        }),
      ]),
    ];

  return {
    personalMapId: "map-1",
    name: input.name ?? "A & B <map>",
    frame:
      input.frame ??
      {
        kind: "geographic-local",
        originLatitude: 35.681,
        originLongitude: 139.767,
      },
    segments,
    markers: input.markers ?? [],
    bounds: null,
    stats: {
      explorationCount: segments.length,
      rawSampleCount: segments.reduce(
        (sum, item) => sum + item.track.length,
        0,
      ),
      acceptedSampleCount: segments.reduce(
        (sum, item) => sum + item.track.length,
        0,
      ),
      rejectedSampleCount: 0,
      distanceMeters: 0,
      durationMs: 120_000,
      markerCount: input.markers?.length ?? 0,
    },
    revision: 4,
  };
}

function assertExportError(
  operation: () => unknown,
  code: PersonalMapExportError["code"],
): void {
  assert.throws(operation, (error: unknown) => {
    assert.ok(error instanceof PersonalMapExportError);
    assert.equal(error.code, code);
    return true;
  });
}

test("GPX keeps ExplorationSessions as separate trkseg elements", () => {
  const result = serializePersonalMapGpx(snapshot(), {
    generatedAtMs: 200_000,
    creator: "Exporter & test",
  });

  assert.equal(result.format, "gpx-1.1");
  assert.equal(result.mediaType, "application/gpx+xml");
  assert.equal(result.warnings.length, 0);
  assert.equal((result.content.match(/<trkseg>/g) ?? []).length, 2);
  assert.equal((result.content.match(/<trkpt /g) ?? []).length, 4);
  assert.match(result.content, /creator="Exporter &amp; test"/);
  assert.match(result.content, /<name>A &amp; B &lt;map&gt;<\/name>/);
  assert.match(result.content, /<pem:explorationId>session-a<\/pem:explorationId>/);
  assert.match(result.content, /<pem:explorationId>session-b<\/pem:explorationId>/);

  const firstSegmentEnd = result.content.indexOf("</trkseg>");
  const secondSegmentStart = result.content.indexOf(
    "<trkseg>",
    result.content.indexOf("<trkseg>") + 1,
  );
  assert.ok(firstSegmentEnd > 0);
  assert.ok(secondSegmentStart > firstSegmentEnd);
  assert.equal(
    result.content.includes(
      '<trkpt lat="35.6811" lon="139.7671"></trkpt><trkpt lat="35.682"',
    ),
    false,
  );
});

test("GPX exports geographic markers as waypoints and omits local-only markers", () => {
  const markers: MapMarker[] = [
    {
      id: "marker-geographic",
      recordedAtMs: 5_000,
      category: "entrance",
      label: "Gate & entrance",
      note: "Near <tree>",
      sourcePosition: {
        kind: "geographic",
        latitude: 35.6815,
        longitude: 139.7675,
      },
    },
    {
      id: "marker-local",
      recordedAtMs: 6_000,
      category: "note",
      label: "Local only",
      sourcePosition: { kind: "local", xMeters: 1, yMeters: 2 },
    },
  ];

  const result = serializePersonalMapGpx(snapshot({ markers }));

  assert.equal((result.content.match(/<wpt /g) ?? []).length, 1);
  assert.match(result.content, /Gate &amp; entrance/);
  assert.match(result.content, /Near &lt;tree&gt;/);
  assert.deepEqual(result.warnings, [
    {
      code: "marker-omitted-without-geographic-position",
      entityId: "marker-local",
      message:
        "Marker marker-local was omitted because it has no geographic source position.",
    },
  ]);
});

test("GeoJSON emits one LineString per eligible session and longitude-latitude order", () => {
  const marker: MapMarker = {
    id: "marker-1",
    recordedAtMs: 5_000,
    category: "interesting",
    label: "View",
    sourcePosition: {
      kind: "geographic",
      latitude: 35.683,
      longitude: 139.769,
    },
  };

  const result = buildPersonalMapGeoJson(snapshot({ markers: [marker] }), {
    generatedAtMs: 300_000,
  });
  const tracks = result.document.features.filter(
    (feature) => feature.geometry.type === "LineString",
  );
  const points = result.document.features.filter(
    (feature) => feature.geometry.type === "Point",
  );

  assert.equal(tracks.length, 2);
  assert.equal(points.length, 1);
  assert.deepEqual(tracks[0]?.geometry.coordinates[0], [139.767, 35.681, 12.5]);
  assert.deepEqual(tracks[1]?.geometry.coordinates[0], [139.768, 35.682]);
  assert.deepEqual(points[0]?.geometry.coordinates, [139.769, 35.683]);
  assert.equal(result.document.generatedAt, "1970-01-01T00:05:00.000Z");
  assert.equal(result.warnings.length, 0);
});

test("GeoJSON omits sessions that cannot form a valid LineString with a warning", () => {
  const result = buildPersonalMapGeoJson(
    snapshot({
      segments: [
        segment("single-point", 1_000, [
          trackPoint({
            id: "single",
            recordedAtMs: 1_000,
            latitude: 35,
            longitude: 139,
          }),
        ]),
        segment("empty", 2_000, []),
      ],
    }),
  );

  assert.equal(result.document.features.length, 0);
  assert.deepEqual(
    result.warnings.map((warning) => [warning.code, warning.entityId]),
    [
      ["segment-omitted-insufficient-points", "single-point"],
      ["segment-omitted-insufficient-points", "empty"],
    ],
  );
});

test("GeoJSON serialization is deterministic and pretty by default", () => {
  const result = serializePersonalMapGeoJson(snapshot(), {
    generatedAtMs: 300_000,
  });

  assert.equal(result.format, "geojson");
  assert.equal(result.mediaType, "application/geo+json");
  assert.ok(result.content.endsWith("\n"));
  assert.match(result.content, /\n  "features": \[/);

  const parsed = JSON.parse(result.content) as {
    type: string;
    features: unknown[];
  };
  assert.equal(parsed.type, "FeatureCollection");
  assert.equal(parsed.features.length, 2);
});

test("local and unresolved maps are rejected instead of being disguised as WGS84", () => {
  const local = snapshot({ frame: { kind: "local", label: "building-a" } });
  const unresolved = snapshot({ frame: { kind: "unresolved" } });

  assertExportError(
    () => serializePersonalMapGpx(local),
    "geographic-frame-required",
  );
  assertExportError(
    () => serializePersonalMapGeoJson(local),
    "geographic-frame-required",
  );
  assertExportError(
    () => serializePersonalMapGpx(unresolved),
    "geographic-frame-required",
  );
});

test("a geographic frame cannot hide a local-source accepted track point", () => {
  const invalidPoint: TrackPoint = {
    sampleId: "local-point",
    recordedAtMs: 1_000,
    source: "pdr",
    sourcePosition: {
      kind: "local",
      xMeters: 10,
      yMeters: 20,
    },
    xMeters: 10,
    yMeters: 20,
    confidence: 0.8,
  };
  const inconsistent = snapshot({
    segments: [segment("session-local-source", 1_000, [invalidPoint, invalidPoint])],
  });

  assertExportError(
    () => serializePersonalMapGpx(inconsistent),
    "invalid-geographic-position",
  );
  assertExportError(
    () => serializePersonalMapGeoJson(inconsistent),
    "invalid-geographic-position",
  );
});
