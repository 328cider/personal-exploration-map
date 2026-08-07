import type {
  GeographicPosition,
  MapBounds,
  Position,
  TrackPoint,
} from "./model.ts";

const EARTH_RADIUS_METERS = 6_371_008.8;
const DEG_TO_RAD = Math.PI / 180;

export function haversineDistanceMeters(
  first: GeographicPosition,
  second: GeographicPosition,
): number {
  const latitude1 = first.latitude * DEG_TO_RAD;
  const latitude2 = second.latitude * DEG_TO_RAD;
  const deltaLatitude = (second.latitude - first.latitude) * DEG_TO_RAD;
  const deltaLongitude = (second.longitude - first.longitude) * DEG_TO_RAD;

  const sinLatitude = Math.sin(deltaLatitude / 2);
  const sinLongitude = Math.sin(deltaLongitude / 2);
  const a =
    sinLatitude * sinLatitude +
    Math.cos(latitude1) *
      Math.cos(latitude2) *
      sinLongitude *
      sinLongitude;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_METERS * c;
}

export function projectGeographicToLocal(
  position: GeographicPosition,
  originLatitude: number,
  originLongitude: number,
): { readonly xMeters: number; readonly yMeters: number } {
  const originLatitudeRadians = originLatitude * DEG_TO_RAD;
  const xMeters =
    (position.longitude - originLongitude) *
    DEG_TO_RAD *
    EARTH_RADIUS_METERS *
    Math.cos(originLatitudeRadians);
  const yMeters =
    (position.latitude - originLatitude) * DEG_TO_RAD * EARTH_RADIUS_METERS;
  return { xMeters, yMeters };
}

export function distanceBetweenPositions(
  first: Position,
  second: Position,
): number | null {
  if (first.kind !== second.kind) {
    return null;
  }

  if (first.kind === "geographic" && second.kind === "geographic") {
    return haversineDistanceMeters(first, second);
  }

  if (first.kind === "local" && second.kind === "local") {
    return Math.hypot(
      second.xMeters - first.xMeters,
      second.yMeters - first.yMeters,
    );
  }

  return null;
}

export function trackLengthMeters(track: readonly TrackPoint[]): number {
  let distance = 0;
  for (let index = 1; index < track.length; index += 1) {
    const previous = track[index - 1];
    const current = track[index];
    if (previous === undefined || current === undefined) {
      continue;
    }
    distance += Math.hypot(
      current.xMeters - previous.xMeters,
      current.yMeters - previous.yMeters,
    );
  }
  return distance;
}

export function calculateBounds(
  track: readonly TrackPoint[],
): MapBounds | null {
  const first = track[0];
  if (first === undefined) {
    return null;
  }

  let minX = first.xMeters;
  let maxX = first.xMeters;
  let minY = first.yMeters;
  let maxY = first.yMeters;

  for (const point of track.slice(1)) {
    minX = Math.min(minX, point.xMeters);
    maxX = Math.max(maxX, point.xMeters);
    minY = Math.min(minY, point.yMeters);
    maxY = Math.max(maxY, point.yMeters);
  }

  return { minX, minY, maxX, maxY };
}
