import type {
  CreatePersonalMapSnapshotInput,
  MapMarker,
  MappingEvent,
  PersonalMapSnapshot,
  Position,
  RawPositionSample,
  ReplayExplorationInput,
} from "@exploration-map/mapping-core";

export const MAPPING_ENGINE_API_VERSION = "5" as const;

export interface CreatePersonalMapCommand {
  readonly name: string;
  readonly createdAtMs: number;
  readonly requestedId?: string;
}

/**
 * Creates a PersonalMap and its first ExplorationSession as one application
 * use case. The two canonical records are written in one transaction, and the
 * whole provisional aggregate is conditionally compensated if provider start
 * fails before any evidence exists.
 */
export interface CreatePersonalMapWithFirstExplorationCommand {
  readonly personalMapName: string;
  readonly explorationName: string;
  readonly createdAtMs: number;
  readonly startedAtMs: number;
  readonly trackingProviderId: string;
  readonly localFrameLabel?: string;
  readonly requestedPersonalMapId?: string;
  readonly requestedExplorationId?: string;
}

export interface StartExplorationCommand {
  readonly personalMapId: string;
  readonly name: string;
  readonly startedAtMs: number;
  readonly trackingProviderId: string;
  /**
   * Stable identity of a local coordinate frame.
   *
   * Required for local providers and forbidden for geographic providers. Two
   * local explorations may share a PersonalMap only when this label matches,
   * until an explicit anchor-transform model is introduced.
   */
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

  createPersonalMapWithFirstExploration(
    command: CreatePersonalMapWithFirstExplorationCommand,
  ): Promise<{
    readonly personalMapId: string;
    readonly explorationId: string;
  }>;

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

  /**
   * Deletes a newly-created PersonalMap only when the named exploration is its
   * sole child, is still recording, and has no position samples or markers.
   *
   * This is automatic compensation, not user-initiated deletion. Returning
   * false means evidence or another session exists and must be preserved.
   */
  deletePersonalMapIfOnlyEmptyExploration(
    personalMapId: string,
    explorationId: string,
  ): Promise<boolean>;

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

export type TrackingCoordinateKind = "geographic" | "local";

/**
 * Platform boundary for GNSS, PDR, replay, or manual tracking providers.
 * A provider supplies observations; it never decides map truth or draws UI.
 *
 * `coordinateKind` is declarative capability metadata used by the engine before
 * any repository write or platform side effect. It is not a request by the
 * provider to reinterpret observations.
 */
export interface TrackingProviderPort {
  readonly id: string;
  readonly coordinateKind: TrackingCoordinateKind;

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
