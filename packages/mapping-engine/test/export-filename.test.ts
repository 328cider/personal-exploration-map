import assert from "node:assert/strict";
import test from "node:test";

import {
  createPersonalMapExportFilename,
  PersonalMapExportError,
} from "../src/index.ts";

test("GPX filename is deterministic, UTC, portable, and location-neutral", () => {
  const filename = createPersonalMapExportFilename({
    format: "gpx-1.1",
    generatedAtMs: Date.UTC(2026, 7, 9, 15, 4, 5, 123),
  });

  assert.equal(filename, "personal-map-20260809T150405123Z.gpx");
  assert.match(filename, /^[A-Za-z0-9.-]+$/);
  assert.equal(/[\\/:*?"<>|]/u.test(filename), false);
  assert.equal(filename.includes("Tokyo"), false);
  assert.equal(filename.includes("35.681"), false);
});

test("GeoJSON uses a distinct standard extension without map metadata", () => {
  const filename = createPersonalMapExportFilename({
    format: "geojson",
    generatedAtMs: 0,
  });

  assert.equal(filename, "personal-map-19700101T000000000Z.geojson");
  assert.equal(filename.includes("personal-map-id-1"), false);
  assert.equal(filename.includes("My exploration"), false);
});

test("millisecond precision prevents collisions between rapid explicit exports", () => {
  const first = createPersonalMapExportFilename({
    format: "geojson",
    generatedAtMs: 1_000,
  });
  const second = createPersonalMapExportFilename({
    format: "geojson",
    generatedAtMs: 1_001,
  });

  assert.notEqual(first, second);
});

test("the same instant produces the same filename in every host timezone", () => {
  const filename = createPersonalMapExportFilename({
    format: "gpx-1.1",
    generatedAtMs: Date.parse("2026-08-09T15:04:05.123+09:00"),
  });

  assert.equal(filename, "personal-map-20260809T060405123Z.gpx");
});

test("non-finite timestamps fail with the existing typed export error", () => {
  assert.throws(
    () =>
      createPersonalMapExportFilename({
        format: "geojson",
        generatedAtMs: Number.NaN,
      }),
    (error: unknown) => {
      assert.ok(error instanceof PersonalMapExportError);
      assert.equal(error.code, "invalid-timestamp");
      return true;
    },
  );
});
