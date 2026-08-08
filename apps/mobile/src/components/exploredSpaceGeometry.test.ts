import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";

import {
  buildExploredSpaceGeometry,
  locationAccuracyQuality,
  passageEvidenceConfidence,
  uncertaintyRadiusMeters,
  type ExploredSpacePoint,
  type ExploredSpaceSegment,
} from "./exploredSpaceGeometry.ts";

function point(
  sampleId: string,
  xMeters: number,
  yMeters: number,
  options: Partial<ExploredSpacePoint> = {},
): ExploredSpacePoint {
  return {
    sampleId,
    xMeters,
    yMeters,
    confidence: 0.9,
    source: "gnss",
    ...options,
  };
}

function boundsFor(segments: readonly ExploredSpaceSegment[]) {
  const points = segments.flatMap((segment) => segment.points);
  return {
    minX: Math.min(...points.map((item) => item.xMeters)),
    minY: Math.min(...points.map((item) => item.yMeters)),
    maxX: Math.max(...points.map((item) => item.xMeters)),
    maxY: Math.max(...points.map((item) => item.yMeters)),
  };
}

function average(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

test("accuracy becomes an honest bounded uncertainty radius", () => {
  assert.equal(
    uncertaintyRadiusMeters(
      point("good", 0, 0, { horizontalAccuracyMeters: 3 }),
    ),
    4,
  );
  assert.equal(
    uncertaintyRadiusMeters(
      point("normal", 0, 0, { horizontalAccuracyMeters: 11 }),
    ),
    11,
  );
  assert.equal(
    uncertaintyRadiusMeters(
      point("poor", 0, 0, { horizontalAccuracyMeters: 80 }),
    ),
    30,
  );
  assert.equal(
    uncertaintyRadiusMeters(point("pdr", 0, 0, { source: "pdr" })),
    4,
  );
});

test("poor accuracy lowers evidence quality rather than increasing passage area", () => {
  const good = point("good", 0, 0, {
    horizontalAccuracyMeters: 4,
    confidence: 0.8,
  });
  const poor = point("poor", 0, 0, {
    horizontalAccuracyMeters: 30,
    confidence: 0.8,
  });
  assert.equal(locationAccuracyQuality(good), 1);
  assert.equal(locationAccuracyQuality(poor), 0.25);
  assert.equal(passageEvidenceConfidence(good), 0.8);
  assert.equal(passageEvidenceConfidence(poor), 0.2);
});

test("uncertainty bands never connect separate exploration sessions", () => {
  const segments: ExploredSpaceSegment[] = [
    { id: "first", points: [point("a", 0, 0), point("b", 10, 0)] },
    {
      id: "second",
      points: [point("c", 100, 100), point("d", 110, 100)],
    },
  ];
  const geometry = buildExploredSpaceGeometry({
    segments,
    bounds: boundsFor(segments),
    width: 400,
    height: 300,
  });
  assert.equal(geometry.uncertaintyBands.length, 2);
  assert.ok(
    geometry.uncertaintyBands.every((item) => !item.id.includes("b:c")),
  );
  assert.deepEqual(
    geometry.segments.map((item) => item.id),
    ["first", "second"],
  );
});

test("one traversal immediately creates passage cells while later sessions strengthen them", () => {
  const first: ExploredSpaceSegment = {
    id: "first",
    points: [point("a", 0, 0), point("b", 20, 0), point("c", 40, 0)],
  };
  const one = buildExploredSpaceGeometry({
    segments: [first],
    bounds: boundsFor([first]),
    width: 400,
    height: 300,
  });
  const twice = buildExploredSpaceGeometry({
    segments: [first, { ...first, id: "revisit" }],
    bounds: boundsFor([first]),
    width: 400,
    height: 300,
  });
  assert.ok(one.cells.length > 0);
  assert.ok(one.cells.every((cell) => cell.supportingSessions === 1));
  assert.ok(
    Math.max(...twice.cells.map((cell) => cell.supportingSessions)) >
      Math.max(...one.cells.map((cell) => cell.supportingSessions)),
  );
});

test("dense samples inside one session do not masquerade as revisits", () => {
  const dense: ExploredSpaceSegment = {
    id: "dense",
    points: Array.from({ length: 101 }, (_, index) =>
      point(`dense-${index}`, index * 0.5, 0, {
        horizontalAccuracyMeters: 6,
      }),
    ),
  };
  const geometry = buildExploredSpaceGeometry({
    segments: [dense],
    bounds: boundsFor([dense]),
    width: 400,
    height: 300,
  });
  assert.ok(geometry.cells.length > 0);
  assert.ok(geometry.cells.every((cell) => cell.supportingSessions === 1));
});

test("horizontal accuracy does not expand the physical passage-cell footprint", () => {
  const coordinates = [
    [0, 0],
    [30, 4],
    [65, 22],
    [100, 18],
    [135, 45],
  ] as const;
  const accurate: ExploredSpaceSegment = {
    id: "route",
    points: coordinates.map(([x, y], index) =>
      point(`accurate-${index}`, x, y, {
        horizontalAccuracyMeters: 4,
        confidence: 0.8,
      }),
    ),
  };
  const uncertain: ExploredSpaceSegment = {
    id: "route",
    points: coordinates.map(([x, y], index) =>
      point(`uncertain-${index}`, x, y, {
        horizontalAccuracyMeters: 30,
        confidence: 0.8,
      }),
    ),
  };
  const bounds = boundsFor([accurate]);
  const accurateGeometry = buildExploredSpaceGeometry({
    segments: [accurate],
    bounds,
    width: 400,
    height: 300,
  });
  const uncertainGeometry = buildExploredSpaceGeometry({
    segments: [uncertain],
    bounds,
    width: 400,
    height: 300,
  });

  assert.equal(
    uncertainGeometry.cellSizeMeters,
    accurateGeometry.cellSizeMeters,
  );
  assert.deepEqual(
    uncertainGeometry.cells.map((cell) => cell.id),
    accurateGeometry.cells.map((cell) => cell.id),
  );
  assert.ok(
    average(uncertainGeometry.cells.map((cell) => cell.confidence)) <
      average(accurateGeometry.cells.map((cell) => cell.confidence)),
  );
  assert.ok(
    average(uncertainGeometry.cells.map((cell) => cell.opacity)) <
      average(accurateGeometry.cells.map((cell) => cell.opacity)),
  );
});

test("accuracy changes uncertainty width and opacity inside one shared projection", () => {
  const accurate: ExploredSpaceSegment = {
    id: "accurate",
    points: [
      point("a", 0, 0, { horizontalAccuracyMeters: 5 }),
      point("b", 20, 0, { horizontalAccuracyMeters: 5 }),
    ],
  };
  const uncertain: ExploredSpaceSegment = {
    id: "uncertain",
    points: [
      point("c", 0, 40, { horizontalAccuracyMeters: 25 }),
      point("d", 20, 40, { horizontalAccuracyMeters: 25 }),
    ],
  };
  const geometry = buildExploredSpaceGeometry({
    segments: [accurate, uncertain],
    bounds: boundsFor([accurate, uncertain]),
    width: 400,
    height: 300,
  });
  const accurateBand = geometry.uncertaintyBands.find((item) =>
    item.id.startsWith("accurate:"),
  );
  const uncertainBand = geometry.uncertaintyBands.find((item) =>
    item.id.startsWith("uncertain:"),
  );
  assert.ok(accurateBand !== undefined);
  assert.ok(uncertainBand !== undefined);
  assert.ok(uncertainBand!.width > accurateBand!.width);
  assert.ok(uncertainBand!.opacity < accurateBand!.opacity);
});

test("10k-point fixtures remain bounded for mobile rendering", () => {
  const points = Array.from({ length: 10_000 }, (_, index) =>
    point(`p-${index}`, index * 1.5, Math.sin(index / 30) * 12, {
      horizontalAccuracyMeters: 8 + (index % 6),
      confidence: 0.75 + (index % 20) / 100,
    }),
  );
  const segment: ExploredSpaceSegment = { id: "stress", points };
  const started = performance.now();
  const geometry = buildExploredSpaceGeometry({
    segments: [segment],
    bounds: boundsFor([segment]),
    width: 420,
    height: 320,
  });
  const elapsed = performance.now() - started;
  assert.ok(geometry.segments[0]!.points.length <= 1_201);
  assert.ok(geometry.cells.length <= 1_400);
  assert.ok(elapsed < 2_000, `geometry took ${elapsed.toFixed(1)}ms`);
  console.log(
    JSON.stringify({
      fixture: "10k",
      elapsedMs: Number(elapsed.toFixed(2)),
      renderedPoints: geometry.segments[0]!.points.length,
      uncertaintyBands: geometry.uncertaintyBands.length,
      cells: geometry.cells.length,
      cellSizeMeters: geometry.cellSizeMeters,
    }),
  );
});
