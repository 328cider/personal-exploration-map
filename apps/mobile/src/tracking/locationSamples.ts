import type * as Location from "expo-location";
import type { RawPositionSample } from "@exploration-map/mapping-core";

function confidenceFromAccuracy(accuracy: number | null): number {
  if (accuracy === null || !Number.isFinite(accuracy)) {
    return 0.5;
  }
  if (accuracy <= 5) {
    return 0.95;
  }
  if (accuracy >= 100) {
    return 0.1;
  }
  return Math.max(0.1, Math.min(0.95, 1 - accuracy / 120));
}

function coordinateToken(value: number): string {
  return value.toFixed(7).replaceAll("-", "m").replaceAll(".", "p");
}

/**
 * Produces a deterministic observation id for idempotent foreground and
 * background callbacks. The exploration id keeps equal platform observations
 * from different sessions distinct.
 */
export function locationObjectToRawSample(
  explorationId: string,
  location: Location.LocationObject,
): RawPositionSample {
  const recordedAtMs = Math.round(location.timestamp);
  const latitude = location.coords.latitude;
  const longitude = location.coords.longitude;
  const accuracy = location.coords.accuracy;

  return {
    id: [
      "gnss",
      explorationId,
      recordedAtMs,
      coordinateToken(latitude),
      coordinateToken(longitude),
    ].join("-"),
    recordedAtMs,
    source: "gnss",
    position: {
      kind: "geographic",
      latitude,
      longitude,
      ...(location.coords.altitude === null
        ? {}
        : { altitudeMeters: location.coords.altitude }),
    },
    ...(accuracy === null
      ? {}
      : { horizontalAccuracyMeters: accuracy }),
    ...(location.coords.heading === null || location.coords.heading < 0
      ? {}
      : { headingDegrees: location.coords.heading }),
    ...(location.coords.speed === null || location.coords.speed < 0
      ? {}
      : { speedMetersPerSecond: location.coords.speed }),
    confidence: confidenceFromAccuracy(accuracy),
  };
}

export function locationBatchToRawSamples(
  explorationId: string,
  locations: readonly Location.LocationObject[],
): readonly RawPositionSample[] {
  return locations.map((location) =>
    locationObjectToRawSample(explorationId, location),
  );
}
