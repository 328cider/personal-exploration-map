import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";
import { resolve } from "node:path";

import { simplifyTrack } from "../src/simplify.ts";

const require = createRequire(import.meta.url);
const modulePath =
  process.env.SIMPLIFY_JS_PATH ??
  resolve(
    process.cwd(),
    ".tmp/simplify-js-benchmark/node_modules/simplify-js/simplify.js",
  );
const simplifyJs = require(modulePath);

const TOLERANCE_METERS = 1.5;

function trackPoint(id, xMeters, yMeters, confidence = 0.9) {
  return {
    sampleId: id,
    recordedAtMs: Number(id.replace(/\D/gu, "")) || 1,
    source: "simulation",
    sourcePosition: {
      kind: "local",
      xMeters,
      yMeters,
    },
    xMeters,
    yMeters,
    confidence,
  };
}

function noisyLine(pointCount) {
  return Array.from({ length: pointCount }, (_, index) =>
    trackPoint(
      `noisy-${index}`,
      index * 0.7,
      Math.sin(index / 18) * 5 + Math.sin(index * 1.73) * 0.35,
      index % 17 === 0 ? 0.4 : 0.9,
    ),
  );
}

function rectangularLoop(pointCount) {
  const sideLength = Math.max(2, Math.floor(pointCount / 4));
  return Array.from({ length: pointCount }, (_, index) => {
    const side = Math.min(3, Math.floor(index / sideLength));
    const offset = index % sideLength;
    switch (side) {
      case 0:
        return trackPoint(`loop-${index}`, offset, 0);
      case 1:
        return trackPoint(`loop-${index}`, sideLength, offset);
      case 2:
        return trackPoint(
          `loop-${index}`,
          sideLength - offset,
          sideLength,
        );
      default:
        return trackPoint(`loop-${index}`, 0, sideLength - offset);
    }
  });
}

function markerNearbyTurn(pointCount) {
  const corner = Math.floor(pointCount / 2);
  return Array.from({ length: pointCount }, (_, index) => {
    if (index <= corner) {
      return trackPoint(
        `marker-turn-${index}`,
        index,
        Math.sin(index / 10) * 0.2,
      );
    }
    return trackPoint(
      `marker-turn-${index}`,
      corner + Math.sin(index / 10) * 0.2,
      index - corner,
    );
  });
}

function gapSeparatedSegments(pointCount) {
  const half = Math.floor(pointCount / 2);
  return [
    Array.from({ length: half }, (_, index) =>
      trackPoint(
        `gap-a-${index}`,
        index * 0.8,
        Math.sin(index / 11) * 2,
      ),
    ),
    Array.from({ length: pointCount - half }, (_, index) =>
      trackPoint(
        `gap-b-${index}`,
        10_000 + index * 0.8,
        10_000 + Math.cos(index / 13) * 2,
      ),
    ),
  ];
}

function toSimplifyJsPoints(points) {
  // simplify-js reads x/y but returns the original object references. Keep all
  // domain metadata on each point to verify provenance survives adoption.
  return points.map((point) => ({
    ...point,
    x: point.xMeters,
    y: point.yMeters,
  }));
}

function ids(points) {
  return points.map((point) => point.sampleId);
}

function benchmark(operation, iterations) {
  for (let warmup = 0; warmup < 2; warmup += 1) {
    operation();
  }
  const durations = [];
  let result;
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const startedAt = performance.now();
    result = operation();
    durations.push(performance.now() - startedAt);
  }
  durations.sort((first, second) => first - second);
  const nearestRank = (proportion) =>
    durations[
      Math.min(
        durations.length - 1,
        Math.max(0, Math.ceil(durations.length * proportion) - 1),
      )
    ] ?? 0;
  return {
    result,
    medianMs: nearestRank(0.5),
    p95Ms: nearestRank(0.95),
    maximumMs: durations.at(-1) ?? 0,
  };
}

function squaredDistanceToSegment(point, start, end) {
  const segmentX = end.xMeters - start.xMeters;
  const segmentY = end.yMeters - start.yMeters;
  if (segmentX === 0 && segmentY === 0) {
    return (
      (point.xMeters - start.xMeters) ** 2 +
      (point.yMeters - start.yMeters) ** 2
    );
  }
  const projection =
    ((point.xMeters - start.xMeters) * segmentX +
      (point.yMeters - start.yMeters) * segmentY) /
    (segmentX * segmentX + segmentY * segmentY);
  const clamped = Math.max(0, Math.min(1, projection));
  const projectedX = start.xMeters + clamped * segmentX;
  const projectedY = start.yMeters + clamped * segmentY;
  return (
    (point.xMeters - projectedX) ** 2 +
    (point.yMeters - projectedY) ** 2
  );
}

