import type {
  PositionSource,
  RawPositionSample,
} from "@exploration-map/mapping-core";
import {
  decodePersonalMapBundleNumber,
  encodePersonalMapBundleNumber,
  PersonalMapBundleNumberDecodeError,
} from "../../mapping-engine/src/personalMapBundleNumber.ts";

export const SQLITE_RAW_SAMPLE_PAYLOAD_FORMAT =
  "raw-position-sample-exact-v1" as const;

export type SqliteRawSamplePayloadErrorCode =
  | "invalid-json"
  | "invalid-schema"
  | "invalid-field"
  | "invalid-number-token";

export class SqliteRawSamplePayloadError extends Error {
  readonly code: SqliteRawSamplePayloadErrorCode;
  readonly path: string;

  constructor(
    code: SqliteRawSamplePayloadErrorCode,
    message: string,
    path: string,
  ) {
    super(message);
    this.name = "SqliteRawSamplePayloadError";
    this.code = code;
    this.path = path;
  }
}

interface EncodedGeographicPosition {
  readonly kind: "geographic";
  readonly latitude: string;
  readonly longitude: string;
  readonly altitudeMeters?: string;
}

interface EncodedLocalPosition {
  readonly kind: "local";
  readonly xMeters: string;
  readonly yMeters: string;
  readonly floor?: string;
}

type EncodedPosition = EncodedGeographicPosition | EncodedLocalPosition;

interface EncodedRawPositionSample {
  readonly schema: typeof SQLITE_RAW_SAMPLE_PAYLOAD_FORMAT;
  readonly id: string;
  readonly recordedAtMs: string;
  readonly source: PositionSource;
  readonly position: EncodedPosition;
  readonly horizontalAccuracyMeters?: string;
  readonly headingDegrees?: string;
  readonly speedMetersPerSecond?: string;
  readonly confidence: string;
}

const POSITION_SOURCES = new Set<PositionSource>([
  "gnss",
  "pdr",
  "manual",
  "simulation",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertExactKeys(
  record: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  path: string,
): void {
  const allowed = new Set([...required, ...optional]);
  for (const key of required) {
    if (!(key in record)) {
      throw new SqliteRawSamplePayloadError(
        "invalid-field",
        `${path}.${key} is required.`,
        `${path}.${key}`,
      );
    }
  }
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      throw new SqliteRawSamplePayloadError(
        "invalid-field",
        `${path}.${key} is not part of ${SQLITE_RAW_SAMPLE_PAYLOAD_FORMAT}.`,
        `${path}.${key}`,
      );
    }
  }
}

function requiredString(
  record: Record<string, unknown>,
  key: string,
  path: string,
): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new SqliteRawSamplePayloadError(
      "invalid-field",
      `${path}.${key} must be a non-empty string.`,
      `${path}.${key}`,
    );
  }
  return value;
}

function decodeNumberToken(
  record: Record<string, unknown>,
  key: string,
  path: string,
): number {
  const token = record[key];
  if (typeof token !== "string") {
    throw new SqliteRawSamplePayloadError(
      "invalid-field",
      `${path}.${key} must be an encoded number string.`,
      `${path}.${key}`,
    );
  }
  try {
    return decodePersonalMapBundleNumber(token);
  } catch (error) {
    if (error instanceof PersonalMapBundleNumberDecodeError) {
      throw new SqliteRawSamplePayloadError(
        "invalid-number-token",
        `${path}.${key} contains a non-canonical number token.`,
        `${path}.${key}`,
      );
    }
    throw error;
  }
}

function decodeOptionalNumberToken(
  record: Record<string, unknown>,
  key: string,
  path: string,
): number | undefined {
  return record[key] === undefined
    ? undefined
    : decodeNumberToken(record, key, path);
}

function encodePosition(sample: RawPositionSample): EncodedPosition {
  const position = sample.position;
  if (position.kind === "geographic") {
    return {
      kind: "geographic",
      latitude: encodePersonalMapBundleNumber(position.latitude),
      longitude: encodePersonalMapBundleNumber(position.longitude),
      ...(position.altitudeMeters === undefined
        ? {}
        : {
            altitudeMeters: encodePersonalMapBundleNumber(
              position.altitudeMeters,
            ),
          }),
    };
  }
  return {
    kind: "local",
    xMeters: encodePersonalMapBundleNumber(position.xMeters),
    yMeters: encodePersonalMapBundleNumber(position.yMeters),
    ...(position.floor === undefined
      ? {}
      : { floor: encodePersonalMapBundleNumber(position.floor) }),
  };
}

