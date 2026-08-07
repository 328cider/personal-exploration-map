import type {
  MapBounds,
  MapMarker,
  MapSnapshot,
  PersonalMapSnapshot,
  TrackPoint,
} from "@exploration-map/mapping-core";

export type RenderableMapSnapshot = MapSnapshot | PersonalMapSnapshot;

export type TrackConfidenceBand = "high" | "low";

export interface CanvasPoint {
  readonly x: number;
  readonly y: number;
}

export interface CanvasStroke {
  readonly id: string;
  readonly explorationId: string;
  readonly confidenceBand: TrackConfidenceBand;
  readonly opacity: number;
  readonly pointCount: number;
  readonly pathData: string;
}

export interface CanvasEndpoint {
  readonly explorationId: string;
  readonly explorationIndex: number;
  readonly kind: "start" | "end";
  readonly point: CanvasPoint;
}

export interface CanvasMarker {
  readonly marker: MapMarker;
  readonly point: CanvasPoint;
}

export interface TrackCanvasGeometry {
  readonly width: number;
  readonly height: number;
  readonly pointCount: number;
  readonly explorationCount: number;
  readonly strokes: readonly CanvasStroke[];
  readonly endpoints: readonly CanvasEndpoint[];
  readonly markers: readonly CanvasMarker[];
}

interface SourceSegment {
  readonly explorationId: string;
  readonly track: readonly TrackPoint[];
}

interface ProjectedTrackPoint extends CanvasPoint {
  readonly source: TrackPoint;
}

interface Projection {
  readonly scale: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly minX: number;
  readonly minY: number;
  readonly height: number;
}

const HIGH_CONFIDENCE_THRESHOLD = 0.5;
const MINIMUM_VISIBLE_OPACITY = 0.35;
const OPACITY_BUCKET_SIZE = 0.1;

function snapshotSegments(
  snapshot: RenderableMapSnapshot,
): readonly SourceSegment[] {
  if ("segments" in snapshot) {
    return snapshot.segments.map((segment) => ({
      explorationId: segment.explorationId,
      track: segment.track,
    }));
  }
  return [
    {
      explorationId: snapshot.explorationId,
      track: snapshot.track,
    },
  ];
}

function createProjection(input: {
  readonly bounds: MapBounds;
  readonly width: number;
  readonly height: number;
  readonly padding: number;
}): Projection {
  const usableWidth = Math.max(1, input.width - input.padding * 2);
  const usableHeight = Math.max(1, input.height - input.padding * 2);
  const rangeX = Math.max(1, input.bounds.maxX - input.bounds.minX);
  const rangeY = Math.max(1, input.bounds.maxY - input.bounds.minY);
  const scale = Math.min(usableWidth / rangeX, usableHeight / rangeY);
  const usedWidth = rangeX * scale;
  const usedHeight = rangeY * scale;

  return {
    scale,
    offsetX: (input.width - usedWidth) / 2,
    offsetY: (input.height - usedHeight) / 2,
    minX: input.bounds.minX,
    minY: input.bounds.minY,
    height: input.height,
  };
}

function projectPoint(
  xMeters: number,
  yMeters: number,
  projection: Projection,
): CanvasPoint {
  return {
    x: projection.offsetX + (xMeters - projection.minX) * projection.scale,
    y:
      projection.height -
      (projection.offsetY + (yMeters - projection.minY) * projection.scale),
  };
}

