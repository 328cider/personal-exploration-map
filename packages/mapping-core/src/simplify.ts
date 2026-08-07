import type { TrackPoint } from "./model.ts";

function squaredDistanceToSegment(
  point: TrackPoint,
  start: TrackPoint,
  end: TrackPoint,
): number {
  const segmentX = end.xMeters - start.xMeters;
  const segmentY = end.yMeters - start.yMeters;

  if (segmentX === 0 && segmentY === 0) {
    return (
      (point.xMeters - start.xMeters) ** 2 +
      (point.yMeters - start.yMeters) ** 2
    );
  }

  const projection =
    ((point.xMeters - start.xMeters) * segmentX +
      (point.yMeters - start.yMeters) * segmentY) /
    (segmentX * segmentX + segmentY * segmentY);
  const clamped = Math.max(0, Math.min(1, projection));
  const projectedX = start.xMeters + clamped * segmentX;
  const projectedY = start.yMeters + clamped * segmentY;

  return (
    (point.xMeters - projectedX) ** 2 +
    (point.yMeters - projectedY) ** 2
  );
}

function simplifyRange(
  points: readonly TrackPoint[],
  firstIndex: number,
  lastIndex: number,
  squaredTolerance: number,
  keep: Set<number>,
): void {
  const start = points[firstIndex];
  const end = points[lastIndex];
  if (start === undefined || end === undefined) {
    return;
  }

  let farthestDistance = 0;
  let farthestIndex = -1;

  for (let index = firstIndex + 1; index < lastIndex; index += 1) {
    const point = points[index];
    if (point === undefined) {
      continue;
    }
    const distance = squaredDistanceToSegment(point, start, end);
    if (distance > farthestDistance) {
      farthestDistance = distance;
      farthestIndex = index;
    }
  }

  if (farthestIndex === -1 || farthestDistance <= squaredTolerance) {
    return;
  }

  keep.add(farthestIndex);
  simplifyRange(points, firstIndex, farthestIndex, squaredTolerance, keep);
  simplifyRange(points, farthestIndex, lastIndex, squaredTolerance, keep);
}

export function simplifyTrack(
  points: readonly TrackPoint[],
  toleranceMeters: number,
): readonly TrackPoint[] {
  if (points.length <= 2 || toleranceMeters <= 0) {
    return [...points];
  }

  const keep = new Set<number>([0, points.length - 1]);
  simplifyRange(
    points,
    0,
    points.length - 1,
    toleranceMeters * toleranceMeters,
    keep,
  );

  return [...keep]
    .sort((first, second) => first - second)
    .map((index) => points[index])
    .filter((point): point is TrackPoint => point !== undefined);
}
