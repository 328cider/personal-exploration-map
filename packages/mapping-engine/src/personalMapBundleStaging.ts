import type {
  MapFrame,
  MapMarker,
  Position,
  RawPositionSample,
} from "@exploration-map/mapping-core";

import type {
  StoredExploration,
  StoredPersonalMap,
} from "./contracts.ts";
import {
  decodePersonalMapBundleNumber,
  PersonalMapBundleNumberDecodeError,
} from "./personalMapBundleNumber.ts";
import {
  validatePersonalMapBundle,
  type PersonalMapBundleArchiveFile,
  type PersonalMapBundleLogicalArchive,
  type ValidatedPersonalMapBundle,
} from "./personalMapBundleValidation.ts";
import type {
  PersonalMapBundleManifest,
  PersonalMapBundleSha256Port,
} from "./personalMapBundle.ts";

export type PersonalMapBundleStagingErrorCode =
  | "invalid-json-file"
  | "invalid-ndjson-file"
  | "missing-file"
  | "invalid-personal-map-record"
  | "invalid-exploration-record"
  | "invalid-frame"
  | "invalid-raw-sample"
  | "invalid-marker"
  | "invalid-number-token"
  | "duplicate-sample-id"
  | "duplicate-marker-id"
  | "inventory-mismatch";

export class PersonalMapBundleStagingError extends Error {
  readonly code: PersonalMapBundleStagingErrorCode;
  readonly path: string;
  readonly entityId: string | undefined;

  constructor(
    code: PersonalMapBundleStagingErrorCode,
    message: string,
    path: string,
    entityId?: string,
  ) {
    super(message);
    this.name = "PersonalMapBundleStagingError";
    this.code = code;
    this.path = path;
    this.entityId = entityId;
  }
}

export interface StagedPersonalMapBundleExploration {
  readonly record: StoredExploration;
  readonly rawSamples: readonly RawPositionSample[];
  readonly markers: readonly MapMarker[];
}

export interface StagedPersonalMapBundleImport {
  readonly manifest: PersonalMapBundleManifest;
  readonly validation: ValidatedPersonalMapBundle;
  readonly personalMap: StoredPersonalMap;
  readonly frameAtExport: MapFrame;
  /** Manifest order, which is deterministic export order. */
  readonly explorations: readonly StagedPersonalMapBundleExploration[];
}

const POSITION_SOURCES = new Set<RawPositionSample["source"]>([
  "gnss",
  "pdr",
  "manual",
  "simulation",
]);

