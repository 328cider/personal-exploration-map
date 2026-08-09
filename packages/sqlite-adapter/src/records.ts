import type {
  MapMarker,
  MarkerCategory,
  PositionSource,
  RawPositionSample,
} from "@exploration-map/mapping-core";
import type {
  StoredExploration,
  StoredPersonalMap,
} from "@exploration-map/mapping-engine";

import {
  decodeSqliteRawSamplePayload,
  SQLITE_RAW_SAMPLE_PAYLOAD_FORMAT,
} from "./rawSamplePayload.ts";

export const LEGACY_NORMALIZED_RAW_PAYLOAD_FORMAT =
  "legacy-normalized-v1" as const;

export type StoredRawPayloadFormat =
  | typeof SQLITE_RAW_SAMPLE_PAYLOAD_FORMAT
  | typeof LEGACY_NORMALIZED_RAW_PAYLOAD_FORMAT;

export type SampleOrdinalProvenance =
  | "ingest-sequence-v1"
  | "legacy-recorded-at-id-v1";

export interface PersonalMapRow {
  readonly id: string;
  readonly name: string;
  readonly created_at: number;
  readonly updated_at: number;
}

export interface ExplorationRow {
  readonly id: string;
  readonly personal_map_id: string;
  readonly name: string;
  readonly status: "recording" | "completed";
  readonly tracking_provider_id: string;
  readonly tracking_mode: "background" | "foreground" | "demo" | null;
  readonly frame_hint: string | null;
  readonly started_at: number;
  readonly ended_at: number | null;
  readonly created_at: number;
  readonly updated_at: number;
}

export interface PositionRow {
  readonly id: string;
  readonly exploration_id: string;
  readonly sample_ordinal: number;
  readonly ordinal_provenance: SampleOrdinalProvenance;
  readonly raw_payload_format: StoredRawPayloadFormat;
  readonly raw_payload_json: string | null;
  readonly recorded_at: number | null;
  readonly source: PositionSource;
  readonly coordinate_kind: "geographic" | "local";
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly altitude_meters: number | null;
  readonly x_meters: number | null;
  readonly y_meters: number | null;
  readonly floor_level: number | null;
  readonly horizontal_accuracy_meters: number | null;
  readonly heading_degrees: number | null;
  readonly speed_meters_per_second: number | null;
  readonly confidence: number | null;
}

export interface MarkerRow {
  readonly id: string;
  readonly exploration_id: string;
  readonly recorded_at: number;
  readonly category: MarkerCategory;
  readonly label: string;
  readonly note: string | null;
  readonly coordinate_kind: "geographic" | "local" | null;
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly altitude_meters: number | null;
  readonly x_meters: number | null;
  readonly y_meters: number | null;
  readonly floor_level: number | null;
}

export type SqliteRawEvidenceErrorCode =
  | "exact-payload-missing"
  | "exact-payload-identity-mismatch"
  | "legacy-normalized-evidence";

export class SqliteRawEvidenceError extends Error {
  readonly code: SqliteRawEvidenceErrorCode;

  constructor(code: SqliteRawEvidenceErrorCode, message: string) {
    super(message);
    this.name = "SqliteRawEvidenceError";
    this.code = code;
  }
}

export function rowToStoredPersonalMap(row: PersonalMapRow): StoredPersonalMap {
  return {
    id: row.id,
    name: row.name,
    createdAtMs: row.created_at,
    updatedAtMs: row.updated_at,
  };
}

export function rowToStoredExploration(row: ExplorationRow): StoredExploration {
  return {
    id: row.id,
    personalMapId: row.personal_map_id,
    name: row.name,
    startedAtMs: row.started_at,
    trackingProviderId: row.tracking_provider_id,
    ...(row.ended_at === null ? {} : { endedAtMs: row.ended_at }),
    ...(row.frame_hint === null ? {} : { localFrameLabel: row.frame_hint }),
  };
}

