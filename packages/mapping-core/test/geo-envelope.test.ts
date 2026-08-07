import assert from "node:assert/strict";
import test from "node:test";

import {
  haversineDistanceMeters,
  isWithinRecommendedLocalProjectionEnvelope,
  normalizeLongitudeDegrees,
  projectGeographicToLocal,
  shortestLongitudeDeltaDegrees,
  unprojectLocalToGeographic,
} from "../src/geo.ts";
import type { GeographicPosition } from "../src/model.ts";

function geographic(
  latitude: number,
  longitude: number,
): GeographicPosition {
  return { kind: "geographic", latitude, longitude };
}

function closeTo(
  actual: number,
  expected: number,
  tolerance: number,
): void {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `Expected ${actual} to be within ${tolerance} of ${expected}`,
  );
}

test("longitude normalization and delta use the shortest antimeridian path", () => {
  assert.equal(normalizeLongitudeDegrees(181), -179);
  assert.equal(normalizeLongitudeDegrees(-181), 179);
  closeTo(shortestLongitudeDeltaDegrees(179.999, -179.999), 0.002, 1e-9);
  closeTo(shortestLongitudeDeltaDegrees(-179.999, 179.999), -0.002, 1e-9);
});

test("distance and local projection do not turn an antimeridian crossing into a world-spanning route", () => {
  const origin = geographic(0, 179.999);
  const across = geographic(0, -179.999);

  const distance = haversineDistanceMeters(origin, across);
  assert.ok(distance > 200 && distance < 230);

  const projected = projectGeographicToLocal(
    across,
    origin.latitude,
    origin.longitude,
  );
  assert.ok(projected.xMeters > 200 && projected.xMeters < 230);
  closeTo(projected.yMeters, 0, 1e-9);

  const restored = unprojectLocalToGeographic(
    projected.xMeters,
    projected.yMeters,
    origin.latitude,
    origin.longitude,
  );
  closeTo(restored.latitude, across.latitude, 1e-10);
  closeTo(restored.longitude, across.longitude, 1e-10);
});

test("short Tokyo routes round-trip through the dependency-free local projection", () => {
  const origin = geographic(35.6062, 139.7348);
  const point = geographic(35.6125, 139.7421);

  const projected = projectGeographicToLocal(
    point,
    origin.latitude,
    origin.longitude,
  );
  const restored = unprojectLocalToGeographic(
    projected.xMeters,
    projected.yMeters,
    origin.latitude,
    origin.longitude,
  );

  closeTo(restored.latitude, point.latitude, 1e-10);
  closeTo(restored.longitude, point.longitude, 1e-10);
});

test("the recommended projection envelope is explicit rather than an implicit global guarantee", () => {
  const origin = geographic(35, 139);

  assert.equal(
    isWithinRecommendedLocalProjectionEnvelope(
      geographic(35.1, 139.1),
      origin.latitude,
      origin.longitude,
    ),
    true,
  );

  assert.equal(
    isWithinRecommendedLocalProjectionEnvelope(
      geographic(35.3, 139),
      origin.latitude,
      origin.longitude,
    ),
    false,
  );

  assert.equal(
    isWithinRecommendedLocalProjectionEnvelope(
      geographic(81, 139),
      81,
      origin.longitude,
    ),
    false,
  );

  assert.equal(
    isWithinRecommendedLocalProjectionEnvelope(
      geographic(35.01, 139.01),
      origin.latitude,
      origin.longitude,
      Number.NaN,
    ),
    false,
  );
});
