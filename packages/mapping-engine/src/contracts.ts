import type {
  CreatePersonalMapSnapshotInput,
  MapMarker,
  MappingEvent,
  PersonalMapSnapshot,
  Position,
  RawPositionSample,
  ReplayExplorationInput,
} from "@exploration-map/mapping-core";

export const MAPPING_ENGINE_API_VERSION = "3" as const;

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
  readonly persistedSampleCount: number;
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
 * or low-level mapping-core mutation functions. Every canonical map write is
 * expressed as an explicit command so invariants, persistence, tracking, and
 * event publication can be handled in one controlled boundary.
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

export interface LoadedExploration {
  readonly record: StoredExploration;
  readonly replay: ReplayExplorationInput;
}

/**
 * Transaction-scoped canonical writer.
 *
 * The callback supplied to `runInTransaction` receives this writer so a real
 * SQLite implementation can execute every statement on the transaction object
 * rather than relying on ambient mutable transaction state.
 */
export interface MappingRepositoryWriter {
  createPersonalMap(record: StoredPersonalMap): Promise<void>;

  createExploration(record: StoredExploration): Promise<void>;

  deleteExploration(explorationId: string): Promise<void>;

  appendPositionSamples(
    explorationId: string,
    samples: readonly RawPositionSample[],
  ): Promise<readonly RawPositionSample[]>;

  appendMarker(explorationId: string, marker: MapMarker): Promise<boolean>;

  completeExploration(explorationId: string, endedAtMs: number): Promise<void>;
}

/**
 * Persistence port for canonical records.
 *
 * Implementations persist raw observations and confirmed markers, and rebuild
 * replay input. A cached derived snapshot must never become authoritative.
 * Methods that return a boolean or list report what was actually persisted so
 * duplicate callbacks can remain idempotent and do not publish duplicate map
 * events.
 */
export interface MappingRepositoryPort {
  runInTransaction<T>(
    operation: (writer: MappingRepositoryWriter) => Promise<T>,
  ): Promise<T>;

  loadExploration(
    personalMapId: string,
    explorationId: string,
  ): Promise<LoadedExploration | null>;

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

export type MappingEntityKind = "personal-map" | "exploration" | "marker";

export type MappingIdFactory = (kind: MappingEntityKind) => string;

export interface CreateMappingEngineOptions {
  readonly repository: MappingRepositoryPort;
  readonly trackingProviders: readonly TrackingProviderPort[];
  readonly idFactory: MappingIdFactory;
}
