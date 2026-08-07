import { calculateBounds, projectGeographicToLocal, trackLengthMeters } from "./geo.ts";
import type { MappingEvent } from "./events.ts";
import type {
  ExplorationSession,
  MapMarker,
  MapSnapshot,
  MapStats,
  RawPositionSample,
  TrackPoint,
} from "./model.ts";
import {
  assessSampleQuality,
  DEFAULT_QUALITY_POLICY,
  type QualityPolicy,
} from "./quality.ts";
import { simplifyTrack } from "./simplify.ts";

export interface CreateExplorationInput {
  readonly id: string;
  readonly name: string;
  readonly startedAtMs: number;
  readonly localFrameLabel?: string;
}

export interface SessionMutation {
  readonly session: ExplorationSession;
  readonly events: readonly MappingEvent[];
}

export function createExplorationSession(
  input: CreateExplorationInput,
): SessionMutation {
  const session: ExplorationSession = {
    id: input.id,
    name: input.name,
    status: "recording",
    startedAtMs: input.startedAtMs,
    frame:
      input.localFrameLabel === undefined
        ? { kind: "unresolved" }
        : { kind: "local", label: input.localFrameLabel },
    rawSamples: [],
    rejectedSamples: [],
    track: [],
    markers: [],
    revision: 0,
  };

  return {
    session,
    events: [
      {
        type: "exploration.started",
        explorationId: session.id,
        occurredAtMs: input.startedAtMs,
      },
    ],
  };
}

function projectSample(
  session: ExplorationSession,
  sample: RawPositionSample,
): { readonly frame: ExplorationSession["frame"]; readonly point: TrackPoint } {
  if (sample.position.kind === "geographic") {
    const frame =
      session.frame.kind === "unresolved"
        ? {
            kind: "geographic-local" as const,
            originLatitude: sample.position.latitude,
            originLongitude: sample.position.longitude,
          }
        : session.frame;

    if (frame.kind !== "geographic-local") {
      throw new Error("Coordinate frame mismatch");
    }

    const projected = projectGeographicToLocal(
      sample.position,
      frame.originLatitude,
      frame.originLongitude,
    );
    const pointBase = {
      sampleId: sample.id,
      recordedAtMs: sample.recordedAtMs,
      source: sample.source,
      sourcePosition: sample.position,
      xMeters: projected.xMeters,
      yMeters: projected.yMeters,
      confidence: sample.confidence,
    };

    return {
      frame,
      point:
        sample.horizontalAccuracyMeters === undefined
          ? pointBase
          : {
              ...pointBase,
              horizontalAccuracyMeters: sample.horizontalAccuracyMeters,
            },
    };
  }

  const frame =
    session.frame.kind === "unresolved" ? { kind: "local" as const } : session.frame;
  if (frame.kind !== "local") {
    throw new Error("Coordinate frame mismatch");
  }

  const pointBase = {
    sampleId: sample.id,
    recordedAtMs: sample.recordedAtMs,
    source: sample.source,
    sourcePosition: sample.position,
    xMeters: sample.position.xMeters,
    yMeters: sample.position.yMeters,
    confidence: sample.confidence,
  };

  return {
    frame,
    point:
      sample.horizontalAccuracyMeters === undefined
        ? pointBase
        : {
            ...pointBase,
            horizontalAccuracyMeters: sample.horizontalAccuracyMeters,
          },
  };
}

function frameMatchesSample(
  session: ExplorationSession,
  sample: RawPositionSample,
): boolean {
  if (session.frame.kind === "unresolved") {
    return true;
  }
  if (session.frame.kind === "geographic-local") {
    return sample.position.kind === "geographic";
  }
  return sample.position.kind === "local";
}

export function appendPositionSample(
  session: ExplorationSession,
  sample: RawPositionSample,
  policy: QualityPolicy = DEFAULT_QUALITY_POLICY,
): SessionMutation {
  const rawSamples = [...session.rawSamples, sample];

  if (session.status !== "recording") {
    const reason = "session-not-recording" as const;
    return {
      session: {
        ...session,
        rawSamples,
        rejectedSamples: [...session.rejectedSamples, { sampleId: sample.id, reason }],
        revision: session.revision + 1,
      },
      events: [
        {
          type: "position.rejected",
          explorationId: session.id,
          occurredAtMs: sample.recordedAtMs,
          sample,
          reason,
        },
      ],
    };
  }

  if (!frameMatchesSample(session, sample)) {
    const reason = "coordinate-frame-mismatch" as const;
    return {
      session: {
        ...session,
        rawSamples,
        rejectedSamples: [...session.rejectedSamples, { sampleId: sample.id, reason }],
        revision: session.revision + 1,
      },
      events: [
        {
          type: "position.rejected",
          explorationId: session.id,
          occurredAtMs: sample.recordedAtMs,
          sample,
          reason,
        },
      ],
    };
  }

  const previousAccepted = session.track.at(-1);
  const assessment = assessSampleQuality(previousAccepted, sample, policy);
  if (!assessment.accepted && assessment.reason !== undefined) {
    return {
      session: {
        ...session,
        rawSamples,
        rejectedSamples: [
          ...session.rejectedSamples,
          { sampleId: sample.id, reason: assessment.reason },
        ],
        revision: session.revision + 1,
      },
      events: [
        {
          type: "position.rejected",
          explorationId: session.id,
          occurredAtMs: sample.recordedAtMs,
          sample,
          reason: assessment.reason,
        },
      ],
    };
  }

  const { frame, point } = projectSample(session, sample);
  return {
    session: {
      ...session,
      frame,
      rawSamples,
      track: [...session.track, point],
      revision: session.revision + 1,
    },
    events: [
      {
        type: "position.accepted",
        explorationId: session.id,
        occurredAtMs: sample.recordedAtMs,
        sample,
      },
    ],
  };
}

