import type {
  MapFrame,
  MapMarker,
  Position,
  RawPositionSample,
} from "@exploration-map/mapping-core";

import {
  MAPPING_ENGINE_API_VERSION,
  type StoredExploration,
  type StoredPersonalMap,
} from "./contracts.ts";

export const PERSONAL_MAP_BUNDLE_FORMAT =
  "personal-exploration-map-bundle" as const;
export const PERSONAL_MAP_BUNDLE_SCHEMA_VERSION = 1 as const;
export const PERSONAL_MAP_BUNDLE_NUMBER_ENCODING =
  "ecmascript-number-string-v1" as const;

export type PersonalMapBundleBuildErrorCode =
  | "invalid-export-timestamp"
  | "invalid-personal-map"
  | "invalid-exploration"
  | "duplicate-exploration-id"
  | "duplicate-sample-id"
  | "duplicate-marker-id"
  | "invalid-sha256";

export class PersonalMapBundleBuildError extends Error {
  readonly code: PersonalMapBundleBuildErrorCode;
  readonly entityId: string | undefined;

  constructor(
    code: PersonalMapBundleBuildErrorCode,
    message: string,
    entityId?: string,
  ) {
    super(message);
    this.name = "PersonalMapBundleBuildError";
    this.code = code;
    this.entityId = entityId;
  }
}

/**
 * Every JavaScript number is stored as a string so NaN, ±Infinity, and -0 in
 * rejected raw evidence survive JSON round-trips instead of becoming null/0.
 */
export type PersonalMapBundleNumber = string;

export interface PersonalMapBundleGeographicPosition {
  readonly kind: "geographic";
  readonly latitude: PersonalMapBundleNumber;
  readonly longitude: PersonalMapBundleNumber;
  readonly altitudeMeters?: PersonalMapBundleNumber;
}

export interface PersonalMapBundleLocalPosition {
  readonly kind: "local";
  readonly xMeters: PersonalMapBundleNumber;
  readonly yMeters: PersonalMapBundleNumber;
  readonly floor?: PersonalMapBundleNumber;
}

export type PersonalMapBundlePosition =
  | PersonalMapBundleGeographicPosition
  | PersonalMapBundleLocalPosition;

export interface PersonalMapBundleRawPositionSample {
  readonly id: string;
  readonly recordedAtMs: PersonalMapBundleNumber;
  readonly source: RawPositionSample["source"];
  readonly position: PersonalMapBundlePosition;
  readonly horizontalAccuracyMeters?: PersonalMapBundleNumber;
  readonly headingDegrees?: PersonalMapBundleNumber;
  readonly speedMetersPerSecond?: PersonalMapBundleNumber;
  readonly confidence: PersonalMapBundleNumber;
}

export interface PersonalMapBundleMarker {
  readonly id: string;
  readonly recordedAtMs: PersonalMapBundleNumber;
  readonly category: MapMarker["category"];
  readonly label: string;
  readonly note?: string;
  readonly xMeters?: PersonalMapBundleNumber;
  readonly yMeters?: PersonalMapBundleNumber;
  readonly sourcePosition?: PersonalMapBundlePosition;
}

export type PersonalMapBundleFrame =
  | { readonly kind: "unresolved" }
  | {
      readonly kind: "geographic-local";
      readonly originLatitude: PersonalMapBundleNumber;
      readonly originLongitude: PersonalMapBundleNumber;
    }
  | {
      readonly kind: "local";
      readonly label?: string;
    };

export interface PersonalMapBundleExplorationSource {
  readonly record: StoredExploration;
  /** Canonical raw observations in their persisted order. */
  readonly rawSamples: readonly RawPositionSample[];
  /** Confirmed marker evidence in its persisted order. */
  readonly markers: readonly MapMarker[];
}

export interface PersonalMapBundleProducer {
  readonly appVersion?: string;
  readonly appBuild?: string;
}

