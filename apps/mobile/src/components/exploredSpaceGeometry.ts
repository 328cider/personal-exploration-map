export type MapDisplayMode = "corridor" | "cells" | "track";

export interface ExploredSpacePoint {
  readonly sampleId: string;
  readonly xMeters: number;
  readonly yMeters: number;
  readonly horizontalAccuracyMeters?: number;
  readonly confidence: number;
  readonly source?: string;
}

export interface ExploredSpaceSegment {
  readonly id: string;
  readonly points: readonly ExploredSpacePoint[];
}

export interface ExploredSpaceBounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export interface ScreenPoint {
  readonly x: number;
  readonly y: number;
  readonly source: ExploredSpacePoint;
}

export interface ProjectedSegment {
  readonly id: string;
  readonly points: readonly ScreenPoint[];
}

export interface CorridorPrimitive {
  readonly id: string;
  readonly left: number;
  readonly top: number;
  readonly length: number;
  readonly angleRadians: number;
  readonly width: number;
  readonly opacity: number;
}

export interface CoverageCellPrimitive {
  readonly id: string;
  readonly left: number;
  readonly top: number;
  readonly size: number;
  readonly opacity: number;
  readonly visits: number;
  readonly confidence: number;
}

export interface Projection {
  readonly scale: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly bounds: ExploredSpaceBounds;
  readonly width: number;
  readonly height: number;
}

export interface ExploredSpaceGeometry {
  readonly projection: Projection | null;
  readonly segments: readonly ProjectedSegment[];
  readonly corridors: readonly CorridorPrimitive[];
  readonly cells: readonly CoverageCellPrimitive[];
  readonly pointCount: number;
  readonly cellSizeMeters: number | null;
}

const MIN_RADIUS_METERS = 4;
const MAX_RADIUS_METERS = 30;
const DEFAULT_GNSS_RADIUS_METERS = 12;
const DEFAULT_PDR_RADIUS_METERS = 4;
const MAX_RENDERED_POINTS = 1_200;
const MAX_CELLS = 1_400;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function exploredRadiusMeters(point: ExploredSpacePoint): number {
  const measured = point.horizontalAccuracyMeters;
  if (measured !== undefined && Number.isFinite(measured) && measured > 0) {
    return clamp(measured, MIN_RADIUS_METERS, MAX_RADIUS_METERS);
  }
  return point.source === "pdr" || point.source === "manual"
    ? DEFAULT_PDR_RADIUS_METERS
    : DEFAULT_GNSS_RADIUS_METERS;
}

function allPoints(
  segments: readonly ExploredSpaceSegment[],
): readonly ExploredSpacePoint[] {
  return segments.flatMap((segment) => segment.points);
}

function expandBounds(
  bounds: ExploredSpaceBounds,
  segments: readonly ExploredSpaceSegment[],
): ExploredSpaceBounds {
  const maximumRadius = allPoints(segments).reduce(
    (maximum, point) => Math.max(maximum, exploredRadiusMeters(point)),
    MIN_RADIUS_METERS,
  );
  return {
    minX: bounds.minX - maximumRadius,
    minY: bounds.minY - maximumRadius,
    maxX: bounds.maxX + maximumRadius,
    maxY: bounds.maxY + maximumRadius,
  };
}

function createProjection(
  bounds: ExploredSpaceBounds,
  segments: readonly ExploredSpaceSegment[],
  width: number,
  height: number,
  padding: number,
): Projection | null {
  if (width <= 0 || height <= 0) {
    return null;
  }
  const expanded = expandBounds(bounds, segments);
  const rangeX = Math.max(1, expanded.maxX - expanded.minX);
  const rangeY = Math.max(1, expanded.maxY - expanded.minY);
  const usableWidth = Math.max(1, width - padding * 2);
  const usableHeight = Math.max(1, height - padding * 2);
  const scale = Math.min(usableWidth / rangeX, usableHeight / rangeY);
  const usedWidth = rangeX * scale;
  const usedHeight = rangeY * scale;
  return {
    scale,
    offsetX: (width - usedWidth) / 2,
    offsetY: (height - usedHeight) / 2,
    bounds: expanded,
    width,
    height,
  };
}

export function projectExploredPoint(
  projection: Projection,
  point: Pick<ExploredSpacePoint, "xMeters" | "yMeters">,
): { readonly x: number; readonly y: number } {
  return {
    x:
      projection.offsetX +
      (point.xMeters - projection.bounds.minX) * projection.scale,
    y:
      projection.height -
      (projection.offsetY +
        (point.yMeters - projection.bounds.minY) * projection.scale),
  };
}

