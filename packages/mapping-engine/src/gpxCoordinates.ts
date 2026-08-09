const GPX_MIN_LONGITUDE = -180;
const GPX_MAX_LONGITUDE_EXCLUSIVE = 180;

/**
 * Returns a longitude valid for the GPX 1.1 longitudeType.
 *
 * Geographic source evidence may represent the antimeridian as either +180 or
 * -180. GPX 1.1 accepts -180 but defines +180 as an exclusive upper bound, so
 * the equivalent +180 value is serialized as -180 without changing location.
 */
export function normalizeGpxLongitude(longitude: number): number {
  if (
    !Number.isFinite(longitude) ||
    longitude < GPX_MIN_LONGITUDE ||
    longitude > GPX_MAX_LONGITUDE_EXCLUSIVE
  ) {
    throw new RangeError(
      "GPX longitude must be finite and within the geographic [-180, 180] range.",
    );
  }
  return longitude === GPX_MAX_LONGITUDE_EXCLUSIVE
    ? GPX_MIN_LONGITUDE
    : longitude;
}
