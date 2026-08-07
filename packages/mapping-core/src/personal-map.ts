import {
  projectGeographicToLocal,
  trackLengthMeters,
  unprojectLocalToGeographic,
} from "./geo.ts";
import type {
  MapBounds,
  MapFrame,
  MapMarker,
  TrackPoint,
} from "./model.ts";
import { replayExploration, type ReplayExplorationInput } from "./replay.ts";
import { createMapSnapshot } from "./session.ts";

export interface PersonalMapTrackSegment {
  readonly explorationId: string;
  readonly startedAtMs: number;
  readonly endedAtMs?: number;
  readonly track: readonly TrackPoint[];
}

export interface PersonalMapStats {
  readonly explorationCount: number;
  readonly rawSampleCount: number;
  readonly acceptedSampleCount: number;
  readonly rejectedSampleCount: number;
  readonly distanceMeters: number;
  readonly durationMs: number;
  readonly markerCount: number;
}

export interface PersonalMapSnapshot {
  readonly personalMapId: string;
  readonly name: string;
  readonly frame: MapFrame;
  readonly segments: readonly PersonalMapTrackSegment[];
  readonly markers: readonly MapMarker[];
  readonly bounds: MapBounds | null;
  readonly stats: PersonalMapStats;
  readonly revision: number;
}

export interface CreatePersonalMapSnapshotInput {
  readonly id: string;
  readonly name: string;
  readonly explorations: readonly ReplayExplorationInput[];
  readonly simplifyToleranceMeters?: number;
}

type ResolvedMapFrame = Exclude<MapFrame, { readonly kind: "unresolved" }>;

interface ReplayedExploration {
  readonly input: ReplayExplorationInput;
  readonly frame: MapFrame;
  readonly track: readonly TrackPoint[];
  readonly markers: readonly MapMarker[];
  readonly rawSampleCount: number;
  readonly acceptedSampleCount: number;
  readonly rejectedSampleCount: number;
  readonly durationMs: number;
  readonly revision: number;
}

function replayOne(
  input: ReplayExplorationInput,
  simplifyToleranceMeters: number,
): ReplayedExploration {
  const session = replayExploration(input);
  const snapshot = createMapSnapshot(session, { simplifyToleranceMeters });
  return {
    input,
    frame: snapshot.frame,
    track: snapshot.track,
    markers: snapshot.markers,
    rawSampleCount: snapshot.stats.rawSampleCount,
    acceptedSampleCount: snapshot.stats.acceptedSampleCount,
    rejectedSampleCount: snapshot.stats.rejectedSampleCount,
    durationMs: snapshot.stats.durationMs,
    revision: snapshot.revision,
  };
}

function resolvedFrames(
  explorations: readonly ReplayedExploration[],
): readonly ResolvedMapFrame[] {
  return explorations.flatMap((exploration) =>
    exploration.frame.kind === "unresolved" ? [] : [exploration.frame],
  );
}

function chooseMapFrame(
  explorations: readonly ReplayedExploration[],
): MapFrame {
  const frames = resolvedFrames(explorations);
  const first = frames[0];
  if (first === undefined) {
    return { kind: "unresolved" };
  }

  if (frames.some((frame) => frame.kind !== first.kind)) {
    throw new Error(
      "Cannot aggregate geographic and local explorations into one personal map without an explicit anchor transform.",
    );
  }

  if (first.kind === "geographic-local") {
    return first;
  }

  const localFrames = frames.filter(
    (frame): frame is Extract<MapFrame, { readonly kind: "local" }> =>
      frame.kind === "local",
  );
  const labels = new Set(localFrames.map((frame) => frame.label));
  if (localFrames.length > 1 && (labels.size !== 1 || first.label === undefined)) {
    throw new Error(
      "Multiple local explorations require the same explicit local frame label before they can be aggregated.",
    );
  }
  return first;
}

function geographicPositionForPoint(
  point: TrackPoint,
  sourceFrame: Extract<MapFrame, { readonly kind: "geographic-local" }>,
) {
  if (point.sourcePosition.kind === "geographic") {
    return point.sourcePosition;
  }
  return unprojectLocalToGeographic(
    point.xMeters,
    point.yMeters,
    sourceFrame.originLatitude,
    sourceFrame.originLongitude,
  );
}

function transformTrackPoint(
  point: TrackPoint,
  sourceFrame: ResolvedMapFrame,
  targetFrame: ResolvedMapFrame,
): TrackPoint {
  if (targetFrame.kind === "local") {
    if (sourceFrame.kind !== "local") {
      throw new Error("Coordinate frame mismatch while aggregating personal map.");
    }
    return point;
  }

  if (sourceFrame.kind !== "geographic-local") {
    throw new Error("Coordinate frame mismatch while aggregating personal map.");
  }
  const geographic = geographicPositionForPoint(point, sourceFrame);
  const projected = projectGeographicToLocal(
    geographic,
    targetFrame.originLatitude,
    targetFrame.originLongitude,
  );
  return {
    ...point,
    sourcePosition: geographic,
    xMeters: projected.xMeters,
    yMeters: projected.yMeters,
  };
}

function markerGeographicPosition(
  marker: MapMarker,
  sourceFrame: Extract<MapFrame, { readonly kind: "geographic-local" }>,
) {
  if (marker.sourcePosition?.kind === "geographic") {
    return marker.sourcePosition;
  }
  if (marker.xMeters === undefined || marker.yMeters === undefined) {
    return undefined;
  }
  return unprojectLocalToGeographic(
    marker.xMeters,
    marker.yMeters,
    sourceFrame.originLatitude,
    sourceFrame.originLongitude,
  );
}

