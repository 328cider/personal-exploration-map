export type AntimeridianPosition =
  | readonly [longitude: number, latitude: number]
  | readonly [
      longitude: number,
      latitude: number,
      altitudeMeters: number,
    ];

export interface AntimeridianLineStringGeometry {
  readonly type: "LineString";
  readonly coordinates: readonly AntimeridianPosition[];
}

export interface AntimeridianMultiLineStringGeometry {
  readonly type: "MultiLineString";
  readonly coordinates: readonly (readonly AntimeridianPosition[])[];
}

export type AntimeridianSafeLineGeometry =
  | AntimeridianLineStringGeometry
  | AntimeridianMultiLineStringGeometry;

const ANTIMERIDIAN_EPSILON = 1e-10;

function round(value: number, digits: number): number {
  const scale = 10 ** digits;
  const rounded = Math.round((value + Number.EPSILON) * scale) / scale;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function withLongitude(
  position: AntimeridianPosition,
  longitude: number,
): AntimeridianPosition {
  return position.length === 3
    ? [longitude, position[1], position[2]]
    : [longitude, position[1]];
}

function equivalentBoundaryLongitude(
  longitude: number,
  nextLongitude: number,
): number {
  if (
    Math.abs(Math.abs(longitude) - 180) > ANTIMERIDIAN_EPSILON
  ) {
    return longitude;
  }
  if (longitude < 0 && nextLongitude > 0) {
    return 180;
  }
  if (longitude > 0 && nextLongitude < 0) {
    return -180;
  }
  return longitude;
}

function interpolateBoundary(
  start: AntimeridianPosition,
  end: AntimeridianPosition,
  adjustedEndLongitude: number,
  boundaryLongitude: number,
): AntimeridianPosition {
  const denominator = adjustedEndLongitude - start[0];
  const ratio =
    Math.abs(denominator) <= ANTIMERIDIAN_EPSILON
      ? 0
      : (boundaryLongitude - start[0]) / denominator;
  const latitude = round(
    start[1] + (end[1] - start[1]) * ratio,
    8,
  );
  if (start.length === 3 && end.length === 3) {
    return [
      boundaryLongitude,
      latitude,
      round(start[2] + (end[2] - start[2]) * ratio, 3),
    ];
  }
  return [boundaryLongitude, latitude];
}

function samePosition(
  first: AntimeridianPosition,
  second: AntimeridianPosition,
): boolean {
  return (
    first.length === second.length &&
    first.every((value, index) => value === second[index])
  );
}

function pushDistinct(
  positions: AntimeridianPosition[],
  position: AntimeridianPosition,
): void {
  const previous = positions.at(-1);
  if (previous === undefined || !samePosition(previous, position)) {
    positions.push(position);
  }
}

function assertLineStringCoordinates(
  coordinates: readonly AntimeridianPosition[],
): void {
  if (coordinates.length < 2) {
    throw new RangeError(
      "An antimeridian-safe LineString requires at least two positions.",
    );
  }
  for (const [index, position] of coordinates.entries()) {
    const [longitude, latitude, altitude] = position;
    if (
      !Number.isFinite(longitude) ||
      !Number.isFinite(latitude) ||
      longitude < -180 ||
      longitude > 180 ||
      latitude < -90 ||
      latitude > 90 ||
      (altitude !== undefined && !Number.isFinite(altitude))
    ) {
      throw new RangeError(
        `Invalid geographic position at LineString index ${index}.`,
      );
    }
  }
}

/**
 * Cuts a geographic LineString at the antimeridian as recommended by RFC 7946.
 *
 * The source order is preserved. A crossing inserts equivalent boundary points
 * at +180 and -180 so no output part contains a longitude jump larger than
 * 180 degrees. The operation is derived-only and does not alter source track
 * evidence or session membership.
 */
export function cutLineStringAtAntimeridian(
  coordinates: readonly AntimeridianPosition[],
): AntimeridianSafeLineGeometry {
  assertLineStringCoordinates(coordinates);

  const parts: AntimeridianPosition[][] = [];
  let current: AntimeridianPosition[] = [coordinates[0]!];

  for (let index = 1; index < coordinates.length; index += 1) {
    const next = coordinates[index]!;
    const previous = current.at(-1)!;
    const adjustedPreviousLongitude = equivalentBoundaryLongitude(
      previous[0],
      next[0],
    );
    if (adjustedPreviousLongitude !== previous[0]) {
      current[current.length - 1] = withLongitude(
        previous,
        adjustedPreviousLongitude,
      );
    }

    const adjustedPrevious = current.at(-1)!;
    const longitudeDelta = next[0] - adjustedPrevious[0];
    if (longitudeDelta >= -180 && longitudeDelta <= 180) {
      pushDistinct(current, next);
      continue;
    }

    const crossesEastward = longitudeDelta < -180;
    const adjustedEndLongitude = crossesEastward
      ? next[0] + 360
      : next[0] - 360;
    const currentBoundary = crossesEastward ? 180 : -180;
    const nextBoundary = crossesEastward ? -180 : 180;
    const boundary = interpolateBoundary(
      adjustedPrevious,
      next,
      adjustedEndLongitude,
      currentBoundary,
    );

    pushDistinct(current, boundary);
    if (current.length >= 2) {
      parts.push(current);
    }

    current = [withLongitude(boundary, nextBoundary)];
    pushDistinct(current, next);
  }

  if (current.length >= 2) {
    parts.push(current);
  }

  if (parts.length === 0) {
    throw new RangeError(
      "Antimeridian cutting produced no valid LineString parts.",
    );
  }
  if (parts.length === 1) {
    return {
      type: "LineString",
      coordinates: parts[0]!,
    };
  }
  return {
    type: "MultiLineString",
    coordinates: parts,
  };
}
