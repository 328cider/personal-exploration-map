import type {
  GeographicPosition,
  MapMarker,
  PersonalMapSnapshot,
  PersonalMapTrackSegment,
  TrackPoint,
} from "@exploration-map/mapping-core";

export type PersonalMapExportFormat = "gpx-1.1" | "geojson";

export type PersonalMapExportErrorCode =
  | "geographic-frame-required"
  | "invalid-geographic-position"
  | "invalid-timestamp";

export type PersonalMapExportWarningCode =
  | "segment-omitted-insufficient-points"
  | "marker-omitted-without-geographic-position";

export interface PersonalMapExportWarning {
  readonly code: PersonalMapExportWarningCode;
  readonly entityId: string;
  readonly message: string;
}

export interface PersonalMapTextExport {
  readonly format: PersonalMapExportFormat;
  readonly mediaType: string;
  readonly fileExtension: "gpx" | "geojson";
  readonly content: string;
  readonly warnings: readonly PersonalMapExportWarning[];
}

export interface GeographicExportOptions {
  /** Optional deterministic generation timestamp. Omitted when undefined. */
  readonly generatedAtMs?: number;
  readonly creator?: string;
  readonly pretty?: boolean;
}

export class PersonalMapExportError extends Error {
  readonly code: PersonalMapExportErrorCode;
  readonly entityId?: string;

  constructor(
    code: PersonalMapExportErrorCode,
    message: string,
    entityId?: string,
  ) {
    super(message);
    this.name = "PersonalMapExportError";
    this.code = code;
    this.entityId = entityId;
  }
}

export type GeoJsonPosition =
  | readonly [longitude: number, latitude: number]
  | readonly [longitude: number, latitude: number, altitudeMeters: number];

export interface GeoJsonLineStringFeature {
  readonly type: "Feature";
  readonly id: string;
  readonly geometry: {
    readonly type: "LineString";
    readonly coordinates: readonly GeoJsonPosition[];
  };
  readonly properties: {
    readonly kind: "exploration-track";
    readonly profile: "derived-map";
    readonly evidence: "derived-from-accepted-observations";
    readonly personalMapId: string;
    readonly explorationId: string;
    readonly startedAt: string;
    readonly endedAt?: string;
    readonly pointCount: number;
  };
}

export interface GeoJsonPointFeature {
  readonly type: "Feature";
  readonly id: string;
  readonly geometry: {
    readonly type: "Point";
    readonly coordinates: GeoJsonPosition;
  };
  readonly properties: {
    readonly kind: "confirmed-marker";
    readonly profile: "confirmed-evidence";
    readonly personalMapId: string;
    readonly markerId: string;
    readonly recordedAt: string;
    readonly category: MapMarker["category"];
    readonly label: string;
    readonly note?: string;
  };
}

export interface PersonalMapGeoJsonFeatureCollection {
  readonly type: "FeatureCollection";
  readonly name: string;
  readonly personalMapId: string;
  readonly profile: "derived-map";
  readonly revision: number;
  readonly generatedAt?: string;
  readonly features: readonly (
    | GeoJsonLineStringFeature
    | GeoJsonPointFeature
  )[];
}

export interface PersonalMapGeoJsonResult {
  readonly document: PersonalMapGeoJsonFeatureCollection;
  readonly warnings: readonly PersonalMapExportWarning[];
}

function assertGeographicFrame(snapshot: PersonalMapSnapshot): void {
  if (snapshot.frame.kind !== "geographic-local") {
    throw new PersonalMapExportError(
      "geographic-frame-required",
      "GPX and geographic GeoJSON export require a geographic PersonalMap frame. Local or unresolved frames must use the lossless PersonalMap bundle instead.",
      snapshot.personalMapId,
    );
  }
}

function assertValidGeographicPosition(
  position: GeographicPosition,
  entityId: string,
): GeographicPosition {
  const { latitude, longitude, altitudeMeters } = position;
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180 ||
    (altitudeMeters !== undefined && !Number.isFinite(altitudeMeters))
  ) {
    throw new PersonalMapExportError(
      "invalid-geographic-position",
      `Entity ${entityId} contains an invalid geographic position.`,
      entityId,
    );
  }
  return position;
}

function geographicPositionForTrackPoint(
  point: TrackPoint,
  explorationId: string,
): GeographicPosition {
  if (point.sourcePosition.kind !== "geographic") {
    throw new PersonalMapExportError(
      "invalid-geographic-position",
      `Accepted track point ${point.sampleId} in exploration ${explorationId} is not backed by a geographic source position.`,
      point.sampleId,
    );
  }
  return assertValidGeographicPosition(point.sourcePosition, point.sampleId);
}

function geographicPositionForMarker(
  marker: MapMarker,
): GeographicPosition | null {
  if (marker.sourcePosition?.kind !== "geographic") {
    return null;
  }
  return assertValidGeographicPosition(marker.sourcePosition, marker.id);
}