export interface PersonalMapBundleExportInput {
  readonly personalMap: StoredPersonalMap;
  /** Derived frame at export time, included as a validation hint, not raw truth. */
  readonly frameAtExport: MapFrame;
  readonly explorations: readonly PersonalMapBundleExplorationSource[];
  readonly producer?: PersonalMapBundleProducer;
}

/** Platform adapter for cryptographic hashing; mapping-engine imports no runtime. */
export interface PersonalMapBundleSha256Port {
  sha256Utf8(content: string): string | Promise<string>;
}

export type PersonalMapBundleFileRole =
  | "personal-map"
  | "exploration"
  | "raw-observations"
  | "confirmed-markers";

export interface PersonalMapBundleContentFile {
  readonly path: string;
  readonly role: PersonalMapBundleFileRole;
  readonly mediaType: "application/json" | "application/x-ndjson";
  readonly content: string;
  readonly byteLength: number;
  readonly sha256: string;
}

export interface PersonalMapBundleManifestFile {
  readonly path: string;
  readonly role: PersonalMapBundleFileRole;
  readonly mediaType: PersonalMapBundleContentFile["mediaType"];
  readonly byteLength: number;
  readonly sha256: string;
}

export interface PersonalMapBundleManifestExploration {
  readonly id: string;
  readonly recordPath: string;
  readonly rawObservationsPath: string;
  readonly markersPath: string;
  readonly rawSampleCount: number;
  readonly markerCount: number;
}

export interface PersonalMapBundleManifest {
  readonly format: typeof PERSONAL_MAP_BUNDLE_FORMAT;
  readonly schemaVersion: typeof PERSONAL_MAP_BUNDLE_SCHEMA_VERSION;
  readonly numberEncoding: typeof PERSONAL_MAP_BUNDLE_NUMBER_ENCODING;
  readonly exportedAt: string;
  readonly mappingEngineApiVersion: typeof MAPPING_ENGINE_API_VERSION;
  readonly producer?: PersonalMapBundleProducer;
  readonly personalMapId: string;
  readonly frameAtExport: PersonalMapBundleFrame;
  readonly containsRawLocation: true;
  readonly containsDerivedMap: false;
  readonly containsGameState: false;
  readonly replayRequired: true;
  readonly fileHashAlgorithm: "sha256";
  readonly explorations: readonly PersonalMapBundleManifestExploration[];
  readonly files: readonly PersonalMapBundleManifestFile[];
}

export interface PersonalMapBundleBuildResult {
  readonly manifest: PersonalMapBundleManifest;
  /** `manifest.json`; excluded from its own content-hash list. */
  readonly manifestContent: string;
  readonly files: readonly PersonalMapBundleContentFile[];
}

interface EncodedPersonalMapRecord {
  readonly id: string;
  readonly name: string;
  readonly createdAtMs: PersonalMapBundleNumber;
  readonly updatedAtMs: PersonalMapBundleNumber;
  readonly frameAtExport: PersonalMapBundleFrame;
}

interface EncodedExplorationRecord {
  readonly id: string;
  readonly personalMapId: string;
  readonly name: string;
  readonly startedAtMs: PersonalMapBundleNumber;
  readonly endedAtMs?: PersonalMapBundleNumber;
  readonly trackingProviderId: string;
  readonly localFrameLabel?: string;
}

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

export function encodePersonalMapBundleNumber(
  value: number,
): PersonalMapBundleNumber {
  if (Number.isNaN(value)) {
    return "NaN";
  }
  if (value === Number.POSITIVE_INFINITY) {
    return "+Infinity";
  }
  if (value === Number.NEGATIVE_INFINITY) {
    return "-Infinity";
  }
  if (Object.is(value, -0)) {
    return "-0";
  }
  return String(value);
}

