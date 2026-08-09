import {
  PERSONAL_MAP_BUNDLE_FORMAT,
  PERSONAL_MAP_BUNDLE_NUMBER_ENCODING,
  PERSONAL_MAP_BUNDLE_SCHEMA_VERSION,
  type PersonalMapBundleManifest,
  type PersonalMapBundleManifestFile,
  type PersonalMapBundleSha256Port,
} from "./personalMapBundle.ts";

export type PersonalMapBundleValidationErrorCode =
  | "invalid-manifest-json"
  | "unsupported-format"
  | "unsupported-schema-version"
  | "unsupported-number-encoding"
  | "unsafe-path"
  | "duplicate-path"
  | "duplicate-exploration-id"
  | "missing-file"
  | "unexpected-file"
  | "invalid-sha256"
  | "checksum-mismatch"
  | "byte-length-mismatch"
  | "invalid-json-file"
  | "invalid-ndjson-file"
  | "invalid-inventory"
  | "count-mismatch"
  | "privacy-boundary-invalid";

export class PersonalMapBundleValidationError extends Error {
  readonly code: PersonalMapBundleValidationErrorCode;
  readonly path: string | undefined;

  constructor(
    code: PersonalMapBundleValidationErrorCode,
    message: string,
    path?: string,
  ) {
    super(message);
    this.name = "PersonalMapBundleValidationError";
    this.code = code;
    this.path = path;
  }
}

export interface PersonalMapBundleArchiveFile {
  readonly path: string;
  readonly content: string;
}

export interface PersonalMapBundleLogicalArchive {
  readonly manifestContent: string;
  /** Content files only. `manifest.json` is supplied separately. */
  readonly files: readonly PersonalMapBundleArchiveFile[];
}

export interface ValidatedPersonalMapBundle {
  readonly manifest: PersonalMapBundleManifest;
  readonly personalMapId: string;
  readonly explorationCount: number;
  readonly rawSampleCount: number;
  readonly markerCount: number;
  readonly fileCount: number;
}

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonRecord(
  content: string,
  path: string,
): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch (error) {
    throw new PersonalMapBundleValidationError(
      "invalid-json-file",
      `Invalid JSON in ${path}: ${error instanceof Error ? error.message : String(error)}`,
      path,
    );
  }
  if (!isRecord(value)) {
    throw new PersonalMapBundleValidationError(
      "invalid-json-file",
      `${path} must contain a JSON object.`,
      path,
    );
  }
  return value;
}

function parseManifest(content: string): PersonalMapBundleManifest {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch (error) {
    throw new PersonalMapBundleValidationError(
      "invalid-manifest-json",
      `manifest.json is invalid: ${error instanceof Error ? error.message : String(error)}`,
      "manifest.json",
    );
  }
  if (!isRecord(value)) {
    throw new PersonalMapBundleValidationError(
      "invalid-manifest-json",
      "manifest.json must contain a JSON object.",
      "manifest.json",
    );
  }
  if (value.format !== PERSONAL_MAP_BUNDLE_FORMAT) {
    throw new PersonalMapBundleValidationError(
      "unsupported-format",
      `Unsupported bundle format: ${String(value.format)}.`,
      "manifest.json",
    );
  }
  if (value.schemaVersion !== PERSONAL_MAP_BUNDLE_SCHEMA_VERSION) {
    throw new PersonalMapBundleValidationError(
      "unsupported-schema-version",
      `Unsupported bundle schema version: ${String(value.schemaVersion)}.`,
      "manifest.json",
    );
  }
  if (value.numberEncoding !== PERSONAL_MAP_BUNDLE_NUMBER_ENCODING) {
    throw new PersonalMapBundleValidationError(
      "unsupported-number-encoding",
      `Unsupported number encoding: ${String(value.numberEncoding)}.`,
      "manifest.json",
    );
  }
  if (
    value.containsRawLocation !== true ||
    value.containsDerivedMap !== false ||
    value.containsGameState !== false ||
    value.replayRequired !== true ||
    value.fileHashAlgorithm !== "sha256"
  ) {
    throw new PersonalMapBundleValidationError(
      "privacy-boundary-invalid",
      "Manifest evidence/privacy flags do not match the lossless PersonalMap profile.",
      "manifest.json",
    );
  }
  if (
    typeof value.personalMapId !== "string" ||
    value.personalMapId.length === 0 ||
    !Array.isArray(value.explorations) ||
    !Array.isArray(value.files)
  ) {
    throw new PersonalMapBundleValidationError(
      "invalid-manifest-json",
      "Manifest inventory is incomplete.",
      "manifest.json",
    );
  }
  return value as unknown as PersonalMapBundleManifest;
}