function isoTimestamp(value: number, entityId: string): string {
  if (!Number.isFinite(value)) {
    throw new PersonalMapExportError(
      "invalid-timestamp",
      `Entity ${entityId} contains a non-finite timestamp.`,
      entityId,
    );
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new PersonalMapExportError(
      "invalid-timestamp",
      `Entity ${entityId} contains an invalid timestamp.`,
      entityId,
    );
  }
  return date.toISOString();
}

function xmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function formatNumber(value: number, maximumFractionDigits: number): string {
  const fixed = value.toFixed(maximumFractionDigits);
  const trimmed = fixed.replace(/(?:\.0+|(?:(\.[0-9]*?)0+))$/, "$1");
  return trimmed === "-0" ? "0" : trimmed;
}

function geoJsonPosition(position: GeographicPosition): GeoJsonPosition {
  const longitude = Number(formatNumber(position.longitude, 8));
  const latitude = Number(formatNumber(position.latitude, 8));
  if (position.altitudeMeters === undefined) {
    return [longitude, latitude];
  }
  return [
    longitude,
    latitude,
    Number(formatNumber(position.altitudeMeters, 3)),
  ];
}

function markerWarnings(
  markers: readonly MapMarker[],
): PersonalMapExportWarning[] {
  return markers.flatMap((marker) =>
    marker.sourcePosition?.kind === "geographic"
      ? []
      : [
          {
            code: "marker-omitted-without-geographic-position" as const,
            entityId: marker.id,
            message: `Marker ${marker.id} was omitted because it has no geographic source position.`,
          },
        ],
  );
}

function gpxExtension(
  name: string,
  value: string | number,
  indentation: string,
): string {
  return `${indentation}<pem:${name}>${xmlEscape(String(value))}</pem:${name}>`;
}

function serializeGpxPoint(
  point: TrackPoint,
  explorationId: string,
): readonly string[] {
  const position = geographicPositionForTrackPoint(point, explorationId);
  const lines = [
    `      <trkpt lat="${formatNumber(position.latitude, 8)}" lon="${formatNumber(position.longitude, 8)}">`,
  ];
  if (position.altitudeMeters !== undefined) {
    lines.push(
      `        <ele>${formatNumber(position.altitudeMeters, 3)}</ele>`,
    );
  }
  lines.push(`        <time>${isoTimestamp(point.recordedAtMs, point.sampleId)}</time>`);
  lines.push("        <extensions>");
  lines.push(gpxExtension("sampleId", point.sampleId, "          "));
  lines.push(gpxExtension("source", point.source, "          "));
  lines.push(
    gpxExtension(
      "confidence",
      formatNumber(point.confidence, 6),
      "          ",
    ),
  );
  if (point.horizontalAccuracyMeters !== undefined) {
    lines.push(
      gpxExtension(
        "horizontalAccuracyMeters",
        formatNumber(point.horizontalAccuracyMeters, 3),
        "          ",
      ),
    );
  }
  lines.push("        </extensions>", "      </trkpt>");
  return lines;
}

function serializeGpxSegment(
  segment: PersonalMapTrackSegment,
): readonly string[] {
  const lines = ["    <trkseg>"];
  for (const point of segment.track) {
    lines.push(...serializeGpxPoint(point, segment.explorationId));
  }
  lines.push("      <extensions>");
  lines.push(
    gpxExtension("explorationId", segment.explorationId, "        "),
  );
  lines.push(
    gpxExtension(
      "startedAt",
      isoTimestamp(segment.startedAtMs, segment.explorationId),
      "        ",
    ),
  );
  if (segment.endedAtMs !== undefined) {
    lines.push(
      gpxExtension(
        "endedAt",
        isoTimestamp(segment.endedAtMs, segment.explorationId),
        "        ",
      ),
    );
  }
  lines.push("      </extensions>", "    </trkseg>");
  return lines;
}

function serializeGpxWaypoint(marker: MapMarker): readonly string[] | null {
  const position = geographicPositionForMarker(marker);
  if (position === null) {
    return null;
  }
  const lines = [
    `  <wpt lat="${formatNumber(position.latitude, 8)}" lon="${formatNumber(position.longitude, 8)}">`,
  ];
  if (position.altitudeMeters !== undefined) {
    lines.push(
      `    <ele>${formatNumber(position.altitudeMeters, 3)}</ele>`,
    );
  }
  lines.push(`    <time>${isoTimestamp(marker.recordedAtMs, marker.id)}</time>`);
  lines.push(`    <name>${xmlEscape(marker.label)}</name>`);
  if (marker.note !== undefined) {
    lines.push(`    <desc>${xmlEscape(marker.note)}</desc>`);
  }
  lines.push(`    <type>${xmlEscape(marker.category)}</type>`);
  lines.push("    <extensions>");
  lines.push(gpxExtension("markerId", marker.id, "      "));
  lines.push("    </extensions>", "  </wpt>");
  return lines;
}