function decimateScreenPoints(
  points: readonly ScreenPoint[],
  minimumDistancePixels: number,
  maximumPoints: number,
): readonly ScreenPoint[] {
  if (points.length <= 2) {
    return points;
  }
  const kept: ScreenPoint[] = [points[0]!];
  let last = points[0]!;
  const stride = Math.max(1, Math.ceil(points.length / maximumPoints));
  for (let index = 1; index < points.length - 1; index += 1) {
    const point = points[index]!;
    const distance = Math.hypot(point.x - last.x, point.y - last.y);
    if (distance >= minimumDistancePixels || index % stride === 0) {
      kept.push(point);
      last = point;
    }
  }
  const finalPoint = points.at(-1)!;
  if (kept.at(-1)?.source.sampleId !== finalPoint.source.sampleId) {
    kept.push(finalPoint);
  }
  if (kept.length <= maximumPoints) {
    return kept;
  }
  const reduced: ScreenPoint[] = [];
  const finalStride = Math.ceil(kept.length / maximumPoints);
  for (let index = 0; index < kept.length; index += finalStride) {
    reduced.push(kept[index]!);
  }
  if (reduced.at(-1)?.source.sampleId !== finalPoint.source.sampleId) {
    reduced.push(finalPoint);
  }
  return reduced;
}

function projectSegments(
  segments: readonly ExploredSpaceSegment[],
  projection: Projection,
): readonly ProjectedSegment[] {
  const totalPointCount = segments.reduce(
    (sum, segment) => sum + segment.points.length,
    0,
  );
  const perSegmentMaximum = Math.max(
    4,
    Math.floor(MAX_RENDERED_POINTS / Math.max(1, segments.length)),
  );
  const pixelThreshold = totalPointCount > 2_000 ? 2.5 : 1.25;
  return segments.map((segment) => {
    const projected = segment.points.map((point) => ({
      ...projectExploredPoint(projection, point),
      source: point,
    }));
    return {
      id: segment.id,
      points: decimateScreenPoints(
        projected,
        pixelThreshold,
        perSegmentMaximum,
      ),
    };
  });
}

function buildCorridors(
  segments: readonly ProjectedSegment[],
  projection: Projection,
): readonly CorridorPrimitive[] {
  return segments.flatMap((segment) =>
    segment.points.slice(1).flatMap((point, index) => {
      const previous = segment.points[index];
      if (previous === undefined) {
        return [];
      }
      const deltaX = point.x - previous.x;
      const deltaY = point.y - previous.y;
      const length = Math.hypot(deltaX, deltaY);
      if (length < 0.25) {
        return [];
      }
      const radiusMeters = Math.max(
        exploredRadiusMeters(previous.source),
        exploredRadiusMeters(point.source),
      );
      const width = clamp(radiusMeters * 2 * projection.scale, 10, 58);
      const confidence = clamp(
        Math.min(previous.source.confidence, point.source.confidence),
        0,
        1,
      );
      return [
        {
          id: `${segment.id}:${previous.source.sampleId}:${point.source.sampleId}`,
          left: (previous.x + point.x) / 2 - length / 2,
          top: (previous.y + point.y) / 2 - width / 2,
          length,
          angleRadians: Math.atan2(deltaY, deltaX),
          width,
          opacity: 0.07 + confidence * 0.09,
        },
      ];
    }),
  );
}

interface MutableCell {
  readonly xIndex: number;
  readonly yIndex: number;
  visits: number;
  confidenceSum: number;
  maximumConfidence: number;
}

function chooseCellSizeMeters(
  bounds: ExploredSpaceBounds,
  pointCount: number,
): number {
  const width = Math.max(1, bounds.maxX - bounds.minX);
  const height = Math.max(1, bounds.maxY - bounds.minY);
  const area = width * height;
  const areaLimited = Math.sqrt(area / MAX_CELLS);
  const dimensionLimited = Math.max(width, height) / 120;
  const densityLimited = pointCount > 5_000 ? 10 : pointCount > 1_500 ? 8 : 6;
  return clamp(
    Math.max(areaLimited, dimensionLimited, densityLimited),
    6,
    60,
  );
}

function markCoverageDisc(
  cells: Map<string, MutableCell>,
  xMeters: number,
  yMeters: number,
  radiusMeters: number,
  confidence: number,
  cellSizeMeters: number,
): void {
  const minimumX = Math.floor((xMeters - radiusMeters) / cellSizeMeters);
  const maximumX = Math.floor((xMeters + radiusMeters) / cellSizeMeters);
  const minimumY = Math.floor((yMeters - radiusMeters) / cellSizeMeters);
  const maximumY = Math.floor((yMeters + radiusMeters) / cellSizeMeters);
  const halfDiagonal = (cellSizeMeters * Math.SQRT2) / 2;
  for (let xIndex = minimumX; xIndex <= maximumX; xIndex += 1) {
    for (let yIndex = minimumY; yIndex <= maximumY; yIndex += 1) {
      const centerX = (xIndex + 0.5) * cellSizeMeters;
      const centerY = (yIndex + 0.5) * cellSizeMeters;
      if (
        Math.hypot(centerX - xMeters, centerY - yMeters) >
        radiusMeters + halfDiagonal
      ) {
        continue;
      }
      const id = `${xIndex}:${yIndex}`;
      const existing = cells.get(id);
      if (existing === undefined) {
        cells.set(id, {
          xIndex,
          yIndex,
          visits: 1,
          confidenceSum: confidence,
          maximumConfidence: confidence,
        });
      } else {
        existing.visits += 1;
        existing.confidenceSum += confidence;
        existing.maximumConfidence = Math.max(
          existing.maximumConfidence,
          confidence,
        );
      }
    }
  }
}