function encodePosition(position: Position): PersonalMapBundlePosition {
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

function encodeFrame(frame: MapFrame): PersonalMapBundleFrame {
  if (frame.kind === "unresolved") {
    return { kind: "unresolved" };
  }
  if (frame.kind === "geographic-local") {
    return {
      kind: "geographic-local",
      originLatitude: encodePersonalMapBundleNumber(frame.originLatitude),
      originLongitude: encodePersonalMapBundleNumber(frame.originLongitude),
    };
  }
  return {
    kind: "local",
    ...(frame.label === undefined ? {} : { label: frame.label }),
  };
}

function encodeRawSample(
  sample: RawPositionSample,
): PersonalMapBundleRawPositionSample {
  return {
    id: sample.id,
    recordedAtMs: encodePersonalMapBundleNumber(sample.recordedAtMs),
    source: sample.source,
    position: encodePosition(sample.position),
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
          headingDegrees: encodePersonalMapBundleNumber(sample.headingDegrees),
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
}

function encodeMarker(marker: MapMarker): PersonalMapBundleMarker {
  return {
    id: marker.id,
    recordedAtMs: encodePersonalMapBundleNumber(marker.recordedAtMs),
    category: marker.category,
    label: marker.label,
    ...(marker.note === undefined ? {} : { note: marker.note }),
    ...(marker.xMeters === undefined
      ? {}
      : { xMeters: encodePersonalMapBundleNumber(marker.xMeters) }),
    ...(marker.yMeters === undefined
      ? {}
      : { yMeters: encodePersonalMapBundleNumber(marker.yMeters) }),
    ...(marker.sourcePosition === undefined
      ? {}
      : { sourcePosition: encodePosition(marker.sourcePosition) }),
  };
}

function stableJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function stableNdjson(values: readonly unknown[]): string {
  if (values.length === 0) {
    return "";
  }
  return `${values.map((value) => JSON.stringify(value)).join("\n")}\n`;
}

function utf8ByteLength(value: string): number {
  let length = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    if (codePoint <= 0x7f) {
      length += 1;
    } else if (codePoint <= 0x7ff) {
      length += 2;
    } else if (codePoint <= 0xffff) {
      length += 3;
    } else {
      length += 4;
    }
  }
  return length;
}

function requireNonEmpty(
  value: string,
  code: PersonalMapBundleBuildErrorCode,
  field: string,
  entityId?: string,
): void {
  if (value.trim().length === 0) {
    throw new PersonalMapBundleBuildError(
      code,
      `${field} must not be empty.`,
      entityId,
    );
  }
}

function requireFiniteStructuralTimestamp(
  value: number,
  code: PersonalMapBundleBuildErrorCode,
  field: string,
  entityId?: string,
): void {
  if (!Number.isFinite(value)) {
    throw new PersonalMapBundleBuildError(
      code,
      `${field} must be finite canonical metadata.`,
      entityId,
    );
  }
}

function validateInput(input: PersonalMapBundleExportInput): void {
  const map = input.personalMap;
  requireNonEmpty(map.id, "invalid-personal-map", "personalMap.id", map.id);
  requireNonEmpty(
    map.name,
    "invalid-personal-map",
    "personalMap.name",
    map.id,
  );
  requireFiniteStructuralTimestamp(
    map.createdAtMs,
    "invalid-personal-map",
    "personalMap.createdAtMs",
    map.id,
  );
  requireFiniteStructuralTimestamp(
    map.updatedAtMs,
    "invalid-personal-map",
    "personalMap.updatedAtMs",
    map.id,
  );
  if (map.updatedAtMs < map.createdAtMs) {
    throw new PersonalMapBundleBuildError(
      "invalid-personal-map",
      "personalMap.updatedAtMs cannot precede createdAtMs.",
      map.id,
    );
  }

  const explorationIds = new Set<string>();
  const markerIds = new Set<string>();
  for (const source of input.explorations) {
    const record = source.record;
    requireNonEmpty(
      record.id,
      "invalid-exploration",
      "exploration.id",
      record.id,
    );
    if (explorationIds.has(record.id)) {
      throw new PersonalMapBundleBuildError(
        "duplicate-exploration-id",
        `Exploration ${record.id} appears more than once.`,
        record.id,
      );
    }
    explorationIds.add(record.id);
    if (record.personalMapId !== map.id) {
      throw new PersonalMapBundleBuildError(
        "invalid-exploration",
        `Exploration ${record.id} belongs to a different PersonalMap.`,
        record.id,
      );
    }
    requireNonEmpty(
      record.name,
      "invalid-exploration",
      "exploration.name",
      record.id,
    );
    requireNonEmpty(
      record.trackingProviderId,
      "invalid-exploration",
      "exploration.trackingProviderId",
      record.id,
    );
    requireFiniteStructuralTimestamp(
      record.startedAtMs,
      "invalid-exploration",
      "exploration.startedAtMs",
      record.id,
    );
    if (record.endedAtMs !== undefined) {
      requireFiniteStructuralTimestamp(
        record.endedAtMs,
        "invalid-exploration",
        "exploration.endedAtMs",
        record.id,
      );
      if (record.endedAtMs < record.startedAtMs) {
        throw new PersonalMapBundleBuildError(
          "invalid-exploration",
          `Exploration ${record.id} ends before it starts.`,
          record.id,
        );
      }
    }

    const sampleIds = new Set<string>();
    for (const sample of source.rawSamples) {
      requireNonEmpty(
        sample.id,
        "duplicate-sample-id",
        "rawSample.id",
        record.id,
      );
      if (sampleIds.has(sample.id)) {
        throw new PersonalMapBundleBuildError(
          "duplicate-sample-id",
          `Raw sample ${sample.id} is duplicated in exploration ${record.id}.`,
          sample.id,
        );
      }
      sampleIds.add(sample.id);
    }

    for (const marker of source.markers) {
      requireNonEmpty(
        marker.id,
        "duplicate-marker-id",
        "marker.id",
        record.id,
      );
      if (markerIds.has(marker.id)) {
        throw new PersonalMapBundleBuildError(
          "duplicate-marker-id",
          `Marker ${marker.id} appears more than once in the PersonalMap bundle.`,
          marker.id,
        );
      }
      markerIds.add(marker.id);
    }
  }
}

function sortExplorations(
  sources: readonly PersonalMapBundleExplorationSource[],
): PersonalMapBundleExplorationSource[] {
  return [...sources].sort(
    (first, second) =>
      first.record.startedAtMs - second.record.startedAtMs ||
      first.record.id.localeCompare(second.record.id),
  );
}

function encodePersonalMap(
  input: PersonalMapBundleExportInput,
): EncodedPersonalMapRecord {
  return {
    id: input.personalMap.id,
    name: input.personalMap.name,
    createdAtMs: encodePersonalMapBundleNumber(
      input.personalMap.createdAtMs,
    ),
    updatedAtMs: encodePersonalMapBundleNumber(
      input.personalMap.updatedAtMs,
    ),
    frameAtExport: encodeFrame(input.frameAtExport),
  };
}

function encodeExploration(
  record: StoredExploration,
): EncodedExplorationRecord {
  return {
    id: record.id,
    personalMapId: record.personalMapId,
    name: record.name,
    startedAtMs: encodePersonalMapBundleNumber(record.startedAtMs),
    ...(record.endedAtMs === undefined
      ? {}
      : { endedAtMs: encodePersonalMapBundleNumber(record.endedAtMs) }),
    trackingProviderId: record.trackingProviderId,
    ...(record.localFrameLabel === undefined
      ? {}
      : { localFrameLabel: record.localFrameLabel }),
  };
}

async function hashContentFile(
  hasher: PersonalMapBundleSha256Port,
  file: Omit<PersonalMapBundleContentFile, "byteLength" | "sha256">,
): Promise<PersonalMapBundleContentFile> {
  const hash = (await hasher.sha256Utf8(file.content)).toLowerCase();
  if (!SHA256_PATTERN.test(hash)) {
    throw new PersonalMapBundleBuildError(
      "invalid-sha256",
      `Hasher returned an invalid SHA-256 value for ${file.path}.`,
      file.path,
    );
  }
  return {
    ...file,
    byteLength: utf8ByteLength(file.content),
    sha256: hash,
  };
}

function exportedAtIso(exportedAtMs: number): string {
  if (!Number.isFinite(exportedAtMs)) {
    throw new PersonalMapBundleBuildError(
      "invalid-export-timestamp",
      "exportedAtMs must be finite.",
    );
  }
  const value = new Date(exportedAtMs);
  if (Number.isNaN(value.getTime())) {
    throw new PersonalMapBundleBuildError(
      "invalid-export-timestamp",
      "exportedAtMs must be a valid timestamp.",
    );
  }
  return value.toISOString();
}

/**
 * Builds a logical lossless bundle. A platform adapter may write these entries
 * to a directory or ZIP, but it must not reinterpret, reorder, or upload them.
 */
export async function buildPersonalMapBundle(
  input: PersonalMapBundleExportInput,
  options: {
    readonly exportedAtMs: number;
    readonly hasher: PersonalMapBundleSha256Port;
  },
): Promise<PersonalMapBundleBuildResult> {
  validateInput(input);
  const exportedAt = exportedAtIso(options.exportedAtMs);
  const contentSources: Omit<
    PersonalMapBundleContentFile,
    "byteLength" | "sha256"
  >[] = [
    {
      path: "personal-map.json",
      role: "personal-map",
      mediaType: "application/json",
      content: stableJson(encodePersonalMap(input)),
    },
  ];
  const manifestExplorations: PersonalMapBundleManifestExploration[] = [];

  for (const [index, source] of sortExplorations(input.explorations).entries()) {
    const ordinal = String(index + 1).padStart(4, "0");
    const recordPath = `explorations/${ordinal}.json`;
    const rawObservationsPath = `observations/${ordinal}.ndjson`;
    const markersPath = `markers/${ordinal}.json`;

    contentSources.push(
      {
        path: recordPath,
        role: "exploration",
        mediaType: "application/json",
        content: stableJson(encodeExploration(source.record)),
      },
      {
        path: rawObservationsPath,
        role: "raw-observations",
        mediaType: "application/x-ndjson",
        content: stableNdjson(source.rawSamples.map(encodeRawSample)),
      },
      {
        path: markersPath,
        role: "confirmed-markers",
        mediaType: "application/json",
        content: stableJson(source.markers.map(encodeMarker)),
      },
    );
    manifestExplorations.push({
      id: source.record.id,
      recordPath,
      rawObservationsPath,
      markersPath,
      rawSampleCount: source.rawSamples.length,
      markerCount: source.markers.length,
    });
  }

  const files = await Promise.all(
    contentSources.map((file) => hashContentFile(options.hasher, file)),
  );
  const manifest: PersonalMapBundleManifest = {
    format: PERSONAL_MAP_BUNDLE_FORMAT,
    schemaVersion: PERSONAL_MAP_BUNDLE_SCHEMA_VERSION,
    numberEncoding: PERSONAL_MAP_BUNDLE_NUMBER_ENCODING,
    exportedAt,
    mappingEngineApiVersion: MAPPING_ENGINE_API_VERSION,
    ...(input.producer === undefined ? {} : { producer: input.producer }),
    personalMapId: input.personalMap.id,
    frameAtExport: encodeFrame(input.frameAtExport),
    containsRawLocation: true,
    containsDerivedMap: false,
    containsGameState: false,
    replayRequired: true,
    fileHashAlgorithm: "sha256",
    explorations: manifestExplorations,
    files: files.map(({ path, role, mediaType, byteLength, sha256 }) => ({
      path,
      role,
      mediaType,
      byteLength,
      sha256,
    })),
  };

  return {
    manifest,
    manifestContent: stableJson(manifest),
    files,
  };
}
