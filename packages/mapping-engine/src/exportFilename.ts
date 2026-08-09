import {
  PersonalMapExportError,
  type PersonalMapExportFormat,
} from "./export.ts";

export interface PersonalMapExportFilenameOptions {
  readonly format: PersonalMapExportFormat;
  /**
   * Explicit generation timestamp. Callers should use the same value in the
   * export metadata so file naming remains deterministic and auditable.
   */
  readonly generatedAtMs: number;
}

const EXTENSION_BY_FORMAT: Readonly<
  Record<PersonalMapExportFormat, "gpx" | "geojson">
> = {
  "gpx-1.1": "gpx",
  geojson: "geojson",
};

function compactUtcTimestamp(generatedAtMs: number): string {
  if (!Number.isFinite(generatedAtMs)) {
    throw new PersonalMapExportError(
      "invalid-timestamp",
      "An export filename requires a finite generation timestamp.",
    );
  }

  const date = new Date(generatedAtMs);
  if (Number.isNaN(date.getTime())) {
    throw new PersonalMapExportError(
      "invalid-timestamp",
      "An export filename requires a valid generation timestamp.",
    );
  }

  // ISO UTC with punctuation removed so the result is portable across Android,
  // Windows, macOS, Linux, share providers, and ZIP containers.
  return date
    .toISOString()
    .replaceAll("-", "")
    .replaceAll(":", "")
    .replace(".", "");
}

/**
 * Creates a location-neutral default filename for an explicit user export.
 *
 * The function intentionally accepts neither PersonalMap name nor coordinates,
 * preventing an adapter from accidentally leaking a place, address, marker, or
 * user label into the default filename. Collision resistance comes from the UTC
 * timestamp including milliseconds; adapters may ask the user before replacing
 * an existing file but must not append location-derived text automatically.
 */
export function createPersonalMapExportFilename(
  options: PersonalMapExportFilenameOptions,
): string {
  const extension = EXTENSION_BY_FORMAT[options.format];
  return `personal-map-${compactUtcTimestamp(options.generatedAtMs)}.${extension}`;
}
