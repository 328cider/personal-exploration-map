export const FRESH_LOCATION_MAX_AGE_MS = 30_000;
const FUTURE_TIMESTAMP_TOLERANCE_MS = 1_000;

export type LocationFreshnessState =
  | "missing"
  | "future"
  | "fresh"
  | "stale";

export interface LocationFreshness {
  readonly state: LocationFreshnessState;
  readonly ageMs: number | null;
}

export function classifyLocationFreshness(
  recordedAtMs: number | null,
  nowMs = Date.now(),
): LocationFreshness {
  if (
    recordedAtMs === null ||
    !Number.isFinite(recordedAtMs) ||
    !Number.isFinite(nowMs)
  ) {
    return { state: "missing", ageMs: null };
  }

  const ageMs = nowMs - recordedAtMs;
  if (ageMs < -FUTURE_TIMESTAMP_TOLERANCE_MS) {
    return { state: "future", ageMs: null };
  }

  const normalizedAgeMs = Math.max(0, ageMs);
  return {
    state:
      normalizedAgeMs <= FRESH_LOCATION_MAX_AGE_MS ? "fresh" : "stale",
    ageMs: normalizedAgeMs,
  };
}

export function formatLocationAge(ageMs: number | null): string {
  if (ageMs === null || !Number.isFinite(ageMs)) {
    return "—";
  }
  if (ageMs < 60_000) {
    return `${Math.max(0, Math.round(ageMs / 1_000))}秒前`;
  }
  if (ageMs < 60 * 60_000) {
    return `${Math.round(ageMs / 60_000)}分前`;
  }
  return `${Math.round(ageMs / (60 * 60_000))}時間前`;
}

export function freshnessMessage(freshness: LocationFreshness): string {
  switch (freshness.state) {
    case "missing":
      return "位置を取得しています";
    case "future":
      return "位置の時刻を確認しています";
    case "fresh":
      return `最終受信位置 ${formatLocationAge(freshness.ageMs)}`;
    case "stale":
      return `位置更新が遅れています（${formatLocationAge(freshness.ageMs)}）`;
  }
}
