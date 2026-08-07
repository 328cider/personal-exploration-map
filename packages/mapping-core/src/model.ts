export type PositionSource = "gnss" | "pdr" | "manual" | "simulation";

export interface GeographicPosition {
  readonly kind: "geographic";
  readonly latitude: number;
  readonly longitude: number;
  readonly altitudeMeters?: number;
}

export interface LocalPosition {
  readonly kind: "local";
  readonly xMeters: number;
  readonly yMeters: number;
  readonly floor?: number;
}

export type Position = GeographicPosition | LocalPosition;

export interface RawPositionSample {
  readonly id: string;
  readonly recordedAtMs: number;
  readonly source: PositionSource;
  readonly position: Position;
  readonly horizontalAccuracyMeters?: number;
  readonly headingDegrees?: number;
  readonly speedMetersPerSecond?: number;
  readonly confidence: number;
}

export type RejectionReason =
  | "invalid-coordinate"
  | "invalid-confidence"
  | "timestamp-not-increasing"
  | "accuracy-too-low"
  | "implausible-jump"
  | "coordinate-frame-mismatch"
  | "session-not-recording";

export interface RejectedSample {
  readonly sampleId: string;
  readonly reason: RejectionReason;
}

export type MapFrame =
  | { readonly kind: "unresolved" }
  | {
      readonly kind: "geographic-local";
      readonly originLatitude: number;
      readonly originLongitude: number;
    }
  | {
      readonly kind: "local";
      readonly label?: string;
    };

export interface TrackPoint {
  readonly sampleId: string;
  readonly recordedAtMs: number;
  readonly source: PositionSource;
  readonly sourcePosition: Position;
  readonly xMeters: number;
  readonly yMeters: number;
  readonly horizontalAccuracyMeters?: number;
  readonly confidence: number;
}

export type MarkerCategory =
  | "interesting"
  | "entrance"
  | "junction"
  | "stairs"
  | "hazard"
  | "blocked"
  | "note"
  | "custom";

export interface MapMarker {
  readonly id: string;
  readonly recordedAtMs: number;
  readonly category: MarkerCategory;
  readonly label: string;
  readonly note?: string;
  readonly xMeters?: number;
  readonly yMeters?: number;
  readonly sourcePosition?: Position;
}

export type ExplorationStatus = "recording" | "completed";

export interface ExplorationSession {
  readonly id: string;
  readonly name: string;
  readonly status: ExplorationStatus;
  readonly startedAtMs: number;
  readonly endedAtMs?: number;
  readonly frame: MapFrame;
  readonly rawSamples: readonly RawPositionSample[];
  readonly rejectedSamples: readonly RejectedSample[];
  readonly track: readonly TrackPoint[];
  readonly markers: readonly MapMarker[];
  readonly revision: number;
}

export interface MapBounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export interface MapStats {
  readonly rawSampleCount: number;
  readonly acceptedSampleCount: number;
  readonly rejectedSampleCount: number;
  readonly distanceMeters: number;
  readonly durationMs: number;
  readonly markerCount: number;
}

export interface MapSnapshot {
  readonly explorationId: string;
  readonly frame: MapFrame;
  readonly track: readonly TrackPoint[];
  readonly markers: readonly MapMarker[];
  readonly bounds: MapBounds | null;
  readonly stats: MapStats;
  readonly revision: number;
}