const MARKER_CATEGORIES = new Set<MapMarker["category"]>([
  "interesting",
  "entrance",
  "junction",
  "stairs",
  "hazard",
  "blocked",
  "note",
  "custom",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fileMap(
  archive: PersonalMapBundleLogicalArchive,
): ReadonlyMap<string, PersonalMapBundleArchiveFile> {
  return new Map(archive.files.map((file) => [file.path, file]));
}

function requireFile(
  files: ReadonlyMap<string, PersonalMapBundleArchiveFile>,
  path: string,
): PersonalMapBundleArchiveFile {
  const file = files.get(path);
  if (file === undefined) {
    throw new PersonalMapBundleStagingError(
      "missing-file",
      `Validated archive is missing ${path}.`,
      path,
    );
  }
  return file;
}

function parseJsonObject(
  content: string,
  path: string,
): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch (error) {
    throw new PersonalMapBundleStagingError(
      "invalid-json-file",
      `Invalid JSON in ${path}: ${error instanceof Error ? error.message : String(error)}`,
      path,
    );
  }
  if (!isRecord(value)) {
    throw new PersonalMapBundleStagingError(
      "invalid-json-file",
      `${path} must contain a JSON object.`,
      path,
    );
  }
  return value;
}

function parseJsonArray(content: string, path: string): unknown[] {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch (error) {
    throw new PersonalMapBundleStagingError(
      "invalid-json-file",
      `Invalid JSON in ${path}: ${error instanceof Error ? error.message : String(error)}`,
      path,
    );
  }
  if (!Array.isArray(value)) {
    throw new PersonalMapBundleStagingError(
      "invalid-json-file",
      `${path} must contain a JSON array.`,
      path,
    );
  }
  return value;
}

function parseNdjson(content: string, path: string): Record<string, unknown>[] {
  if (content.length === 0) {
    return [];
  }
  if (!content.endsWith("\n")) {
    throw new PersonalMapBundleStagingError(
      "invalid-ndjson-file",
      `${path} must end with a newline.`,
      path,
    );
  }
  return content
    .slice(0, -1)
    .split("\n")
    .map((line, index) => {
      let value: unknown;
      try {
        value = JSON.parse(line);
      } catch (error) {
        throw new PersonalMapBundleStagingError(
          "invalid-ndjson-file",
          `${path} line ${index + 1} is invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
          path,
        );
      }
      if (!isRecord(value)) {
        throw new PersonalMapBundleStagingError(
          "invalid-ndjson-file",
          `${path} line ${index + 1} must be a JSON object.`,
          path,
        );
      }
      return value;
    });
}

function requiredString(
  record: Record<string, unknown>,
  key: string,
  path: string,
  code: PersonalMapBundleStagingErrorCode,
  entityId?: string,
): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new PersonalMapBundleStagingError(
      code,
      `${path}.${key} must be a non-empty string.`,
      path,
      entityId,
    );
  }
  return value;
}

function optionalString(
  record: Record<string, unknown>,
  key: string,
  path: string,
  code: PersonalMapBundleStagingErrorCode,
  entityId?: string,
): string | undefined {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new PersonalMapBundleStagingError(
      code,
      `${path}.${key} must be a string when present.`,
      path,
      entityId,
    );
  }
  return value;
}

function decodeNumber(
  record: Record<string, unknown>,
  key: string,
  path: string,
  code: PersonalMapBundleStagingErrorCode,
  entityId?: string,
): number {
  const token = record[key];
  if (typeof token !== "string") {
    throw new PersonalMapBundleStagingError(
      code,
      `${path}.${key} must be an encoded number string.`,
      path,
      entityId,
    );
  }
  try {
    return decodePersonalMapBundleNumber(token);
  } catch (error) {
    if (error instanceof PersonalMapBundleNumberDecodeError) {
      throw new PersonalMapBundleStagingError(
        "invalid-number-token",
        `${path}.${key} contains a non-canonical number token.`,
        path,
        entityId,
      );
    }
    throw error;
  }
}

function optionalNumber(
  record: Record<string, unknown>,
  key: string,
  path: string,
  code: PersonalMapBundleStagingErrorCode,
  entityId?: string,
): number | undefined {
  return record[key] === undefined
    ? undefined
    : decodeNumber(record, key, path, code, entityId);
}

function finiteNumber(
  record: Record<string, unknown>,
  key: string,
  path: string,
  code: PersonalMapBundleStagingErrorCode,
  entityId?: string,
): number {
  const value = decodeNumber(record, key, path, code, entityId);
  if (!Number.isFinite(value)) {
    throw new PersonalMapBundleStagingError(
      code,
      `${path}.${key} must decode to a finite structural value.`,
      path,
      entityId,
    );
  }
  return value;
}

function optionalFiniteNumber(
  record: Record<string, unknown>,
  key: string,
  path: string,
  code: PersonalMapBundleStagingErrorCode,
  entityId?: string,
): number | undefined {
  if (record[key] === undefined) {
    return undefined;
  }
  return finiteNumber(record, key, path, code, entityId);
}

function parsePosition(
  value: unknown,
  path: string,
  code: PersonalMapBundleStagingErrorCode,
  entityId: string,
  allowNonFinite: boolean,
): Position {
  if (!isRecord(value)) {
    throw new PersonalMapBundleStagingError(
      code,
      `${path} must contain a position object.`,
      path,
      entityId,
    );
  }
  const number = allowNonFinite ? decodeNumber : finiteNumber;
  if (value.kind === "geographic") {
    const latitude = number(value, "latitude", path, code, entityId);
    const longitude = number(value, "longitude", path, code, entityId);
    if (
      !allowNonFinite &&
      (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180)
    ) {
      throw new PersonalMapBundleStagingError(
        code,
        `${path} contains an out-of-range geographic position.`,
        path,
        entityId,
      );
    }
    const altitudeMeters = allowNonFinite
      ? optionalNumber(value, "altitudeMeters", path, code, entityId)
      : optionalFiniteNumber(value, "altitudeMeters", path, code, entityId);
    return {
      kind: "geographic",
      latitude,
      longitude,
      ...(altitudeMeters === undefined ? {} : { altitudeMeters }),
    };
  }
  if (value.kind === "local") {
    const xMeters = number(value, "xMeters", path, code, entityId);
    const yMeters = number(value, "yMeters", path, code, entityId);
    const floor = allowNonFinite
      ? optionalNumber(value, "floor", path, code, entityId)
      : optionalFiniteNumber(value, "floor", path, code, entityId);
    return {
      kind: "local",
      xMeters,
      yMeters,
      ...(floor === undefined ? {} : { floor }),
    };
  }
  throw new PersonalMapBundleStagingError(
    code,
    `${path}.kind must be geographic or local.`,
    path,
    entityId,
  );
}

function parseFrame(value: unknown, path: string): MapFrame {
  if (!isRecord(value)) {
    throw new PersonalMapBundleStagingError(
      "invalid-frame",
      `${path} must contain a frame object.`,
      path,
    );
  }
  if (value.kind === "unresolved") {
    return { kind: "unresolved" };
  }
  if (value.kind === "local") {
    const label = optionalString(value, "label", path, "invalid-frame");
    return {
      kind: "local",
      ...(label === undefined ? {} : { label }),
    };
  }
  if (value.kind === "geographic-local") {
    const originLatitude = finiteNumber(
      value,
      "originLatitude",
      path,
      "invalid-frame",
    );
    const originLongitude = finiteNumber(
      value,
      "originLongitude",
      path,
      "invalid-frame",
    );
    if (
      originLatitude < -90 ||
      originLatitude > 90 ||
      originLongitude < -180 ||
      originLongitude > 180
    ) {
      throw new PersonalMapBundleStagingError(
        "invalid-frame",
        `${path} contains an out-of-range geographic origin.`,
        path,
      );
    }
    return {
      kind: "geographic-local",
      originLatitude,
      originLongitude,
    };
  }
  throw new PersonalMapBundleStagingError(
    "invalid-frame",
    `${path}.kind is unsupported.`,
    path,
  );
}

function parsePersonalMap(
  content: string,
  manifest: PersonalMapBundleManifest,
): { readonly record: StoredPersonalMap; readonly frame: MapFrame } {
  const path = "personal-map.json";
  const value = parseJsonObject(content, path);
  const id = requiredString(value, "id", path, "invalid-personal-map-record");
  if (id !== manifest.personalMapId) {
    throw new PersonalMapBundleStagingError(
      "inventory-mismatch",
      "personal-map.json id does not match manifest.personalMapId.",
      path,
      id,
    );
  }
  const createdAtMs = finiteNumber(
    value,
    "createdAtMs",
    path,
    "invalid-personal-map-record",
    id,
  );
  const updatedAtMs = finiteNumber(
    value,
    "updatedAtMs",
    path,
    "invalid-personal-map-record",
    id,
  );
  if (updatedAtMs < createdAtMs) {
    throw new PersonalMapBundleStagingError(
      "invalid-personal-map-record",
      "updatedAtMs cannot precede createdAtMs.",
      path,
      id,
    );
  }
  const frame = parseFrame(value.frameAtExport, `${path}.frameAtExport`);
  return {
    record: {
      id,
      name: requiredString(
        value,
        "name",
        path,
        "invalid-personal-map-record",
        id,
      ),
      createdAtMs,
      updatedAtMs,
    },
    frame,
  };
}

function parseExplorationRecord(
  content: string,
  path: string,
  manifest: PersonalMapBundleManifest,
  expectedId: string,
): StoredExploration {
  const value = parseJsonObject(content, path);
  const id = requiredString(value, "id", path, "invalid-exploration-record");
  if (id !== expectedId || value.personalMapId !== manifest.personalMapId) {
    throw new PersonalMapBundleStagingError(
      "inventory-mismatch",
      `${path} identity or PersonalMap membership does not match the manifest.`,
      path,
      id,
    );
  }
  const startedAtMs = finiteNumber(
    value,
    "startedAtMs",
    path,
    "invalid-exploration-record",
    id,
  );
  const endedAtMs = optionalFiniteNumber(
    value,
    "endedAtMs",
    path,
    "invalid-exploration-record",
    id,
  );
  if (endedAtMs !== undefined && endedAtMs < startedAtMs) {
    throw new PersonalMapBundleStagingError(
      "invalid-exploration-record",
      `${path}.endedAtMs cannot precede startedAtMs.`,
      path,
      id,
    );
  }
  const localFrameLabel = optionalString(
    value,
    "localFrameLabel",
    path,
    "invalid-exploration-record",
    id,
  );
  return {
    id,
    personalMapId: manifest.personalMapId,
    name: requiredString(
      value,
      "name",
      path,
      "invalid-exploration-record",
      id,
    ),
    startedAtMs,
    ...(endedAtMs === undefined ? {} : { endedAtMs }),
    trackingProviderId: requiredString(
      value,
      "trackingProviderId",
      path,
      "invalid-exploration-record",
      id,
    ),
    ...(localFrameLabel === undefined ? {} : { localFrameLabel }),
  };
}

function parseRawSample(
  value: Record<string, unknown>,
  path: string,
): RawPositionSample {
  const id = requiredString(value, "id", path, "invalid-raw-sample");
  const source = value.source;
  if (typeof source !== "string" || !POSITION_SOURCES.has(source as RawPositionSample["source"])) {
    throw new PersonalMapBundleStagingError(
      "invalid-raw-sample",
      `${path}.source is unsupported.`,
      path,
      id,
    );
  }
  const horizontalAccuracyMeters = optionalNumber(
    value,
    "horizontalAccuracyMeters",
    path,
    "invalid-raw-sample",
    id,
  );
  const headingDegrees = optionalNumber(
    value,
    "headingDegrees",
    path,
    "invalid-raw-sample",
    id,
  );
  const speedMetersPerSecond = optionalNumber(
    value,
    "speedMetersPerSecond",
    path,
    "invalid-raw-sample",
    id,
  );
  return {
    id,
    recordedAtMs: decodeNumber(
      value,
      "recordedAtMs",
      path,
      "invalid-raw-sample",
      id,
    ),
    source: source as RawPositionSample["source"],
    position: parsePosition(
      value.position,
      `${path}.position`,
      "invalid-raw-sample",
      id,
      true,
    ),
    ...(horizontalAccuracyMeters === undefined
      ? {}
      : { horizontalAccuracyMeters }),
    ...(headingDegrees === undefined ? {} : { headingDegrees }),
    ...(speedMetersPerSecond === undefined
      ? {}
      : { speedMetersPerSecond }),
    confidence: decodeNumber(
      value,
      "confidence",
      path,
      "invalid-raw-sample",
      id,
    ),
  };
}

function parseMarker(value: unknown, path: string): MapMarker {
  if (!isRecord(value)) {
    throw new PersonalMapBundleStagingError(
      "invalid-marker",
      `${path} must contain a marker object.`,
      path,
    );
  }
  const id = requiredString(value, "id", path, "invalid-marker");
  const category = value.category;
  if (typeof category !== "string" || !MARKER_CATEGORIES.has(category as MapMarker["category"])) {
    throw new PersonalMapBundleStagingError(
      "invalid-marker",
      `${path}.category is unsupported.`,
      path,
      id,
    );
  }
  const note = optionalString(value, "note", path, "invalid-marker", id);
  const xMeters = optionalFiniteNumber(
    value,
    "xMeters",
    path,
    "invalid-marker",
    id,
  );
  const yMeters = optionalFiniteNumber(
    value,
    "yMeters",
    path,
    "invalid-marker",
    id,
  );
  const sourcePosition =
    value.sourcePosition === undefined
      ? undefined
      : parsePosition(
          value.sourcePosition,
          `${path}.sourcePosition`,
          "invalid-marker",
          id,
          false,
        );
  return {
    id,
    recordedAtMs: finiteNumber(
      value,
      "recordedAtMs",
      path,
      "invalid-marker",
      id,
    ),
    category: category as MapMarker["category"],
    label: requiredString(value, "label", path, "invalid-marker", id),
    ...(note === undefined ? {} : { note }),
    ...(xMeters === undefined ? {} : { xMeters }),
    ...(yMeters === undefined ? {} : { yMeters }),
    ...(sourcePosition === undefined ? {} : { sourcePosition }),
  };
}

/**
 * Validates and decodes a bundle into an immutable staged model. No repository
 * query or write occurs here; collision preflight and transaction are later
 * adapter/application responsibilities.
 */
export async function stagePersonalMapBundleImport(
  archive: PersonalMapBundleLogicalArchive,
  hasher: PersonalMapBundleSha256Port,
): Promise<StagedPersonalMapBundleImport> {
  const validation = await validatePersonalMapBundle(archive, hasher);
  const manifest = validation.manifest;
  const files = fileMap(archive);
  const personalMap = parsePersonalMap(
    requireFile(files, "personal-map.json").content,
    manifest,
  );
  if (JSON.stringify(personalMap.frame) !== JSON.stringify(parseFrame(manifest.frameAtExport, "manifest.frameAtExport"))) {
    throw new PersonalMapBundleStagingError(
      "inventory-mismatch",
      "personal-map.json frameAtExport does not match the manifest.",
      "personal-map.json",
      personalMap.record.id,
    );
  }

  const globalMarkerIds = new Set<string>();
  const explorations: StagedPersonalMapBundleExploration[] = [];
  for (const inventory of manifest.explorations) {
    const record = parseExplorationRecord(
      requireFile(files, inventory.recordPath).content,
      inventory.recordPath,
      manifest,
      inventory.id,
    );
    const sampleIds = new Set<string>();
    const rawSamples = parseNdjson(
      requireFile(files, inventory.rawObservationsPath).content,
      inventory.rawObservationsPath,
    ).map((value, index) => {
      const sample = parseRawSample(
        value,
        `${inventory.rawObservationsPath}#${index + 1}`,
      );
      if (sampleIds.has(sample.id)) {
        throw new PersonalMapBundleStagingError(
          "duplicate-sample-id",
          `Raw sample ${sample.id} is duplicated within ${record.id}.`,
          inventory.rawObservationsPath,
          sample.id,
        );
      }
      sampleIds.add(sample.id);
      return sample;
    });
    const markers = parseJsonArray(
      requireFile(files, inventory.markersPath).content,
      inventory.markersPath,
    ).map((value, index) => {
      const marker = parseMarker(value, `${inventory.markersPath}#${index + 1}`);
      if (globalMarkerIds.has(marker.id)) {
        throw new PersonalMapBundleStagingError(
          "duplicate-marker-id",
          `Marker ${marker.id} is duplicated in the bundle.`,
          inventory.markersPath,
          marker.id,
        );
      }
      globalMarkerIds.add(marker.id);
      return marker;
    });
    if (
      rawSamples.length !== inventory.rawSampleCount ||
      markers.length !== inventory.markerCount
    ) {
      throw new PersonalMapBundleStagingError(
        "inventory-mismatch",
        `Decoded counts for ${record.id} do not match the manifest.`,
        inventory.recordPath,
        record.id,
      );
    }
    explorations.push({ record, rawSamples, markers });
  }

  return {
    manifest,
    validation,
    personalMap: personalMap.record,
    frameAtExport: personalMap.frame,
    explorations,
  };
}
