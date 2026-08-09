import assert from "node:assert/strict";
import test from "node:test";

import {
  encodeSqliteRawSamplePayload,
  rowToExactSample,
  rowToReplaySample,
  SQLITE_RAW_SAMPLE_PAYLOAD_FORMAT,
  SqliteRawEvidenceError,
  type PositionRow,
} from "../src/index.ts";

function exactRow(overrides: Partial<PositionRow> = {}): PositionRow {
  const payload = encodeSqliteRawSamplePayload({
    id: "sample",
    recordedAtMs: 1,
    source: "gnss",
    position: {
      kind: "geographic",
      latitude: 35,
      longitude: 139,
    },
    confidence: 1,
  });
  return {
    id: "sample",
    exploration_id: "exploration",
    sample_ordinal: 0,
    ordinal_provenance: "ingest-sequence-v1",
    raw_payload_format: SQLITE_RAW_SAMPLE_PAYLOAD_FORMAT,
    raw_payload_json: payload,
    recorded_at: 1,
    source: "gnss",
    coordinate_kind: "geographic",
    latitude: 35,
    longitude: 139,
    altitude_meters: null,
    x_meters: null,
    y_meters: null,
    floor_level: null,
    horizontal_accuracy_meters: null,
    heading_degrees: null,
    speed_meters_per_second: null,
    confidence: 1,
    ...overrides,
  };
}

function expectEvidenceCode(
  operation: () => unknown,
  code: SqliteRawEvidenceError["code"],
): void {
  assert.throws(operation, (error: unknown) => {
    assert.ok(error instanceof SqliteRawEvidenceError);
    assert.equal(error.code, code);
    return true;
  });
}

test("exact rows require ingest ordinal provenance before payload decode", () => {
  expectEvidenceCode(
    () => rowToExactSample(exactRow({ sample_ordinal: null })),
    "invalid-row-provenance",
  );
  expectEvidenceCode(
    () =>
      rowToExactSample(
        exactRow({ ordinal_provenance: "legacy-recorded-at-id-v1" }),
      ),
    "invalid-row-provenance",
  );
});

test("legacy rows require null ordinal and no invented exact payload", () => {
  const legacy = exactRow({
    sample_ordinal: null,
    ordinal_provenance: "legacy-recorded-at-id-v1",
    raw_payload_format: "legacy-normalized-v1",
    raw_payload_json: null,
  });
  assert.equal(rowToReplaySample(legacy)?.id, "sample");

  expectEvidenceCode(
    () => rowToReplaySample({ ...legacy, sample_ordinal: 0 }),
    "invalid-row-provenance",
  );
  expectEvidenceCode(
    () => rowToReplaySample({ ...legacy, raw_payload_json: "{}" }),
    "invalid-row-provenance",
  );
});

test("exact payload identity must match its canonical row", () => {
  expectEvidenceCode(
    () => rowToExactSample(exactRow({ id: "different" })),
    "exact-payload-identity-mismatch",
  );
});