function transformMarker(
  marker: MapMarker,
  sourceFrame: MapFrame,
  targetFrame: MapFrame,
): MapMarker {
  if (sourceFrame.kind === "unresolved" || targetFrame.kind === "unresolved") {
    return marker;
  }

  if (targetFrame.kind === "local") {
    if (sourceFrame.kind !== "local") {
      throw new Error("Coordinate frame mismatch while aggregating markers.");
    }
    return marker;
  }

  if (sourceFrame.kind !== "geographic-local") {
    throw new Error("Coordinate frame mismatch while aggregating markers.");
  }
  const geographic = markerGeographicPosition(marker, sourceFrame);
  if (geographic === undefined) {
    return {
      id: marker.id,
      recordedAtMs: marker.recordedAtMs,
      category: marker.category,
      label: marker.label,
      ...(marker.note === undefined ? {} : { note: marker.note }),
    };
  }
  const projected = projectGeographicToLocal(
    geographic,
    targetFrame.originLatitude,
    targetFrame.originLongitude,
  );
  return {
    ...marker,
    sourcePosition: geographic,
    xMeters: projected.xMeters,
    yMeters: projected.yMeters,
  };
}

function calculatePersonalMapBounds(
  segments: readonly PersonalMapTrackSegment[],
  markers: readonly MapMarker[],
): MapBounds | null {
  const coordinates = [
    ...segments.flatMap((segment) =>
      segment.track.map((point) => ({ x: point.xMeters, y: point.yMeters })),
    ),
    ...markers.flatMap((marker) =>
      marker.xMeters === undefined || marker.yMeters === undefined
        ? []
        : [{ x: marker.xMeters, y: marker.yMeters }],
    ),
  ];
  const first = coordinates[0];
  if (first === undefined) {
    return null;
  }

  let minX = first.x;
  let minY = first.y;
  let maxX = first.x;
  let maxY = first.y;
  for (const coordinate of coordinates.slice(1)) {
    minX = Math.min(minX, coordinate.x);
    minY = Math.min(minY, coordinate.y);
    maxX = Math.max(maxX, coordinate.x);
    maxY = Math.max(maxY, coordinate.y);
  }
  return { minX, minY, maxX, maxY };
}

function transformSegments(
  explorations: readonly ReplayedExploration[],
  mapFrame: MapFrame,
): readonly PersonalMapTrackSegment[] {
  if (mapFrame.kind === "unresolved") {
    return explorations.map((exploration) => ({
      explorationId: exploration.input.id,
      startedAtMs: exploration.input.startedAtMs,
      ...(exploration.input.endedAtMs === undefined
        ? {}
        : { endedAtMs: exploration.input.endedAtMs }),
      track: [],
    }));
  }

  return explorations.map((exploration) => {
    if (exploration.frame.kind === "unresolved") {
      return {
        explorationId: exploration.input.id,
        startedAtMs: exploration.input.startedAtMs,
        ...(exploration.input.endedAtMs === undefined
          ? {}
          : { endedAtMs: exploration.input.endedAtMs }),
        track: [],
      };
    }
    const sourceFrame = exploration.frame;
    return {
      explorationId: exploration.input.id,
      startedAtMs: exploration.input.startedAtMs,
      ...(exploration.input.endedAtMs === undefined
        ? {}
        : { endedAtMs: exploration.input.endedAtMs }),
      track: exploration.track.map((point) =>
        transformTrackPoint(point, sourceFrame, mapFrame),
      ),
    };
  });
}

function aggregateStats(
  explorations: readonly ReplayedExploration[],
  segments: readonly PersonalMapTrackSegment[],
): PersonalMapStats {
  return {
    explorationCount: explorations.length,
    rawSampleCount: explorations.reduce(
      (sum, exploration) => sum + exploration.rawSampleCount,
      0,
    ),
    acceptedSampleCount: explorations.reduce(
      (sum, exploration) => sum + exploration.acceptedSampleCount,
      0,
    ),
    rejectedSampleCount: explorations.reduce(
      (sum, exploration) => sum + exploration.rejectedSampleCount,
      0,
    ),
    distanceMeters: segments.reduce(
      (sum, segment) => sum + trackLengthMeters(segment.track),
      0,
    ),
    durationMs: explorations.reduce(
      (sum, exploration) => sum + exploration.durationMs,
      0,
    ),
    markerCount: explorations.reduce(
      (sum, exploration) => sum + exploration.markers.length,
      0,
    ),
  };
}

export function createPersonalMapSnapshot(
  input: CreatePersonalMapSnapshotInput,
): PersonalMapSnapshot {
  const tolerance = input.simplifyToleranceMeters ?? 0;
  const explorations = input.explorations.map((exploration) =>
    replayOne(exploration, tolerance),
  );
  const frame = chooseMapFrame(explorations);
  const segments = transformSegments(explorations, frame);
  const markers = explorations.flatMap((exploration) =>
    exploration.markers.map((marker) =>
      transformMarker(marker, exploration.frame, frame),
    ),
  );

  return {
    personalMapId: input.id,
    name: input.name,
    frame,
    segments,
    markers,
    bounds: calculatePersonalMapBounds(segments, markers),
    stats: aggregateStats(explorations, segments),
    revision: explorations.reduce(
      (sum, exploration) => sum + exploration.revision,
      0,
    ),
  };
}
