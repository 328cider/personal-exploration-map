import {
  addMarker as addMarkerToSession,
  appendPositionSample,
  createExplorationSession,
  createPersonalMapSnapshot,
  endExploration as endExplorationSession,
  replayExploration,
  type CreatePersonalMapSnapshotInput,
  type MapMarker,
  type MappingEvent,
} from "../../mapping-core/src/index.ts";

import type {
  AddMarkerCommand,
  CreateMappingEngineOptions,
  CreatePersonalMapCommand,
  CreatePersonalMapWithFirstExplorationCommand,
  EndExplorationCommand,
  GetPersonalMapQuery,
  IngestPositionSamplesCommand,
  IngestPositionSamplesResult,
  LoadedExploration,
  MappingEngine,
  MappingEngineListener,
  MappingEntityKind,
  PersonalMapListItem,
  StartExplorationCommand,
  StoredExploration,
  StoredPersonalMap,
  TrackingProviderPort,
} from "./contracts.ts";

function assertNonBlank(value: string, label: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${label} must not be blank.`);
  }
}

function assertFiniteTimestamp(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a finite non-negative timestamp.`);
  }
}

function createProviderMap(
  providers: readonly TrackingProviderPort[],
): ReadonlyMap<string, TrackingProviderPort> {
  const result = new Map<string, TrackingProviderPort>();
  for (const provider of providers) {
    assertNonBlank(provider.id, "Tracking provider id");
    if (
      provider.coordinateKind !== "geographic" &&
      provider.coordinateKind !== "local"
    ) {
      throw new Error(
        `Tracking provider ${provider.id} has an invalid coordinate kind.`,
      );
    }
    if (result.has(provider.id)) {
      throw new Error(`Duplicate tracking provider id: ${provider.id}`);
    }
    result.set(provider.id, provider);
  }
  return result;
}

function createRequiredId(
  kind: MappingEntityKind,
  requestedId: string | undefined,
  idFactory: CreateMappingEngineOptions["idFactory"],
): string {
  const id = requestedId ?? idFactory(kind);
  assertNonBlank(id, `${kind} id`);
  return id;
}

function markerFromEvent(event: MappingEvent): MapMarker {
  if (event.type !== "marker.added") {
    throw new Error(`Expected marker.added event, received ${event.type}.`);
  }
  return event.marker;
}

function localFrameLabelForStart(
  provider: TrackingProviderPort,
  command: Omit<StartExplorationCommand, "personalMapId">,
): string | undefined {
  if (provider.coordinateKind === "geographic") {
    if (command.localFrameLabel !== undefined) {
      throw new Error(
        `Geographic tracking provider ${provider.id} must not receive a localFrameLabel.`,
      );
    }
    return undefined;
  }

  const label = command.localFrameLabel?.trim();
  if (label === undefined || label.length === 0) {
    throw new Error(
      `Local tracking provider ${provider.id} requires a non-blank localFrameLabel.`,
    );
  }
  return label;
}

/**
 * Rejects an incompatible continuation before creating an ExplorationSession
 * record or starting a platform provider.
 */
function assertProviderCompatibleWithPersonalMap(
  mapInput: CreatePersonalMapSnapshotInput,
  provider: TrackingProviderPort,
  localFrameLabel: string | undefined,
): void {
  const map = createPersonalMapSnapshot(mapInput);
  const frame = map.frame;

  if (frame.kind === "unresolved") {
    return;
  }

  if (provider.coordinateKind === "geographic") {
    if (frame.kind === "local") {
      throw new Error(
        `Geographic tracking provider ${provider.id} cannot extend local PersonalMap ${map.personalMapId} without an explicit anchor transform.`,
      );
    }
    return;
  }

  if (frame.kind === "geographic-local") {
    throw new Error(
      `Local tracking provider ${provider.id} cannot extend geographic PersonalMap ${map.personalMapId} without an explicit anchor transform.`,
    );
  }

  if (frame.label === undefined) {
    throw new Error(
      `Local PersonalMap ${map.personalMapId} has no explicit frame label and cannot accept another local exploration safely.`,
    );
  }

  if (frame.label !== localFrameLabel) {
    throw new Error(
      `Local tracking frame ${localFrameLabel} does not match PersonalMap frame ${frame.label}.`,
    );
  }
}