function assertSafeRelativePath(path: string): void {
  if (
    path.length === 0 ||
    path.startsWith("/") ||
    path.startsWith("\\") ||
    path.includes("\\") ||
    path.includes("\0") ||
    path.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new PersonalMapBundleValidationError(
      "unsafe-path",
      `Bundle path is not a safe relative POSIX path: ${path}`,
      path,
    );
  }
}

function utf8ByteLength(value: string): number {
  let length = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    length +=
      codePoint <= 0x7f
        ? 1
        : codePoint <= 0x7ff
          ? 2
          : codePoint <= 0xffff
            ? 3
            : 4;
  }
  return length;
}

function parseNdjson(content: string, path: string): Record<string, unknown>[] {
  if (content.length === 0) {
    return [];
  }
  if (!content.endsWith("\n")) {
    throw new PersonalMapBundleValidationError(
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
        throw new PersonalMapBundleValidationError(
          "invalid-ndjson-file",
          `${path} line ${index + 1} is invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
          path,
        );
      }
      if (!isRecord(value)) {
        throw new PersonalMapBundleValidationError(
          "invalid-ndjson-file",
          `${path} line ${index + 1} must be a JSON object.`,
          path,
        );
      }
      return value;
    });
}

function parseJsonArray(content: string, path: string): unknown[] {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch (error) {
    throw new PersonalMapBundleValidationError(
      "invalid-json-file",
      `Invalid JSON in ${path}: ${error instanceof Error ? error.message : String(error)}`,
      path,
    );
  }
  if (!Array.isArray(value)) {
    throw new PersonalMapBundleValidationError(
      "invalid-json-file",
      `${path} must contain a JSON array.`,
      path,
    );
  }
  return value;
}

async function verifyFile(
  manifestFile: PersonalMapBundleManifestFile,
  archiveFile: PersonalMapBundleArchiveFile,
  hasher: PersonalMapBundleSha256Port,
): Promise<void> {
  assertSafeRelativePath(manifestFile.path);
  if (!SHA256_PATTERN.test(manifestFile.sha256)) {
    throw new PersonalMapBundleValidationError(
      "invalid-sha256",
      `Manifest contains an invalid SHA-256 for ${manifestFile.path}.`,
      manifestFile.path,
    );
  }
  const actualHash = (await hasher.sha256Utf8(archiveFile.content)).toLowerCase();
  if (!SHA256_PATTERN.test(actualHash)) {
    throw new PersonalMapBundleValidationError(
      "invalid-sha256",
      `Hasher returned an invalid SHA-256 for ${manifestFile.path}.`,
      manifestFile.path,
    );
  }
  if (actualHash !== manifestFile.sha256) {
    throw new PersonalMapBundleValidationError(
      "checksum-mismatch",
      `SHA-256 mismatch for ${manifestFile.path}.`,
      manifestFile.path,
    );
  }
  if (utf8ByteLength(archiveFile.content) !== manifestFile.byteLength) {
    throw new PersonalMapBundleValidationError(
      "byte-length-mismatch",
      `UTF-8 byte length mismatch for ${manifestFile.path}.`,
      manifestFile.path,
    );
  }
}

function expectedRole(
  files: ReadonlyMap<string, PersonalMapBundleManifestFile>,
  path: string,
  role: PersonalMapBundleManifestFile["role"],
): void {
  const file = files.get(path);
  if (file === undefined || file.role !== role) {
    throw new PersonalMapBundleValidationError(
      "invalid-inventory",
      `Manifest path ${path} is missing or has the wrong role; expected ${role}.`,
      path,
    );
  }
}

/**
 * Validates a logical bundle before any import transaction is allowed to run.
 * The function does not write canonical state and does not interpret derived
 * track, diagnostics, or game data.
 */
export async function validatePersonalMapBundle(
  archive: PersonalMapBundleLogicalArchive,
  hasher: PersonalMapBundleSha256Port,
): Promise<ValidatedPersonalMapBundle> {
  const manifest = parseManifest(archive.manifestContent);
  const archiveFiles = new Map<string, PersonalMapBundleArchiveFile>();
  for (const file of archive.files) {
    assertSafeRelativePath(file.path);
    if (archiveFiles.has(file.path)) {
      throw new PersonalMapBundleValidationError(
        "duplicate-path",
        `Archive contains duplicate path ${file.path}.`,
        file.path,
      );
    }
    archiveFiles.set(file.path, file);
  }

  const manifestFiles = new Map<string, PersonalMapBundleManifestFile>();
  for (const file of manifest.files) {
    assertSafeRelativePath(file.path);
    if (manifestFiles.has(file.path)) {
      throw new PersonalMapBundleValidationError(
        "duplicate-path",
        `Manifest contains duplicate path ${file.path}.`,
        file.path,
      );
    }
    manifestFiles.set(file.path, file);
  }

  for (const path of archiveFiles.keys()) {
    if (!manifestFiles.has(path)) {
      throw new PersonalMapBundleValidationError(
        "unexpected-file",
        `Archive contains unlisted file ${path}.`,
        path,
      );
    }
  }
  for (const [path, manifestFile] of manifestFiles) {
    const archiveFile = archiveFiles.get(path);
    if (archiveFile === undefined) {
      throw new PersonalMapBundleValidationError(
        "missing-file",
        `Archive is missing ${path}.`,
        path,
      );
    }
    await verifyFile(manifestFile, archiveFile, hasher);
  }

  expectedRole(manifestFiles, "personal-map.json", "personal-map");
  const personalMapFile = archiveFiles.get("personal-map.json")!;
  const personalMap = parseJsonRecord(personalMapFile.content, personalMapFile.path);
  if (personalMap.id !== manifest.personalMapId) {
    throw new PersonalMapBundleValidationError(
      "invalid-inventory",
      "personal-map.json id does not match manifest.personalMapId.",
      personalMapFile.path,
    );
  }

  const explorationIds = new Set<string>();
  const referencedPaths = new Set<string>(["personal-map.json"]);
  let rawSampleCount = 0;
  let markerCount = 0;

  for (const exploration of manifest.explorations) {
    if (
      typeof exploration.id !== "string" ||
      exploration.id.length === 0 ||
      explorationIds.has(exploration.id)
    ) {
      throw new PersonalMapBundleValidationError(
        "duplicate-exploration-id",
        `Exploration id is empty or duplicated: ${String(exploration.id)}.`,
        "manifest.json",
      );
    }
    explorationIds.add(exploration.id);

    expectedRole(manifestFiles, exploration.recordPath, "exploration");
    expectedRole(
      manifestFiles,
      exploration.rawObservationsPath,
      "raw-observations",
    );
    expectedRole(manifestFiles, exploration.markersPath, "confirmed-markers");
    referencedPaths.add(exploration.recordPath);
    referencedPaths.add(exploration.rawObservationsPath);
    referencedPaths.add(exploration.markersPath);

    const record = parseJsonRecord(
      archiveFiles.get(exploration.recordPath)!.content,
      exploration.recordPath,
    );
    if (
      record.id !== exploration.id ||
      record.personalMapId !== manifest.personalMapId
    ) {
      throw new PersonalMapBundleValidationError(
        "invalid-inventory",
        `Exploration record ${exploration.recordPath} does not match its manifest inventory.`,
        exploration.recordPath,
      );
    }

    const rawSamples = parseNdjson(
      archiveFiles.get(exploration.rawObservationsPath)!.content,
      exploration.rawObservationsPath,
    );
    const markers = parseJsonArray(
      archiveFiles.get(exploration.markersPath)!.content,
      exploration.markersPath,
    );
    if (rawSamples.length !== exploration.rawSampleCount) {
      throw new PersonalMapBundleValidationError(
        "count-mismatch",
        `Raw sample count mismatch for ${exploration.id}.`,
        exploration.rawObservationsPath,
      );
    }
    if (markers.length !== exploration.markerCount) {
      throw new PersonalMapBundleValidationError(
        "count-mismatch",
        `Marker count mismatch for ${exploration.id}.`,
        exploration.markersPath,
      );
    }
    rawSampleCount += rawSamples.length;
    markerCount += markers.length;
  }

  for (const path of manifestFiles.keys()) {
    if (!referencedPaths.has(path)) {
      throw new PersonalMapBundleValidationError(
        "invalid-inventory",
        `Manifest file ${path} is not referenced by the bundle profile.`,
        path,
      );
    }
  }

  return {
    manifest,
    personalMapId: manifest.personalMapId,
    explorationCount: manifest.explorations.length,
    rawSampleCount,
    markerCount,
    fileCount: manifest.files.length,
  };
}