function distanceToPolyline(point, polyline) {
  if (polyline.length === 0) {
    return Number.POSITIVE_INFINITY;
  }
  if (polyline.length === 1) {
    const only = polyline[0];
    return only === undefined
      ? Number.POSITIVE_INFINITY
      : Math.hypot(
          point.xMeters - only.xMeters,
          point.yMeters - only.yMeters,
        );
  }
  let smallest = Number.POSITIVE_INFINITY;
  for (let index = 1; index < polyline.length; index += 1) {
    const start = polyline[index - 1];
    const end = polyline[index];
    if (start === undefined || end === undefined) {
      continue;
    }
    smallest = Math.min(
      smallest,
      squaredDistanceToSegment(point, start, end),
    );
  }
  return Math.sqrt(smallest);
}

function symmetricOutputDeviation(first, second) {
  const firstToSecond = first.reduce(
    (maximum, point) =>
      Math.max(maximum, distanceToPolyline(point, second)),
    0,
  );
  const secondToFirst = second.reduce(
    (maximum, point) =>
      Math.max(maximum, distanceToPolyline(point, first)),
    0,
  );
  return Math.max(firstToSecond, secondToFirst);
}

function runOne(name, points) {
  const iterations = points.length >= 100_000 ? 5 : 15;
  const simplifyInput = toSimplifyJsPoints(points);
  const internal = benchmark(
    () => simplifyTrack(points, TOLERANCE_METERS),
    iterations,
  );
  const highQuality = benchmark(
    () => simplifyJs(simplifyInput, TOLERANCE_METERS, true),
    iterations,
  );
  const defaultQuality = benchmark(
    () => simplifyJs(simplifyInput, TOLERANCE_METERS, false),
    iterations,
  );

  assert.deepEqual(
    ids(highQuality.result),
    ids(internal.result),
    `${name}: simplify-js high-quality output must match internal RDP point ids`,
  );
  assert.equal(
    highQuality.result.every((point) =>
      simplifyInput.includes(point),
    ),
    true,
    `${name}: simplify-js must return original point references`,
  );
  assert.equal(
    highQuality.result.every(
      (point) =>
        typeof point.sampleId === "string" &&
        typeof point.confidence === "number" &&
        point.sourcePosition?.kind === "local",
    ),
    true,
    `${name}: TrackPoint provenance must survive simplify-js`,
  );

  return {
    fixture: name,
    inputPoints: points.length,
    toleranceMeters: TOLERANCE_METERS,
    internal: {
      outputPoints: internal.result.length,
      medianMs: Number(internal.medianMs.toFixed(3)),
      p95Ms: Number(internal.p95Ms.toFixed(3)),
      maximumMs: Number(internal.maximumMs.toFixed(3)),
    },
    simplifyJsHighQuality: {
      outputPoints: highQuality.result.length,
      exactPointIds: true,
      provenancePreserved: true,
      medianMs: Number(highQuality.medianMs.toFixed(3)),
      p95Ms: Number(highQuality.p95Ms.toFixed(3)),
      maximumMs: Number(highQuality.maximumMs.toFixed(3)),
    },
    simplifyJsDefault: {
      outputPoints: defaultQuality.result.length,
      medianMs: Number(defaultQuality.medianMs.toFixed(3)),
      p95Ms: Number(defaultQuality.p95Ms.toFixed(3)),
      maximumMs: Number(defaultQuality.maximumMs.toFixed(3)),
      maxDeviationFromInternalMeters: Number(
        symmetricOutputDeviation(
          internal.result,
          defaultQuality.result,
        ).toFixed(6),
      ),
    },
  };
}

const results = [
  runOne("noisy-line-1k", noisyLine(1_000)),
  runOne("noisy-line-10k", noisyLine(10_000)),
  runOne("noisy-line-100k", noisyLine(100_000)),
  runOne("rectangular-loop-10k", rectangularLoop(10_000)),
  runOne("marker-nearby-turn-10k", markerNearbyTurn(10_000)),
];

const gapSegments = gapSeparatedSegments(10_000);
const gapResults = gapSegments.map((segment, index) =>
  runOne(`gap-segment-${index + 1}`, segment),
);
assert.equal(
  gapResults.length,
  2,
  "gap fixture must be simplified as two independent segments",
);

for (const result of [...results, ...gapResults]) {
  console.log(JSON.stringify(result));
}