function createPersonalMapRecord(
  command: CreatePersonalMapCommand,
  idFactory: CreateMappingEngineOptions["idFactory"],
): StoredPersonalMap {
  assertNonBlank(command.name, "Personal map name");
  assertFiniteTimestamp(command.createdAtMs, "createdAtMs");
  const id = createRequiredId(
    "personal-map",
    command.requestedId,
    idFactory,
  );
  return {
    id,
    name: command.name.trim(),
    createdAtMs: command.createdAtMs,
    updatedAtMs: command.createdAtMs,
  };
}

function createExplorationRecord(input: {
  readonly command: Omit<StartExplorationCommand, "personalMapId">;
  readonly personalMapId: string;
  readonly provider: TrackingProviderPort;
  readonly idFactory: CreateMappingEngineOptions["idFactory"];
}): StoredExploration {
  assertNonBlank(input.command.name, "Exploration name");
  assertNonBlank(input.command.trackingProviderId, "trackingProviderId");
  assertFiniteTimestamp(input.command.startedAtMs, "startedAtMs");

  const localFrameLabel = localFrameLabelForStart(
    input.provider,
    input.command,
  );
  return {
    id: createRequiredId(
      "exploration",
      input.command.requestedId,
      input.idFactory,
    ),
    personalMapId: input.personalMapId,
    name: input.command.name.trim(),
    startedAtMs: input.command.startedAtMs,
    trackingProviderId: input.command.trackingProviderId,
    ...(localFrameLabel === undefined ? {} : { localFrameLabel }),
  };
}

function createStartedMutation(record: StoredExploration) {
  return createExplorationSession({
    id: record.id,
    name: record.name,
    startedAtMs: record.startedAtMs,
    ...(record.localFrameLabel === undefined
      ? {}
      : { localFrameLabel: record.localFrameLabel }),
  });
}

async function requireExploration(
  options: CreateMappingEngineOptions,
  personalMapId: string,
  explorationId: string,
): Promise<LoadedExploration> {
  const loaded = await options.repository.loadExploration(
    personalMapId,
    explorationId,
  );
  if (loaded === null) {
    throw new Error(
      `Exploration ${explorationId} does not belong to personal map ${personalMapId}.`,
    );
  }
  return loaded;
}

/**
 * Creates the executable headless mapping application boundary.
 *
 * All canonical writes pass through this facade. Repository changes complete
 * before notifications are published, so presentation or game listeners can
 * never become the source of truth or roll back a successful map write.
 */