function formatCoordinate(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function createPathData(points: readonly CanvasPoint[]): string {
  const first = points[0];
  if (first === undefined) {
    return "";
  }
  const commands = [
    `M ${formatCoordinate(first.x)} ${formatCoordinate(first.y)}`,
  ];
  for (const point of points.slice(1)) {
    commands.push(
      `L ${formatCoordinate(point.x)} ${formatCoordinate(point.y)}`,
    );
  }
  return commands.join(" ");
}

function confidenceBand(confidence: number): TrackConfidenceBand {
  return confidence >= HIGH_CONFIDENCE_THRESHOLD ? "high" : "low";
}

function opacityBucket(confidence: number): number {
  const visible = Math.max(
    MINIMUM_VISIBLE_OPACITY,
    Math.min(1, confidence),
  );
  return Math.round(visible / OPACITY_BUCKET_SIZE) * OPACITY_BUCKET_SIZE;
}

function buildSegmentStrokes(
  segment: SourceSegment,
  points: readonly ProjectedTrackPoint[],
): readonly CanvasStroke[] {
  if (points.length < 2) {
    return [];
  }

  const strokes: CanvasStroke[] = [];
  let activePoints: CanvasPoint[] = [];
  let activeBand: TrackConfidenceBand | null = null;
  let activeOpacity = 1;
  let strokeIndex = 0;

  function finishActiveStroke(): void {
    if (
      activeBand === null ||
      activePoints.length < 2
    ) {
      activePoints = [];
      return;
    }
    strokes.push({
      id: `${segment.explorationId}-stroke-${strokeIndex}`,
      explorationId: segment.explorationId,
      confidenceBand: activeBand,
      opacity: activeOpacity,
      pointCount: activePoints.length,
      pathData: createPathData(activePoints),
    });
    strokeIndex += 1;
    activePoints = [];
  }

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    if (previous === undefined || current === undefined) {
      continue;
    }

    const edgeConfidence = Math.min(
      previous.source.confidence,
      current.source.confidence,
    );
    const edgeBand = confidenceBand(edgeConfidence);
    const edgeOpacity = opacityBucket(edgeConfidence);

    if (
      activeBand === edgeBand &&
      activeOpacity === edgeOpacity
    ) {
      activePoints.push(current);
      continue;
    }

    finishActiveStroke();
    activeBand = edgeBand;
    activeOpacity = edgeOpacity;
    activePoints = [previous, current];
  }
  finishActiveStroke();
  return strokes;
}

/**
 * Converts a read-only map snapshot into renderer geometry.
 *
 * Every ExplorationSession remains an independent source segment. Confidence
 * changes may split a session into multiple SVG strokes, but strokes from two
 * sessions are never joined and no inferred connection is generated here.
 */
export function buildTrackCanvasGeometry(input: {
  readonly snapshot: RenderableMapSnapshot;
  readonly width: number;
  readonly height: number;
  readonly padding?: number;
}): TrackCanvasGeometry {
  const width = Math.max(0, input.width);
  const height = Math.max(0, input.height);
  const segments = snapshotSegments(input.snapshot);
  const pointCount = segments.reduce(
    (sum, segment) => sum + segment.track.length,
    0,
  );

  if (
    width <= 0 ||
    height <= 0 ||
    input.snapshot.bounds === null
  ) {
    return {
      width,
      height,
      pointCount,
      explorationCount: segments.length,
      strokes: [],
      endpoints: [],
      markers: [],
    };
  }

  const projection = createProjection({
    bounds: input.snapshot.bounds,
    width,
    height,
    padding: Math.max(0, input.padding ?? 34),
  });
  const strokes: CanvasStroke[] = [];
  const endpoints: CanvasEndpoint[] = [];

  segments.forEach((segment, explorationIndex) => {
    const projected = segment.track.map((point) => ({
      ...projectPoint(point.xMeters, point.yMeters, projection),
      source: point,
    }));
    strokes.push(...buildSegmentStrokes(segment, projected));

    const first = projected[0];
    if (first !== undefined) {
      endpoints.push({
        explorationId: segment.explorationId,
        explorationIndex,
        kind: "start",
        point: first,
      });
    }
    const last = projected.at(-1);
    if (last !== undefined && projected.length >= 2) {
      endpoints.push({
        explorationId: segment.explorationId,
        explorationIndex,
        kind: "end",
        point: last,
      });
    }
  });

  const markers = input.snapshot.markers.flatMap((marker) => {
    if (marker.xMeters === undefined || marker.yMeters === undefined) {
      return [];
    }
    return [
      {
        marker,
        point: projectPoint(
          marker.xMeters,
          marker.yMeters,
          projection,
        ),
      },
    ];
  });

  return {
    width,
    height,
    pointCount,
    explorationCount: segments.length,
    strokes,
    endpoints,
    markers,
  };
}
