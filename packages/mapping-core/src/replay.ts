import type { ExplorationSession, MapMarker, RawPositionSample } from "./model.ts";
import {
  addMarker,
  appendPositionSample,
  createExplorationSession,
  endExploration,
} from "./session.ts";
import type { QualityPolicy } from "./quality.ts";

export interface ReplayExplorationInput {
  readonly id: string;
  readonly name: string;
  readonly startedAtMs: number;
  readonly endedAtMs?: number;
  readonly samples: readonly RawPositionSample[];
  readonly markers?: readonly MapMarker[];
  readonly localFrameLabel?: string;
}

export function replayExploration(
  input: ReplayExplorationInput,
  policy?: QualityPolicy,
): ExplorationSession {
  let current = createExplorationSession({
    id: input.id,
    name: input.name,
    startedAtMs: input.startedAtMs,
    ...(input.localFrameLabel === undefined
      ? {}
      : { localFrameLabel: input.localFrameLabel }),
  }).session;

  const samples = [...input.samples].sort(
    (first, second) => first.recordedAtMs - second.recordedAtMs,
  );
  const samplesBeforeOrAtEnd =
    input.endedAtMs === undefined
      ? samples
      : samples.filter((sample) => sample.recordedAtMs <= input.endedAtMs!);
  const samplesAfterEnd =
    input.endedAtMs === undefined
      ? []
      : samples.filter((sample) => sample.recordedAtMs > input.endedAtMs!);

  for (const sample of samplesBeforeOrAtEnd) {
    current = appendPositionSample(current, sample, policy).session;
  }

  if (input.endedAtMs !== undefined) {
    current = endExploration(current, input.endedAtMs).session;
  }

  // A platform callback can arrive after the user stopped an exploration.
  // Preserve that raw observation, but replay it against the completed session
  // so it remains excluded from the canonical derived track.
  for (const sample of samplesAfterEnd) {
    current = appendPositionSample(current, sample, policy).session;
  }

  const markers = [...(input.markers ?? [])].sort(
    (first, second) => first.recordedAtMs - second.recordedAtMs,
  );
  for (const marker of markers) {
    current = addMarker(current, {
      id: marker.id,
      recordedAtMs: marker.recordedAtMs,
      category: marker.category,
      label: marker.label,
      ...(marker.note === undefined ? {} : { note: marker.note }),
      ...(marker.xMeters === undefined ? {} : { xMeters: marker.xMeters }),
      ...(marker.yMeters === undefined ? {} : { yMeters: marker.yMeters }),
      ...(marker.sourcePosition === undefined
        ? {}
        : { sourcePosition: marker.sourcePosition }),
    }).session;
  }

  return current;
}
