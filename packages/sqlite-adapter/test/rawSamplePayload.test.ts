import assert from "node:assert/strict";
import test from "node:test";

import type { RawPositionSample } from "../../mapping-core/src/index.ts";
import {
  decodeSqliteRawSamplePayload,
  encodeSqliteRawSamplePayload,
  SQLITE_RAW_SAMPLE_PAYLOAD_FORMAT,
  SqliteRawSamplePayloadError,
} from "../src/index.ts";

function expectCode(
  operation: () => unknown,
  code: SqliteRawSamplePayloadError["code"],
): void {
  assert.throws(operation, (error: unknown) => {
    assert.ok(error instanceof SqliteRawSamplePayloadError);
    assert.equal(error.code, code);
    return true;
  });
}

test("exact raw payload preserves special values and optional absence", () => {
  const sample: RawPositionSample = {
    id: "sample-special",
    recordedAtMs: Number.NaN,
    source: "simulation",
    position: {
      kind: "geographic",
      latitude: Number.NaN,
      longitude: Number.POSITIVE_INFINITY,
      altitudeMeters: -0,
    },
    horizontalAccuracyMeters: Number.NEGATIVE_INFINITY,
    speedMetersPerSecond: -0,
    confidence: Number.NaN,
  };

  const content = encodeSqliteRawSamplePayload(sample);
  const parsed = JSON.parse(content) as Record<string, unknown>;
  assert.equal(parsed.schema, SQLITE_RAW_SAMPLE_PAYLOAD_FORMAT);
  assert.equal("headingDegrees" in parsed, false);

  const decoded = decodeSqliteRawSamplePayload(content);
  assert.equal(decoded.id, sample.id);
  assert.ok(Number.isNaN(decoded.recordedAtMs));
  assert.ok(Number.isNaN(decoded.confidence));
  assert.equal(
    decoded.horizontalAccuracyMeters,
    Number.NEGATIVE_INFINITY,
  );
  assert.ok(Object.is(decoded.speedMetersPerSecond, -0));
  assert.equal(decoded.headingDegrees, undefined);
  assert.equal(decoded.position.kind, "geographic");
  if (decoded.position.kind === "geographic") {
    assert.ok(Number.isNaN(decoded.position.latitude));
    assert.equal(decoded.position.longitude, Number.POSITIVE_INFINITY);
    assert.ok(Object.is(decoded.position.altitudeMeters, -0));
  }
});

test("local raw payload keeps exact floor and finite values", () => {
  const sample: RawPositionSample = {
    id: "sample-local",
    recordedAtMs: 10,
    source: "pdr",
    position: {
      kind: "local",
      xMeters: 1.25,
      yMeters: -0,
      floor: Number.POSITIVE_INFINITY,
    },
    headingDegrees: 90,
    confidence: 0.75,
  };

  const decoded = decodeSqliteRawSamplePayload(
    encodeSqliteRawSamplePayload(sample),
  );
  assert.deepEqual(
    {
      ...decoded,
      position:
        decoded.position.kind === "local"
          ? {
              ...decoded.position,
              yMeters: Object.is(decoded.position.yMeters, -0)
                ? "-0"
                : decoded.position.yMeters,
            }
          : decoded.position,
    },
    {
      ...sample,
      position: {
        ...sample.position,
        yMeters: "-0",
      },
    },
  );
});

test("payload decoder rejects aliases, unknown fields, and unsupported schema", () => {
  const valid = JSON.parse(
    encodeSqliteRawSamplePayload({
      id: "sample",
      recordedAtMs: 1,
      source: "gnss",
      position: {
        kind: "geographic",
        latitude: 35,
        longitude: 139,
      },
      confidence: 1,
    }),
  ) as Record<string, unknown>;

  expectCode(
    () =>
      decodeSqliteRawSamplePayload(
        JSON.stringify({ ...valid, recordedAtMs: "1.0" }),
      ),
    "invalid-number-token",
  );
  expectCode(
    () =>
      decodeSqliteRawSamplePayload(
        JSON.stringify({ ...valid, privateExtra: "not allowed" }),
      ),
    "invalid-field",
  );
  expectCode(
    () =>
      decodeSqliteRawSamplePayload(
        JSON.stringify({ ...valid, schema: "future-schema" }),
      ),
    "invalid-schema",
  );
});
