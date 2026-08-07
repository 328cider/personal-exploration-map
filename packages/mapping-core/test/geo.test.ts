import assert from "node:assert/strict";
import test from "node:test";

import {
  haversineDistanceMeters,
  projectGeographicToLocal,
} from "../src/index.ts";

test("latitude projection is approximately 111 metres per 0.001 degree", () => {
  const projected = projectGeographicToLocal(
    { kind: "geographic", latitude: 35.001, longitude: 139 },
    35,
    139,
  );

  assert.ok(projected.yMeters > 110 && projected.yMeters < 112);
  assert.ok(Math.abs(projected.xMeters) < 0.001);
});

test("haversine distance remains close to local projection for short routes", () => {
  const first = { kind: "geographic" as const, latitude: 35, longitude: 139 };
  const second = {
    kind: "geographic" as const,
    latitude: 35.0005,
    longitude: 139.0005,
  };
  const local = projectGeographicToLocal(second, first.latitude, first.longitude);
  const localDistance = Math.hypot(local.xMeters, local.yMeters);
  const greatCircleDistance = haversineDistanceMeters(first, second);

  assert.ok(Math.abs(localDistance - greatCircleDistance) < 0.2);
});