function legacyRowToSample(row: PositionRow): RawPositionSample | null {
  if (row.recorded_at === null || row.confidence === null) {
    return null;
  }

  const shared = {
    id: row.id,
    recordedAtMs: row.recorded_at,
    source: row.source,
    confidence: row.confidence,
    ...(row.horizontal_accuracy_meters === null
      ? {}
      : { horizontalAccuracyMeters: row.horizontal_accuracy_meters }),
    ...(row.heading_degrees === null
      ? {}
      : { headingDegrees: row.heading_degrees }),
    ...(row.speed_meters_per_second === null
      ? {}
      : { speedMetersPerSecond: row.speed_meters_per_second }),
  };

  if (
    row.coordinate_kind === "geographic" &&
    row.latitude !== null &&
    row.longitude !== null
  ) {
    return {
      ...shared,
      position: {
        kind: "geographic",
        latitude: row.latitude,
        longitude: row.longitude,
        ...(row.altitude_meters === null
          ? {}
          : { altitudeMeters: row.altitude_meters }),
      },
    };
  }

  if (
    row.coordinate_kind === "local" &&
    row.x_meters !== null &&
    row.y_meters !== null
  ) {
    return {
      ...shared,
      position: {
        kind: "local",
        xMeters: row.x_meters,
        yMeters: row.y_meters,
        ...(row.floor_level === null ? {} : { floor: row.floor_level }),
      },
    };
  }

  return null;
}

function exactRowToSample(row: PositionRow): RawPositionSample {
  if (row.raw_payload_json === null) {
    throw new SqliteRawEvidenceError(
      "exact-payload-missing",
      "An exact raw observation row is missing its payload.",
    );
  }
  const sample = decodeSqliteRawSamplePayload(row.raw_payload_json);
  if (
    sample.id !== row.id ||
    sample.source !== row.source ||
    sample.position.kind !== row.coordinate_kind
  ) {
    throw new SqliteRawEvidenceError(
      "exact-payload-identity-mismatch",
      "Exact raw payload identity does not match its canonical row.",
    );
  }
  return sample;
}

/**
 * Reconstructs replay evidence. New rows use the exact pre-normalization
 * payload; legacy rows retain their previous normalized projection without
 * pretending that lost NaN or negative-zero semantics can be recovered.
 */
export function rowToReplaySample(row: PositionRow): RawPositionSample | null {
  return row.raw_payload_format === SQLITE_RAW_SAMPLE_PAYLOAD_FORMAT
    ? exactRowToSample(row)
    : legacyRowToSample(row);
}

/** Requires exact original evidence for lossless bundle export. */
export function rowToExactSample(row: PositionRow): RawPositionSample {
  if (row.raw_payload_format !== SQLITE_RAW_SAMPLE_PAYLOAD_FORMAT) {
    throw new SqliteRawEvidenceError(
      "legacy-normalized-evidence",
      "Lossless export is unavailable because legacy normalized raw evidence is present.",
    );
  }
  return exactRowToSample(row);
}

export function rowToMarker(row: MarkerRow): MapMarker {
  const sourcePosition =
    row.coordinate_kind === "geographic" &&
    row.latitude !== null &&
    row.longitude !== null
      ? {
          kind: "geographic" as const,
          latitude: row.latitude,
          longitude: row.longitude,
          ...(row.altitude_meters === null
            ? {}
            : { altitudeMeters: row.altitude_meters }),
        }
      : row.coordinate_kind === "local" &&
          row.x_meters !== null &&
          row.y_meters !== null
        ? {
            kind: "local" as const,
            xMeters: row.x_meters,
            yMeters: row.y_meters,
            ...(row.floor_level === null ? {} : { floor: row.floor_level }),
          }
        : undefined;

  return {
    id: row.id,
    recordedAtMs: row.recorded_at,
    category: row.category,
    label: row.label,
    ...(row.note === null ? {} : { note: row.note }),
    ...(sourcePosition === undefined ? {} : { sourcePosition }),
    ...(row.x_meters === null ? {} : { xMeters: row.x_meters }),
    ...(row.y_meters === null ? {} : { yMeters: row.y_meters }),
  };
}