function buildCoverageCells(
  sourceSegments: readonly ExploredSpaceSegment[],
  projection: Projection,
): {
  readonly cells: readonly CoverageCellPrimitive[];
  readonly cellSizeMeters: number;
} {
  const pointCount = sourceSegments.reduce(
    (sum, segment) => sum + segment.points.length,
    0,
  );
  const cellSizeMeters = chooseCellSizeMeters(projection.bounds, pointCount);
  const cells = new Map<string, MutableCell>();

  for (const segment of sourceSegments) {
    for (let index = 0; index < segment.points.length; index += 1) {
      const point = segment.points[index]!;
      const confidence = clamp(point.confidence, 0, 1);
      const radius = exploredRadiusMeters(point);
      markCoverageDisc(
        cells,
        point.xMeters,
        point.yMeters,
        radius,
        confidence,
        cellSizeMeters,
      );

      const next = segment.points[index + 1];
      if (next === undefined) {
        continue;
      }
      const distance = Math.hypot(
        next.xMeters - point.xMeters,
        next.yMeters - point.yMeters,
      );
      const interpolationSteps = Math.min(
        24,
        Math.max(0, Math.ceil(distance / (cellSizeMeters * 0.75)) - 1),
      );
      for (let step = 1; step <= interpolationSteps; step += 1) {
        const ratio = step / (interpolationSteps + 1);
        markCoverageDisc(
          cells,
          point.xMeters + (next.xMeters - point.xMeters) * ratio,
          point.yMeters + (next.yMeters - point.yMeters) * ratio,
          Math.max(radius, exploredRadiusMeters(next)),
          Math.min(confidence, clamp(next.confidence, 0, 1)),
          cellSizeMeters,
        );
      }
    }
  }

  let ordered = [...cells.values()].sort(
    (first, second) =>
      first.yIndex - second.yIndex || first.xIndex - second.xIndex,
  );
  if (ordered.length > MAX_CELLS) {
    ordered = ordered
      .sort(
        (first, second) =>
          second.maximumConfidence - first.maximumConfidence ||
          second.visits - first.visits,
      )
      .slice(0, MAX_CELLS)
      .sort(
        (first, second) =>
          first.yIndex - second.yIndex || first.xIndex - second.xIndex,
      );
  }

  const screenCellSize = Math.max(2, cellSizeMeters * projection.scale);
  return {
    cellSizeMeters,
    cells: ordered.map((cell) => {
      const topLeft = projectExploredPoint(projection, {
        xMeters: cell.xIndex * cellSizeMeters,
        yMeters: (cell.yIndex + 1) * cellSizeMeters,
      });
      const confidence = clamp(
        cell.confidenceSum / Math.max(1, cell.visits),
        0,
        1,
      );
      const revisitBoost = Math.min(0.09, Math.log2(cell.visits + 1) * 0.025);
      return {
        id: `${cell.xIndex}:${cell.yIndex}`,
        left: topLeft.x,
        top: topLeft.y,
        size: screenCellSize,
        opacity: 0.12 + confidence * 0.14 + revisitBoost,
        visits: cell.visits,
        confidence,
      };
    }),
  };
}

export function buildExploredSpaceGeometry(input: {
  readonly segments: readonly ExploredSpaceSegment[];
  readonly bounds: ExploredSpaceBounds | null;
  readonly width: number;
  readonly height: number;
  readonly padding?: number;
}): ExploredSpaceGeometry {
  const pointCount = input.segments.reduce(
    (sum, segment) => sum + segment.points.length,
    0,
  );
  if (input.bounds === null || pointCount === 0) {
    return {
      projection: null,
      segments: [],
      corridors: [],
      cells: [],
      pointCount,
      cellSizeMeters: null,
    };
  }
  const projection = createProjection(
    input.bounds,
    input.segments,
    input.width,
    input.height,
    input.padding ?? 34,
  );
  if (projection === null) {
    return {
      projection: null,
      segments: [],
      corridors: [],
      cells: [],
      pointCount,
      cellSizeMeters: null,
    };
  }
  const segments = projectSegments(input.segments, projection);
  const coverage = buildCoverageCells(input.segments, projection);
  return {
    projection,
    segments,
    corridors: buildCorridors(segments, projection),
    cells: coverage.cells,
    pointCount,
    cellSizeMeters: coverage.cellSizeMeters,
  };
}
