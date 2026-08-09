import type {
  MapFrame,
  MapMarker,
  RawPositionSample,
} from "@exploration-map/mapping-core";

import type {
  StoredExploration,
  StoredPersonalMap,
} from "./contracts.ts";
import type {
  PersonalMapBundleExportInput,
  PersonalMapBundleProducer,
} from "./personalMapBundle.ts";

export interface PersonalMapBundleRawSampleGroup {
  readonly explorationId: string;
  readonly samples: readonly RawPositionSample[];
}

export interface PersonalMapBundleMarkerGroup {
  readonly explorationId: string;
  readonly markers: readonly MapMarker[];
}

/** Queries available only while one consistent read transaction is held. */
export interface PersonalMapBundleReadSnapshotPort {
  loadPersonalMapRecord(
    personalMapId: string,
  ): Promise<StoredPersonalMap | null>;
  loadFrameAtExport(personalMapId: string): Promise<MapFrame>;
  listExplorationRecords(
    personalMapId: string,
  ): Promise<readonly StoredExploration[]>;
  loadRawSampleGroups(
    explorationIds: readonly string[],
  ): Promise<readonly PersonalMapBundleRawSampleGroup[]>;
  loadMarkerGroups(
    explorationIds: readonly string[],
  ): Promise<readonly PersonalMapBundleMarkerGroup[]>;
}

/**
 * Read-only repository surface for producing a logical lossless bundle input.
 * Tracking can append evidence concurrently, so all queries must run against
 * one adapter-owned database snapshot/read transaction.
 */
export interface PersonalMapBundleReadRepositoryPort {
  withConsistentRead<Result>(
    operation: (
      reader: PersonalMapBundleReadSnapshotPort,
    ) => Promise<Result>,
  ): Promise<Result>;
}

export type PersonalMapBundleReadErrorCode =
  | "personal-map-not-found"
  | "record-id-mismatch"
  | "duplicate-exploration-id"
  | "unexpected-evidence-group"
  | "duplicate-evidence-group"
  | "missing-evidence-group";

export class PersonalMapBundleReadError extends Error {
  readonly code: PersonalMapBundleReadErrorCode;
  readonly entityId: string;

  constructor(
    code: PersonalMapBundleReadErrorCode,
    message: string,
    entityId: string,
  ) {
    super(message);
    this.name = "PersonalMapBundleReadError";
    this.code = code;
    this.entityId = entityId;
  }
}

export interface LoadPersonalMapBundleExportInputOptions {
  readonly personalMapId: string;
  readonly producer?: PersonalMapBundleProducer;
}

function orderedExplorations(
  personalMapId: string,
  records: readonly StoredExploration[],
): StoredExploration[] {
  const ids = new Set<string>();
  for (const record of records) {
    if (record.personalMapId !== personalMapId) {
      throw new PersonalMapBundleReadError(
        "record-id-mismatch",
        `Exploration ${record.id} belongs to another PersonalMap.`,
        record.id,
      );
    }
    if (ids.has(record.id)) {
      throw new PersonalMapBundleReadError(
        "duplicate-exploration-id",
        `Exploration ${record.id} was returned more than once.`,
        record.id,
      );
    }
    ids.add(record.id);
  }
  return [...records].sort(
    (first, second) =>
      first.startedAtMs - second.startedAtMs ||
      first.id.localeCompare(second.id),
  );
}

function indexGroups<T>(
  kind: "raw samples" | "markers",
  expectedIds: readonly string[],
  groups: readonly {
    readonly explorationId: string;
    readonly values: readonly T[];
  }[],
): ReadonlyMap<string, readonly T[]> {
  const expected = new Set(expectedIds);
  const indexed = new Map<string, readonly T[]>();
  for (const group of groups) {
    if (!expected.has(group.explorationId)) {
      throw new PersonalMapBundleReadError(
        "unexpected-evidence-group",
        `Repository returned ${kind} for an unrequested exploration.`,
        group.explorationId,
      );
    }
    if (indexed.has(group.explorationId)) {
      throw new PersonalMapBundleReadError(
        "duplicate-evidence-group",
        `Repository returned more than one ${kind} group for an exploration.`,
        group.explorationId,
      );
    }
    indexed.set(group.explorationId, group.values);
  }
  for (const explorationId of expectedIds) {
    if (!indexed.has(explorationId)) {
      throw new PersonalMapBundleReadError(
        "missing-evidence-group",
        `Repository did not return a ${kind} group for an exploration.`,
        explorationId,
      );
    }
  }
  return indexed;
}

async function loadFromSnapshot(
  reader: PersonalMapBundleReadSnapshotPort,
  options: LoadPersonalMapBundleExportInputOptions,
): Promise<PersonalMapBundleExportInput> {
  const personalMap = await reader.loadPersonalMapRecord(
    options.personalMapId,
  );
  if (personalMap === null) {
    throw new PersonalMapBundleReadError(
      "personal-map-not-found",
      "The requested PersonalMap does not exist.",
      options.personalMapId,
    );
  }
  if (personalMap.id !== options.personalMapId) {
    throw new PersonalMapBundleReadError(
      "record-id-mismatch",
      "Repository returned a different PersonalMap record.",
      personalMap.id,
    );
  }

  // Keep native reads sequential inside the same snapshot. Expo SQLite-style
  // wrappers can release/reuse statements incorrectly when concurrent calls
  // overlap inside one transaction.
  const frameAtExport = await reader.loadFrameAtExport(options.personalMapId);
  const records = await reader.listExplorationRecords(options.personalMapId);
  const explorations = orderedExplorations(options.personalMapId, records);
  const explorationIds = explorations.map((record) => record.id);
  const rawGroups = await reader.loadRawSampleGroups(explorationIds);
  const markerGroups = await reader.loadMarkerGroups(explorationIds);
  const rawByExploration = indexGroups(
    "raw samples",
    explorationIds,
    rawGroups.map((group) => ({
      explorationId: group.explorationId,
      values: group.samples,
    })),
  );
  const markersByExploration = indexGroups(
    "markers",
    explorationIds,
    markerGroups.map((group) => ({
      explorationId: group.explorationId,
      values: group.markers,
    })),
  );

  return {
    personalMap,
    frameAtExport,
    explorations: explorations.map((record) => ({
      record,
      rawSamples: rawByExploration.get(record.id)!,
      markers: markersByExploration.get(record.id)!,
    })),
    ...(options.producer === undefined
      ? {}
      : { producer: options.producer }),
  };
}

/**
 * Loads canonical export evidence inside one consistent repository snapshot.
 * No files, hashes, write transaction, share sheet, or derived map are created.
 */
export function loadPersonalMapBundleExportInput(
  repository: PersonalMapBundleReadRepositoryPort,
  options: LoadPersonalMapBundleExportInputOptions,
): Promise<PersonalMapBundleExportInput> {
  return repository.withConsistentRead((reader) =>
    loadFromSnapshot(reader, options),
  );
}