export function serializePersonalMapGpx(
  snapshot: PersonalMapSnapshot,
  options: GeographicExportOptions = {},
): PersonalMapTextExport {
  assertGeographicFrame(snapshot);
  const creator = options.creator ?? "Personal Exploration Map";
  const warnings = markerWarnings(snapshot.markers);
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<gpx version="1.1" creator="${xmlEscape(creator)}" xmlns="http://www.topografix.com/GPX/1/1" xmlns:pem="https://github.com/328cider/personal-exploration-map/ns/1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">`,
    "  <metadata>",
    `    <name>${xmlEscape(snapshot.name)}</name>`,
  ];
  if (options.generatedAtMs !== undefined) {
    lines.push(
      `    <time>${isoTimestamp(options.generatedAtMs, snapshot.personalMapId)}</time>`,
    );
  }
  lines.push("  </metadata>");

  for (const marker of snapshot.markers) {
    const waypoint = serializeGpxWaypoint(marker);
    if (waypoint !== null) {
      lines.push(...waypoint);
    }
  }

  lines.push("  <trk>", `    <name>${xmlEscape(snapshot.name)}</name>`);
  lines.push("    <extensions>");
  lines.push(
    gpxExtension("personalMapId", snapshot.personalMapId, "      "),
  );
  lines.push(gpxExtension("revision", snapshot.revision, "      "));
  lines.push("    </extensions>");
  for (const segment of snapshot.segments) {
    lines.push(...serializeGpxSegment(segment));
  }
  lines.push("  </trk>", "</gpx>", "");

  return {
    format: "gpx-1.1",
    mediaType: "application/gpx+xml",
    fileExtension: "gpx",
    content: lines.join("\n"),
    warnings,
  };
}

function lineFeature(
  snapshot: PersonalMapSnapshot,
  segment: PersonalMapTrackSegment,
): GeoJsonLineStringFeature {
  const coordinates = segment.track.map((point) =>
    geoJsonPosition(
      geographicPositionForTrackPoint(point, segment.explorationId),
    ),
  );
  return {
    type: "Feature",
    id: `exploration:${segment.explorationId}`,
    geometry: {
      type: "LineString",
      coordinates,
    },
    properties: {
      kind: "exploration-track",
      profile: "derived-map",
      evidence: "derived-from-accepted-observations",
      personalMapId: snapshot.personalMapId,
      explorationId: segment.explorationId,
      startedAt: isoTimestamp(segment.startedAtMs, segment.explorationId),
      ...(segment.endedAtMs === undefined
        ? {}
        : { endedAt: isoTimestamp(segment.endedAtMs, segment.explorationId) }),
      pointCount: coordinates.length,
    },
  };
}

function markerFeature(
  snapshot: PersonalMapSnapshot,
  marker: MapMarker,
): GeoJsonPointFeature | null {
  const position = geographicPositionForMarker(marker);
  if (position === null) {
    return null;
  }
  return {
    type: "Feature",
    id: `marker:${marker.id}`,
    geometry: {
      type: "Point",
      coordinates: geoJsonPosition(position),
    },
    properties: {
      kind: "confirmed-marker",
      profile: "confirmed-evidence",
      personalMapId: snapshot.personalMapId,
      markerId: marker.id,
      recordedAt: isoTimestamp(marker.recordedAtMs, marker.id),
      category: marker.category,
      label: marker.label,
      ...(marker.note === undefined ? {} : { note: marker.note }),
    },
  };
}

export function buildPersonalMapGeoJson(
  snapshot: PersonalMapSnapshot,
  options: GeographicExportOptions = {},
): PersonalMapGeoJsonResult {
  assertGeographicFrame(snapshot);
  const warnings = markerWarnings(snapshot.markers);
  const features: (
    | GeoJsonLineStringFeature
    | GeoJsonPointFeature
  )[] = [];

  for (const segment of snapshot.segments) {
    if (segment.track.length < 2) {
      warnings.push({
        code: "segment-omitted-insufficient-points",
        entityId: segment.explorationId,
        message: `Exploration ${segment.explorationId} was omitted from GeoJSON because a LineString requires at least two geographic track points.`,
      });
      continue;
    }
    features.push(lineFeature(snapshot, segment));
  }

  for (const marker of snapshot.markers) {
    const feature = markerFeature(snapshot, marker);
    if (feature !== null) {
      features.push(feature);
    }
  }

  return {
    document: {
      type: "FeatureCollection",
      name: snapshot.name,
      personalMapId: snapshot.personalMapId,
      profile: "derived-map",
      revision: snapshot.revision,
      ...(options.generatedAtMs === undefined
        ? {}
        : {
            generatedAt: isoTimestamp(
              options.generatedAtMs,
              snapshot.personalMapId,
            ),
          }),
      features,
    },
    warnings,
  };
}

export function serializePersonalMapGeoJson(
  snapshot: PersonalMapSnapshot,
  options: GeographicExportOptions = {},
): PersonalMapTextExport {
  const result = buildPersonalMapGeoJson(snapshot, options);
  return {
    format: "geojson",
    mediaType: "application/geo+json",
    fileExtension: "geojson",
    content: `${JSON.stringify(
      result.document,
      null,
      options.pretty === false ? undefined : 2,
    )}\n`,
    warnings: result.warnings,
  };
}
