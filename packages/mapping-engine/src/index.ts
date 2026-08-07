import type {
  CreatePersonalMapSnapshotInput,
  MapMarker,
  MappingEvent,
  PersonalMapSnapshot,
  Position,
  RawPositionSample,
} from "@exploration-map/mapping-core";

export interface CreatePersonalMapCommand {
  readonly name: string;
  readonly createdAtMs: number;
  readonly requestedId?: string;
}

export interface StartExplorationCommand {
  readonly personalMapId: string;
  readonly name: string;
  readonly startedAtMs: number;
  readonly trackingProviderId: string;
  readonly localFrameLabel?: string;
  readonly requestedId?: string;
}

export interface IngestPositionSamplesCommand {
  readonly personalMapId: string;
  readonly explorationId: string;
  readonly samples: readonly RawPositionSample[];
}

export interface AddMarkerCommand {
  readonly personalMapId: string;
  readonly explorationId: string;
  readonly marker: {
    readonly recordedAtMs: number;
    readonly category: MapMarker["category"];
    readonly label: string;
    readonly note?: string;
    readonly sourcePosition?: Position;
    readonly requestedId?: string;
  };
}

export interface EndExplorationCommand {
  readonly personalMapId: string;
  readonly explorationId: string;
  readonly endedAtMs: number;
}

export interface GetPersonalMapQuery {
  readonly personalMapId: string;
}

export interface PersonalMapListItem {
  readonly id: string;
  readonly name: string;
  readonly explorationCount: number;
  readonly updatedAtMs: number;
}

export interface IngestPositionSamplesResult {
  readonly acceptedSampleCount: number;
  readonly rejectedSampleCount: number;
}

export interface MappingEngineNotification {
  readonly personalMapId: string;
  readonly event: Readonly<MappingEvent>;
}

export type MappingEngineListener = (
  notification: MappingEngineNotification,
) => void;

/**
 * Stable application facade used by explorer and game applications.
 *
 * The facade intentionally does not expose mutable ExplorationSession objects
 * or low-level mapping-core mutation functions. Every map write is expressed
 * as an explicit command so invariants, persistence, and event publication can
 * be handled in one place.
 */
export interface MappingEngine {
  createPersonalMap(
    command: CreatePersonalMapCommand,
  ): Promise<{ readonly personalMapId: string }>;

  startExploration(
    command: StartExplorationCommand,
  ): Promise<{ readonly explorationId: string }>;

  ingestPositionSamples(
    command: IngestPositionSamplesCommand,
  ): Promise<IngestPositionSamplesResult>;

  addMarker(command: AddMarkerCommand): Promise<void>;

  endExploration(
    command: EndExplorationCommand,
  ): Promise<{ readonly map: PersonalMapSnapshot }>;

  getPersonalMap(
    query: GetPersonalMapQuery,
  ): Promise<PersonalMapSnapshot | null>;

  listPersonalMaps(): Promise<readonly PersonalMapListItem[]>;

  subscribe(listener: MappingEngineListener): () => void;
}

export interface StoredPersonalMap {
  readonly id: string;
  readonly name: string;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
}

export interface StoredExploration {
  readonly id: string;
  readonly personalMapId: string;
  readonly name: string;
  readonly startedAtMs: number;
  readonly endedAtMs?: number;
  readonly trackingProviderId: string;
  readonly localFrameLabel?: string;
}

/**
 * Persistence port. Implementations store canonical records and reconstruct
 * replay input; they must not make a persisted derived snapshot authoritative.
 */
export interface MappingRepositoryPort {
  createPersonalMap(record: StoredPersonalMap): Promise<void>;
  createExploration(record: StoredExploration): Promise<void>;
  appendPositionSamples(
    explorationId: string,
    samples: readonly RawPositionSample[],
  ): Promise<void>;
  appendMarker(
    explorationId: string,
    marker: AddMarkerCommand["marker"],
  ): Promise<void>;
  completeExploration(explorationId: string, endedAtMs: number): Promise<void>;
  loadPersonalMapReplayInput(
    personalMapId: string,
  ): Promise<CreatePersonalMapSnapshotInput | null>;
  listPersonalMaps(): Promise<readonly PersonalMapListItem[]>;
}

export interface TrackingRuntimeStatus {
  readonly running: boolean;
  readonly providerId: string | null;
  readonly explorationId: string | null;
}

/**
 * Platform boundary for GNSS, PDR, replay, or manual tracking providers.
 * A provider supplies observations; it never decides map truth or draws UI.
 */
export interface TrackingProviderPort {
  readonly id: string;
  start(input: {
    readonly personalMapId: string;
    readonly explorationId: string;
  }): Promise<void>;
  stop(explorationId: string): Promise<void>;
  status(): Promise<TrackingRuntimeStatus>;
}