export interface AddMarkerInput {
  readonly id: string;
  readonly recordedAtMs: number;
  readonly category: MapMarker["category"];
  readonly label: string;
  readonly note?: string;
  readonly xMeters?: number;
  readonly yMeters?: number;
  readonly sourcePosition?: MapMarker["sourcePosition"];
}

export function addMarker(
  session: ExplorationSession,
  input: AddMarkerInput,
): SessionMutation {
  const latestPointAtOrBefore = [...session.track]
    .reverse()
    .find((point) => point.recordedAtMs <= input.recordedAtMs);
  const fallbackPoint = latestPointAtOrBefore ?? session.track.at(-1);

  let projectedInput: { readonly xMeters: number; readonly yMeters: number } | undefined;
  if (input.xMeters !== undefined && input.yMeters !== undefined) {
    projectedInput = { xMeters: input.xMeters, yMeters: input.yMeters };
  } else if (
    input.sourcePosition?.kind === "geographic" &&
    session.frame.kind === "geographic-local"
  ) {
    projectedInput = projectGeographicToLocal(
      input.sourcePosition,
      session.frame.originLatitude,
      session.frame.originLongitude,
    );
  } else if (input.sourcePosition?.kind === "local") {
    projectedInput = {
      xMeters: input.sourcePosition.xMeters,
      yMeters: input.sourcePosition.yMeters,
    };
  }

  const baseMarker = {
    id: input.id,
    recordedAtMs: input.recordedAtMs,
    category: input.category,
    label: input.label,
  } satisfies Pick<
    MapMarker,
    "id" | "recordedAtMs" | "category" | "label"
  >;

  const marker: MapMarker = {
    ...baseMarker,
    ...(input.note === undefined ? {} : { note: input.note }),
    ...(projectedInput === undefined
      ? fallbackPoint === undefined
        ? {}
        : {
            xMeters: fallbackPoint.xMeters,
            yMeters: fallbackPoint.yMeters,
            sourcePosition: input.sourcePosition ?? fallbackPoint.sourcePosition,
          }
      : {
          xMeters: projectedInput.xMeters,
          yMeters: projectedInput.yMeters,
          ...(input.sourcePosition === undefined
            ? {}
            : { sourcePosition: input.sourcePosition }),
        }),
  };

  return {
    session: {
      ...session,
      markers: [...session.markers, marker],
      revision: session.revision + 1,
    },
    events: [
      {
        type: "marker.added",
        explorationId: session.id,
        occurredAtMs: input.recordedAtMs,
        marker,
      },
    ],
  };
}

export function endExploration(
  session: ExplorationSession,
  endedAtMs: number,
): SessionMutation {
  return {
    session: {
      ...session,
      status: "completed",
      endedAtMs,
      revision: session.revision + 1,
    },
    events: [
      {
        type: "exploration.ended",
        explorationId: session.id,
        occurredAtMs: endedAtMs,
      },
    ],
  };
}

export interface SnapshotOptions {
  readonly simplifyToleranceMeters?: number;
}

function calculateStats(session: ExplorationSession): MapStats {
  const endedAtMs =
    session.endedAtMs ?? session.track.at(-1)?.recordedAtMs ?? session.startedAtMs;
  return {
    rawSampleCount: session.rawSamples.length,
    acceptedSampleCount: session.track.length,
    rejectedSampleCount: session.rejectedSamples.length,
    distanceMeters: trackLengthMeters(session.track),
    durationMs: Math.max(0, endedAtMs - session.startedAtMs),
    markerCount: session.markers.length,
  };
}

export function createMapSnapshot(
  session: ExplorationSession,
  options: SnapshotOptions = {},
): MapSnapshot {
  const tolerance = options.simplifyToleranceMeters ?? 0;
  const track = simplifyTrack(session.track, tolerance);
  return {
    explorationId: session.id,
    frame: session.frame,
    track,
    markers: [...session.markers],
    bounds: calculateBounds(track),
    stats: calculateStats(session),
    revision: session.revision,
  };
}
