import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";

import {
  buildExploredSpaceGeometry,
  exploredRadiusMeters,
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

test("accuracy becomes an honest bounded explored radius", () => {
  assert.equal(
    exploredRadiusMeters(
      point("good", 0, 0, { horizontalAccuracyMeters: 3 }),
    ),
    4,
  );
  assert.equal(
    exploredRadiusMeters(
      point("normal", 0, 0, { horizontalAccuracyMeters: 11 }),
    ),
    11,
  );
  assert.equal(
    exploredRadiusMeters(
      point("poor", 0, 0, { horizontalAccuracyMeters: 80 }),
    ),
    30,
  );
  assert.equal(
    exploredRadiusMeters(point("pdr", 0, 0, { source: "pdr" })),
    4,
  );
});

test("corridors never connect separate exploration sessions", () => {
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
  assert.equal(geometry.corridors.length, 2);
  assert.ok(geometry.corridors.every((item) => !item.id.includes("b:c")));
  assert.deepEqual(
    geometry.segments.map((item) => item.id),
    ["first", "second"],
  );
});

test("one traversal immediately creates cells while revisits strengthen them", () => {
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
  assert.ok(one.cells.every((cell) => cell.visits >= 1));
  assert.ok(
    Math.max(...twice.cells.map((cell) => cell.visits)) >
      Math.max(...one.cells.map((cell) => cell.visits)),
  );
});

test("accuracy changes corridor width inside one shared projection", () => {
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
  const accurateCorridor = geometry.corridors.find((item) =>
    item.id.startsWith("accurate:"),
  );
  const uncertainCorridor = geometry.corridors.find((item) =>
    item.id.startsWith("uncertain:"),
  );
  assert.ok(accurateCorridor !== undefined);
  assert.ok(uncertainCorridor !== undefined);
  assert.ok(uncertainCorridor.width > accurateCorridor.width);
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
      corridors: geometry.corridors.length,
      cells: geometry.cells.length,
      cellSizeMeters: geometry.cellSizeMeters,
    }),
  );
});