export function createMappingEngine(
  options: CreateMappingEngineOptions,
): MappingEngine {
  const providers = createProviderMap(options.trackingProviders);
  const listeners = new Set<MappingEngineListener>();

  function requireProvider(providerId: string): TrackingProviderPort {
    const provider = providers.get(providerId);
    if (provider === undefined) {
      throw new Error(`Unknown tracking provider: ${providerId}`);
    }
    return provider;
  }

  function publish(personalMapId: string, events: readonly MappingEvent[]): void {
    for (const event of events) {
      const notification = { personalMapId, event } as const;
      for (const listener of listeners) {
        try {
          listener(notification);
        } catch {
          // Experience and UI listeners are deliberately unable to roll back
          // a canonical write that has already committed.
        }
      }
    }
  }

  async function createPersonalMap(
    command: CreatePersonalMapCommand,
  ): Promise<{ readonly personalMapId: string }> {
    const record = createPersonalMapRecord(command, options.idFactory);
    await options.repository.runInTransaction((writer) =>
      writer.createPersonalMap(record),
    );
    return { personalMapId: record.id };
  }

  async function createPersonalMapWithFirstExploration(
    command: CreatePersonalMapWithFirstExplorationCommand,
  ): Promise<{
    readonly personalMapId: string;
    readonly explorationId: string;
  }> {
    const personalMap = createPersonalMapRecord(
      command.personalMap,
      options.idFactory,
    );
    const provider = requireProvider(
      command.exploration.trackingProviderId,
    );
    const exploration = createExplorationRecord({
      command: command.exploration,
      personalMapId: personalMap.id,
      provider,
      idFactory: options.idFactory,
    });
    if (exploration.startedAtMs < personalMap.createdAtMs) {
      throw new Error(
        "The first exploration must not start before its PersonalMap is created.",
      );
    }

    await options.repository.runInTransaction(async (writer) => {
      await writer.createPersonalMap(personalMap);
      await writer.createExploration(exploration);
    });

    try {
      await provider.start({
        personalMapId: personalMap.id,
        explorationId: exploration.id,
      });
    } catch (startError) {
      let compensated = false;
      try {
        compensated = await options.repository.runInTransaction((writer) =>
          writer.deletePersonalMapIfOnlyUnobservedExploration(
            personalMap.id,
            exploration.id,
          ),
        );
      } catch (cleanupError) {
        throw new AggregateError(
          [startError, cleanupError],
          `Tracking provider ${provider.id} failed to start and the new PersonalMap could not be compensated.`,
        );
      }
      if (!compensated) {
        throw new AggregateError(
          [
            startError,
            new Error(
              "Automatic compensation was refused because the new PersonalMap no longer consisted of exactly one unobserved exploration.",
            ),
          ],
          `Tracking provider ${provider.id} failed to start; canonical evidence was preserved for explicit recovery.`,
        );
      }
      throw startError;
    }

    publish(personalMap.id, createStartedMutation(exploration).events);
    return {
      personalMapId: personalMap.id,
      explorationId: exploration.id,
    };
  }

  async function startExploration(
    command: StartExplorationCommand,
  ): Promise<{ readonly explorationId: string }> {
    assertNonBlank(command.personalMapId, "personalMapId");
    const mapInput = await options.repository.loadPersonalMapReplayInput(
      command.personalMapId,
    );
    if (mapInput === null) {
      throw new Error(`Personal map not found: ${command.personalMapId}`);
    }

    const provider = requireProvider(command.trackingProviderId);
    const exploration = createExplorationRecord({
      command,
      personalMapId: command.personalMapId,
      provider,
      idFactory: options.idFactory,
    });
    assertProviderCompatibleWithPersonalMap(
      mapInput,
      provider,
      exploration.localFrameLabel,
    );

    await options.repository.runInTransaction((writer) =>
      writer.createExploration(exploration),
    );

    try {
      await provider.start({
        personalMapId: command.personalMapId,
        explorationId: exploration.id,
      });
    } catch (startError) {
      let compensated = false;
      try {
        compensated = await options.repository.runInTransaction((writer) =>
          writer.deleteExplorationIfUnobserved(exploration.id),
        );
      } catch (cleanupError) {
        throw new AggregateError(
          [startError, cleanupError],
          `Tracking provider ${provider.id} failed to start and the exploration record could not be compensated.`,
        );
      }
      if (!compensated) {
        throw new AggregateError(
          [
            startError,
            new Error(
              "Automatic compensation was refused because raw observations or confirmed markers already exist.",
            ),
          ],
          `Tracking provider ${provider.id} failed to start; canonical evidence was preserved for explicit recovery.`,
        );
      }
      throw startError;
    }

    publish(command.personalMapId, createStartedMutation(exploration).events);
    return { explorationId: exploration.id };
  }

  async function ingestPositionSamples(
    command: IngestPositionSamplesCommand,
  ): Promise<IngestPositionSamplesResult> {
    if (command.samples.length === 0) {
      return {
        persistedSampleCount: 0,
        acceptedSampleCount: 0,
        rejectedSampleCount: 0,
      };
    }

    const loaded = await requireExploration(
      options,
      command.personalMapId,
      command.explorationId,
    );
    let session = replayExploration(loaded.replay);

    const persisted = await options.repository.runInTransaction((writer) =>
      writer.appendPositionSamples(command.explorationId, command.samples),
    );

    const events: MappingEvent[] = [];
    let acceptedSampleCount = 0;
    let rejectedSampleCount = 0;

    for (const sample of persisted) {
      const mutation = appendPositionSample(session, sample);
      session = mutation.session;
      events.push(...mutation.events);
      for (const event of mutation.events) {
        if (event.type === "position.accepted") {
          acceptedSampleCount += 1;
        } else if (event.type === "position.rejected") {
          rejectedSampleCount += 1;
        }
      }
    }

    publish(command.personalMapId, events);
    return {
      persistedSampleCount: persisted.length,
      acceptedSampleCount,
      rejectedSampleCount,
    };
  }

  async function addMarker(command: AddMarkerCommand): Promise<void> {
    assertFiniteTimestamp(command.marker.recordedAtMs, "marker.recordedAtMs");
    assertNonBlank(command.marker.label, "Marker label");

    const loaded = await requireExploration(
      options,
      command.personalMapId,
      command.explorationId,
    );
    const session = replayExploration(loaded.replay);
    const markerId = createRequiredId(
      "marker",
      command.marker.requestedId,
      options.idFactory,
    );
    const mutation = addMarkerToSession(session, {
      id: markerId,
      recordedAtMs: command.marker.recordedAtMs,
      category: command.marker.category,
      label: command.marker.label.trim(),
      ...(command.marker.note === undefined
        ? {}
        : { note: command.marker.note }),
      ...(command.marker.sourcePosition === undefined
        ? {}
        : { sourcePosition: command.marker.sourcePosition }),
    });
    const event = mutation.events[0];
    if (event === undefined) {
      throw new Error("Mapping core did not emit a marker event.");
    }
    const marker = markerFromEvent(event);

    const inserted = await options.repository.runInTransaction((writer) =>
      writer.appendMarker(command.explorationId, marker),
    );
    if (inserted) {
      publish(command.personalMapId, mutation.events);
    }
  }

  async function endExploration(
    command: EndExplorationCommand,
  ): Promise<{ readonly map: ReturnType<typeof createPersonalMapSnapshot> }> {
    assertFiniteTimestamp(command.endedAtMs, "endedAtMs");

    const loaded = await requireExploration(
      options,
      command.personalMapId,
      command.explorationId,
    );
    if (loaded.record.endedAtMs !== undefined) {
      throw new Error(`Exploration already completed: ${command.explorationId}`);
    }
    if (command.endedAtMs < loaded.record.startedAtMs) {
      throw new Error("endedAtMs must not be before startedAtMs.");
    }

    const provider = requireProvider(loaded.record.trackingProviderId);
    await provider.stop(command.explorationId);

    const completed = endExplorationSession(
      replayExploration(loaded.replay),
      command.endedAtMs,
    );
    await options.repository.runInTransaction((writer) =>
      writer.completeExploration(command.explorationId, command.endedAtMs),
    );
    publish(command.personalMapId, completed.events);

    const map = await getPersonalMap({ personalMapId: command.personalMapId });
    if (map === null) {
      throw new Error(
        `Personal map disappeared after completing exploration: ${command.personalMapId}`,
      );
    }
    return { map };
  }

  async function getPersonalMap(query: GetPersonalMapQuery) {
    const input = await options.repository.loadPersonalMapReplayInput(
      query.personalMapId,
    );
    return input === null ? null : createPersonalMapSnapshot(input);
  }

  async function listPersonalMaps(): Promise<readonly PersonalMapListItem[]> {
    return options.repository.listPersonalMaps();
  }

  return {
    createPersonalMap,
    createPersonalMapWithFirstExploration,
    startExploration,
    ingestPositionSamples,
    addMarker,
    endExploration,
    getPersonalMap,
    listPersonalMaps,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
