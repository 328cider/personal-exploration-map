import type {
  StagedPersonalMapBundleImport,
} from "./personalMapBundleStaging.ts";

export type PersonalMapRestoreCollisionKind =
  | "personal-map"
  | "exploration"
  | "raw-sample"
  | "marker";

export interface RawSampleRestoreIdentity {
  readonly explorationId: string;
  readonly sampleId: string;
}

export type PersonalMapRestoreCollision =
  | {
      readonly kind: "personal-map";
      readonly id: string;
    }
  | {
      readonly kind: "exploration";
      readonly id: string;
    }
  | {
      readonly kind: "raw-sample";
      readonly explorationId: string;
      readonly id: string;
    }
  | {
      readonly kind: "marker";
      readonly id: string;
    };

/**
 * Read-only batch queries required before a `restore-new` transaction.
 * Implementations must return only identities present in the supplied batch.
 */
export interface PersonalMapRestoreCollisionPort {
  findExistingPersonalMapIds(
    candidateIds: readonly string[],
  ): Promise<readonly string[]>;
  findExistingExplorationIds(
    candidateIds: readonly string[],
  ): Promise<readonly string[]>;
  findExistingRawSampleIdentities(
    candidates: readonly RawSampleRestoreIdentity[],
  ): Promise<readonly RawSampleRestoreIdentity[]>;
  findExistingMarkerIds(
    candidateIds: readonly string[],
  ): Promise<readonly string[]>;
}

export type PersonalMapRestorePreflightErrorCode =
  | "identity-collision"
  | "invalid-collision-port-result";

export class PersonalMapRestorePreflightError extends Error {
  readonly code: PersonalMapRestorePreflightErrorCode;
  readonly collisions: readonly PersonalMapRestoreCollision[];

  constructor(
    code: PersonalMapRestorePreflightErrorCode,
    message: string,
    collisions: readonly PersonalMapRestoreCollision[] = [],
  ) {
    super(message);
    this.name = "PersonalMapRestorePreflightError";
    this.code = code;
    this.collisions = collisions;
  }
}

export interface PersonalMapRestoreNewPlan {
  readonly mode: "restore-new";
  readonly personalMapId: string;
  readonly explorationIds: readonly string[];
  readonly rawSampleCount: number;
  readonly markerCount: number;
  readonly frameKind: StagedPersonalMapBundleImport["frameAtExport"]["kind"];
  readonly replayRequired: true;
}

const COLLISION_KIND_ORDER: Readonly<
  Record<PersonalMapRestoreCollisionKind, number>
> = {
  "personal-map": 0,
  exploration: 1,
  "raw-sample": 2,
  marker: 3,
};

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((first, second) =>
    first.localeCompare(second),
  );
}

function rawIdentityKey(identity: RawSampleRestoreIdentity): string {
  // Length-prefixing avoids delimiter collisions for arbitrary private IDs.
  return `${identity.explorationId.length}:${identity.explorationId}${identity.sampleId}`;
}

function uniqueSortedRawIdentities(
  values: readonly RawSampleRestoreIdentity[],
): RawSampleRestoreIdentity[] {
  const byKey = new Map<string, RawSampleRestoreIdentity>();
  for (const value of values) {
    byKey.set(rawIdentityKey(value), value);
  }
  return [...byKey.values()].sort(
    (first, second) =>
      first.explorationId.localeCompare(second.explorationId) ||
      first.sampleId.localeCompare(second.sampleId),
  );
}

function assertReturnedStringSubset(
  category: PersonalMapRestoreCollisionKind,
  candidates: readonly string[],
  returned: readonly string[],
): string[] {
  const allowed = new Set(candidates);
  const normalized = uniqueSorted(returned);
  const unexpected = normalized.find((value) => !allowed.has(value));
  if (unexpected !== undefined) {
    throw new PersonalMapRestorePreflightError(
      "invalid-collision-port-result",
      `Collision port returned an unrequested ${category} identity.`,
    );
  }
  return normalized;
}