function decodePosition(value: unknown): RawPositionSample["position"] {
  const path = "$.position";
  if (!isRecord(value)) {
    throw new SqliteRawSamplePayloadError(
      "invalid-field",
      `${path} must be an object.`,
      path,
    );
  }

  if (value.kind === "geographic") {
    assertExactKeys(
      value,
      ["kind", "latitude", "longitude"],
      ["altitudeMeters"],
      path,
    );
    const altitudeMeters = decodeOptionalNumberToken(
      value,
      "altitudeMeters",
      path,
    );
    return {
      kind: "geographic",
      latitude: decodeNumberToken(value, "latitude", path),
      longitude: decodeNumberToken(value, "longitude", path),
      ...(altitudeMeters === undefined ? {} : { altitudeMeters }),
    };
  }

  if (value.kind === "local") {
    assertExactKeys(value, ["kind", "xMeters", "yMeters"], ["floor"], path);
    const floor = decodeOptionalNumberToken(value, "floor", path);
    return {
      kind: "local",
      xMeters: decodeNumberToken(value, "xMeters", path),
      yMeters: decodeNumberToken(value, "yMeters", path),
      ...(floor === undefined ? {} : { floor }),
    };
  }

  throw new SqliteRawSamplePayloadError(
    "invalid-field",
    `${path}.kind must be geographic or local.`,
    `${path}.kind`,
  );
}

/**
 * Serializes the provider observation before SQLite numeric affinity can
 * normalize NaN or negative zero. Every number uses the bundle's canonical
 * ECMAScript token so storage and lossless backup share one exact semantics.
 */
export function encodeSqliteRawSamplePayload(
  sample: RawPositionSample,
): string {
  if (sample.id.length === 0) {
    throw new SqliteRawSamplePayloadError(
      "invalid-field",
      "$.id must be a non-empty string.",
      "$.id",
    );
  }
  if (!POSITION_SOURCES.has(sample.source)) {
    throw new SqliteRawSamplePayloadError(
      "invalid-field",
      "$.source is unsupported.",
      "$.source",
    );
  }

  const payload: EncodedRawPositionSample = {
    schema: SQLITE_RAW_SAMPLE_PAYLOAD_FORMAT,
    id: sample.id,
    recordedAtMs: encodePersonalMapBundleNumber(sample.recordedAtMs),
    source: sample.source,
    position: encodePosition(sample),
    ...(sample.horizontalAccuracyMeters === undefined
      ? {}
      : {
          horizontalAccuracyMeters: encodePersonalMapBundleNumber(
            sample.horizontalAccuracyMeters,
          ),
        }),
    ...(sample.headingDegrees === undefined
      ? {}
      : {
          headingDegrees: encodePersonalMapBundleNumber(
            sample.headingDegrees,
          ),
        }),
    ...(sample.speedMetersPerSecond === undefined
      ? {}
      : {
          speedMetersPerSecond: encodePersonalMapBundleNumber(
            sample.speedMetersPerSecond,
          ),
        }),
    confidence: encodePersonalMapBundleNumber(sample.confidence),
  };
  return JSON.stringify(payload);
}

/** Restores an exact raw observation from the canonical SQLite payload. */
export function decodeSqliteRawSamplePayload(
  content: string,
): RawPositionSample {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch (error) {
    throw new SqliteRawSamplePayloadError(
      "invalid-json",
      `Exact raw payload is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      "$",
    );
  }
  if (!isRecord(value)) {
    throw new SqliteRawSamplePayloadError(
      "invalid-json",
      "Exact raw payload must be a JSON object.",
      "$",
    );
  }

  assertExactKeys(
    value,
    ["schema", "id", "recordedAtMs", "source", "position", "confidence"],
    [
      "horizontalAccuracyMeters",
      "headingDegrees",
      "speedMetersPerSecond",
    ],
    "$",
  );
  if (value.schema !== SQLITE_RAW_SAMPLE_PAYLOAD_FORMAT) {
    throw new SqliteRawSamplePayloadError(
      "invalid-schema",
      "Exact raw payload schema is unsupported.",
      "$.schema",
    );
  }

  const source = requiredString(value, "source", "$") as PositionSource;
  if (!POSITION_SOURCES.has(source)) {
    throw new SqliteRawSamplePayloadError(
      "invalid-field",
      "$.source is unsupported.",
      "$.source",
    );
  }

  const horizontalAccuracyMeters = decodeOptionalNumberToken(
    value,
    "horizontalAccuracyMeters",
    "$",
  );
  const headingDegrees = decodeOptionalNumberToken(
    value,
    "headingDegrees",
    "$",
  );
  const speedMetersPerSecond = decodeOptionalNumberToken(
    value,
    "speedMetersPerSecond",
    "$",
  );

  return {
    id: requiredString(value, "id", "$"),
    recordedAtMs: decodeNumberToken(value, "recordedAtMs", "$"),
    source,
    position: decodePosition(value.position),
    ...(horizontalAccuracyMeters === undefined
      ? {}
      : { horizontalAccuracyMeters }),
    ...(headingDegrees === undefined ? {} : { headingDegrees }),
    ...(speedMetersPerSecond === undefined
      ? {}
      : { speedMetersPerSecond }),
    confidence: decodeNumberToken(value, "confidence", "$"),
  };
}
