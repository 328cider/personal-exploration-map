import assert from "node:assert/strict";

import type {
  MapMarker,
  PersonalMapSnapshot,
  PersonalMapTrackSegment,
  TrackPoint,
} from "@exploration-map/mapping-core";

import { buildTrackCanvasGeometry } from "../src/rendering/trackGeometry.ts";

interface BenchmarkScenario {
  readonly name: string;
  readonly pointCount: number;
  readonly segmentCount: number;
  readonly markerCount: number;
}

const SCENARIOS: readonly BenchmarkScenario[] = [
  { name: "m0-small", pointCount: 1_000, segmentCount: 1, markerCount: 10 },
  { name: "m1-growing", pointCount: 5_000, segmentCount: 20, markerCount: 50 },
  { name: "stress", pointCount: 10_000, segmentCount: 100, markerCount: 100 },
];

function point(
  segmentIndex: number,
  pointIndex: number,
  globalIndex: number,
): TrackPoint {
  const xMeters = segmentIndex * 30 + pointIndex * 1.2;
  const yMeters =
    segmentIndex * 18 +
    Math.sin(pointIndex / 8) * 14 +
    Math.cos(pointIndex / 31) * 4;
  const lowConfidence = globalIndex % 37 >= 31;

  return {
    sampleId: `sample-${globalIndex}`,
    recordedAtMs: globalIndex * 1_000,
    source: "simulation",
    sourcePosition: {
      kind: "local",
      xMeters,
      yMeters,
    },
    xMeters,
    yMeters,
    confidence: lowConfidence ? 0.32 : 0.9,
  };
}

function createSnapshot(
  scenario: BenchmarkScenario,
): PersonalMapSnapshot {
  const basePointsPerSegment = Math.floor(
    scenario.pointCount / scenario.segmentCount,
  );
  let remainder = scenario.pointCount % scenario.segmentCount;
  let globalIndex = 0;
  const segments: PersonalMapTrackSegment[] = [];
  const allPoints: TrackPoint[] = [];

  for (
    let segmentIndex = 0;
    segmentIndex < scenario.segmentCount;
    segmentIndex += 1
  ) {
    const length = basePointsPerSegment + (remainder > 0 ? 1 : 0);
    remainder = Math.max(0, remainder - 1);
    const track: TrackPoint[] = [];
    for (let pointIndex = 0; pointIndex < length; pointIndex += 1) {
      const item = point(segmentIndex, pointIndex, globalIndex);
      track.push(item);
      allPoints.push(item);
      globalIndex += 1;
    }
    segments.push({
      explorationId: `exploration-${segmentIndex}`,
      startedAtMs: segmentIndex * 1_000_000,
      endedAtMs: segmentIndex * 1_000_000 + length * 1_000,
      track,
    });
  }

  const markers: MapMarker[] = [];
  for (let markerIndex = 0; markerIndex < scenario.markerCount; markerIndex += 1) {
    const source = allPoints[
      Math.floor(
        (markerIndex / Math.max(1, scenario.markerCount - 1)) *
          Math.max(0, allPoints.length - 1),
      )
    ];
    if (source === undefined) {
      continue;
    }
    markers.push({
      id: `marker-${markerIndex}`,
      recordedAtMs: source.recordedAtMs,
      category: markerIndex % 2 === 0 ? "interesting" : "junction",
      label: `Marker ${markerIndex}`,
      xMeters: source.xMeters,
      yMeters: source.yMeters,
      sourcePosition: source.sourcePosition,
    });
  }

  return {
    personalMapId: `benchmark-${scenario.name}`,
    name: scenario.name,
    frame: { kind: "local", label: "benchmark-space" },
    segments,
    markers,
    bounds:
      allPoints.length === 0
        ? null
        : {
            minX: Math.min(...allPoints.map((item) => item.xMeters)),
            minY: Math.min(...allPoints.map((item) => item.yMeters)),
            maxX: Math.max(...allPoints.map((item) => item.xMeters)),
            maxY: Math.max(...allPoints.map((item) => item.yMeters)),
          },
    stats: {
      explorationCount: segments.length,
      rawSampleCount: allPoints.length,
      acceptedSampleCount: allPoints.length,
      rejectedSampleCount: 0,
      distanceMeters: 0,
      durationMs: segments.reduce(
        (sum, segment) =>
          sum + Math.max(0, (segment.endedAtMs ?? 0) - segment.startedAtMs),
        0,
      ),
      markerCount: markers.length,
    },
    revision: allPoints.length + markers.length,
  };
}

function percentile(
  values: readonly number[],
  proportion: number,
): number {
  const sorted = [...values].sort((first, second) => first - second);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * proportion) - 1),
  );
  return sorted[index] ?? 0;
}

for (const scenario of SCENARIOS) {
  const snapshot = createSnapshot(scenario);

  for (let warmup = 0; warmup < 2; warmup += 1) {
    buildTrackCanvasGeometry({
      snapshot,
      width: 1_080,
      height: 720,
      padding: 34,
    });
  }

  const durationsMs: number[] = [];
  let lastGeometry: ReturnType<typeof buildTrackCanvasGeometry> | undefined;
  for (let iteration = 0; iteration < 7; iteration += 1) {
    const startedAt = performance.now();
    lastGeometry = buildTrackCanvasGeometry({
      snapshot,
      width: 1_080,
      height: 720,
      padding: 34,
    });
    durationsMs.push(performance.now() - startedAt);
  }

  assert.notEqual(lastGeometry, undefined);
  assert.equal(lastGeometry?.pointCount, scenario.pointCount);
  assert.equal(lastGeometry?.explorationCount, scenario.segmentCount);
  assert.equal(lastGeometry?.markers.length, scenario.markerCount);
  assert.equal(
    lastGeometry?.strokes.every((stroke) =>
      stroke.explorationId.startsWith("exploration-"),
    ),
    true,
  );

  console.log(
    JSON.stringify({
      renderer: "react-native-svg-geometry",
      scenario: scenario.name,
      points: scenario.pointCount,
      segments: scenario.segmentCount,
      markers: scenario.markerCount,
      strokes: lastGeometry?.strokes.length ?? 0,
      medianMs: Number(percentile(durationsMs, 0.5).toFixed(3)),
      p95Ms: Number(percentile(durationsMs, 0.95).toFixed(3)),
      maximumMs: Number(Math.max(...durationsMs).toFixed(3)),
      note: "CPU geometry/path construction only; Android frame stability requires real-device validation",
    }),
  );
}
