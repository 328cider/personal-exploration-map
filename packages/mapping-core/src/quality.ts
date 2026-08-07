import { distanceBetweenPositions } from "./geo.ts";
import type {
  RawPositionSample,
  RejectionReason,
  TrackPoint,
} from "./model.ts";

export interface QualityPolicy {
  readonly maxHorizontalAccuracyMeters: number;
  readonly maxPlausibleSpeedMetersPerSecond: number;
  readonly minimumTimestampDeltaMs: number;
  readonly jumpAccuracyMultiplier: number;
}

export const DEFAULT_QUALITY_POLICY: QualityPolicy = {
  maxHorizontalAccuracyMeters: 100,
  maxPlausibleSpeedMetersPerSecond: 25,
  minimumTimestampDeltaMs: 100,
  jumpAccuracyMultiplier: 2,
};

export interface QualityAssessment {
  readonly accepted: boolean;
  readonly reason?: RejectionReason;
}

function isFiniteNumber(value: number): boolean {
  return Number.isFinite(value);
}

function hasValidCoordinate(sample: RawPositionSample): boolean {
  const { position } = sample;
  if (position.kind === "geographic") {
    return (
      isFiniteNumber(position.latitude) &&
      isFiniteNumber(position.longitude) &&
      position.latitude >= -90 &&
      position.latitude <= 90 &&
      position.longitude >= -180 &&
      position.longitude <= 180
    );
  }

  return isFiniteNumber(position.xMeters) && isFiniteNumber(position.yMeters);
}

function previousPointAsSample(point: TrackPoint): RawPositionSample {
  const base = {
    id: point.sampleId,
    recordedAtMs: point.recordedAtMs,
    source: point.source,
    position: point.sourcePosition,
    confidence: point.confidence,
  } satisfies Pick<
    RawPositionSample,
    "id" | "recordedAtMs" | "source" | "position" | "confidence"
  >;

  if (point.horizontalAccuracyMeters === undefined) {
    return base;
  }

  return {
    ...base,
    horizontalAccuracyMeters: point.horizontalAccuracyMeters,
  };
}

export function assessSampleQuality(
  previousAcceptedPoint: TrackPoint | undefined,
  candidate: RawPositionSample,
  policy: QualityPolicy = DEFAULT_QUALITY_POLICY,
): QualityAssessment {
  if (!hasValidCoordinate(candidate)) {
    return { accepted: false, reason: "invalid-coordinate" };
  }

  if (
    !Number.isFinite(candidate.confidence) ||
    candidate.confidence < 0 ||
    candidate.confidence > 1
  ) {
    return { accepted: false, reason: "invalid-confidence" };
  }

  if (
    candidate.horizontalAccuracyMeters !== undefined &&
    (!Number.isFinite(candidate.horizontalAccuracyMeters) ||
      candidate.horizontalAccuracyMeters < 0 ||
      candidate.horizontalAccuracyMeters > policy.maxHorizontalAccuracyMeters)
  ) {
    return { accepted: false, reason: "accuracy-too-low" };
  }

  if (previousAcceptedPoint === undefined) {
    return { accepted: true };
  }

  const previous = previousPointAsSample(previousAcceptedPoint);
  const elapsedMs = candidate.recordedAtMs - previous.recordedAtMs;
  if (elapsedMs < policy.minimumTimestampDeltaMs) {
    return { accepted: false, reason: "timestamp-not-increasing" };
  }

  const distanceMeters = distanceBetweenPositions(
    previous.position,
    candidate.position,
  );
  if (distanceMeters === null) {
    return { accepted: false, reason: "coordinate-frame-mismatch" };
  }

  const speedMetersPerSecond = distanceMeters / (elapsedMs / 1000);
  const previousAccuracy = previous.horizontalAccuracyMeters ?? 0;
  const candidateAccuracy = candidate.horizontalAccuracyMeters ?? 0;
  const accuracyAllowance =
    (previousAccuracy + candidateAccuracy) * policy.jumpAccuracyMultiplier + 5;

  if (
    speedMetersPerSecond > policy.maxPlausibleSpeedMetersPerSecond &&
    distanceMeters > accuracyAllowance
  ) {
    return { accepted: false, reason: "implausible-jump" };
  }

  return { accepted: true };
}