function assertReturnedRawSubset(
  candidates: readonly RawSampleRestoreIdentity[],
  returned: readonly RawSampleRestoreIdentity[],
): RawSampleRestoreIdentity[] {
  const allowed = new Set(candidates.map(rawIdentityKey));
  const normalized = uniqueSortedRawIdentities(returned);
  const unexpected = normalized.find(
    (value) => !allowed.has(rawIdentityKey(value)),
  );
  if (unexpected !== undefined) {
    throw new PersonalMapRestorePreflightError(
      "invalid-collision-port-result",
      "Collision port returned an unrequested raw-sample identity.",
    );
  }
  return normalized;
}

function sortCollisions(
  collisions: readonly PersonalMapRestoreCollision[],
): PersonalMapRestoreCollision[] {
  return [...collisions].sort((first, second) => {
    const kindDifference =
      COLLISION_KIND_ORDER[first.kind] - COLLISION_KIND_ORDER[second.kind];
    if (kindDifference !== 0) {
      return kindDifference;
    }
    if (first.kind === "raw-sample" && second.kind === "raw-sample") {
      return (
        first.explorationId.localeCompare(second.explorationId) ||
        first.id.localeCompare(second.id)
      );
    }
    return first.id.localeCompare(second.id);
  });
}

/**
 * Performs all read-only identity checks required by restore-new.
 *
 * No repository write capability is accepted. A transaction adapter must call
 * this function before opening a canonical write transaction, then treat the
 * returned plan as invalid if concurrent writers can change identity state.
 */
export async function preflightPersonalMapRestoreNew(
  staged: StagedPersonalMapBundleImport,
  port: PersonalMapRestoreCollisionPort,
): Promise<PersonalMapRestoreNewPlan> {
  const personalMapIds = [staged.personalMap.id];
  const explorationIds = uniqueSorted(
    staged.explorations.map((item) => item.record.id),
  );
  const rawIdentities = uniqueSortedRawIdentities(
    staged.explorations.flatMap((item) =>
      item.rawSamples.map((sample) => ({
        explorationId: item.record.id,
        sampleId: sample.id,
      })),
    ),
  );
  const markerIds = uniqueSorted(
    staged.explorations.flatMap((item) =>
      item.markers.map((marker) => marker.id),
    ),
  );

  const [
    existingPersonalMapIdsRaw,
    existingExplorationIdsRaw,
    existingRawIdentitiesRaw,
    existingMarkerIdsRaw,
  ] = await Promise.all([
    port.findExistingPersonalMapIds(personalMapIds),
    port.findExistingExplorationIds(explorationIds),
    port.findExistingRawSampleIdentities(rawIdentities),
    port.findExistingMarkerIds(markerIds),
  ]);

  const existingPersonalMapIds = assertReturnedStringSubset(
    "personal-map",
    personalMapIds,
    existingPersonalMapIdsRaw,
  );
  const existingExplorationIds = assertReturnedStringSubset(
    "exploration",
    explorationIds,
    existingExplorationIdsRaw,
  );
  const existingRawIdentities = assertReturnedRawSubset(
    rawIdentities,
    existingRawIdentitiesRaw,
  );
  const existingMarkerIds = assertReturnedStringSubset(
    "marker",
    markerIds,
    existingMarkerIdsRaw,
  );

  const collisions = sortCollisions([
    ...existingPersonalMapIds.map((id) => ({
      kind: "personal-map" as const,
      id,
    })),
    ...existingExplorationIds.map((id) => ({
      kind: "exploration" as const,
      id,
    })),
    ...existingRawIdentities.map((identity) => ({
      kind: "raw-sample" as const,
      explorationId: identity.explorationId,
      id: identity.sampleId,
    })),
    ...existingMarkerIds.map((id) => ({
      kind: "marker" as const,
      id,
    })),
  ]);

  if (collisions.length > 0) {
    throw new PersonalMapRestorePreflightError(
      "identity-collision",
      `restore-new cannot start because ${collisions.length} canonical identity collision(s) exist.`,
      collisions,
    );
  }

  return {
    mode: "restore-new",
    personalMapId: staged.personalMap.id,
    explorationIds,
    rawSampleCount: rawIdentities.length,
    markerCount: markerIds.length,
    frameKind: staged.frameAtExport.kind,
    replayRequired: true,
  };
}
