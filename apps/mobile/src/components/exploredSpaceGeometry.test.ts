import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";

import {
  buildExploredSpaceGeometry,
  coverageEvidenceConfidence,
  locationUncertaintyRadiusMeters,
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

function averageCellConfidence(
  cells: readonly { readonly confidence: number }[],
): number {
  return (
    cells.reduce((sum, cell) => sum + cell.confidence, 0) /
    Math.max(1, cells.length)
  );
}

test("accuracy becomes a bounded location-uncertainty radius", () => {
  const good = point("good", 0, 0, { horizontalAccuracyMeters: 3 });
  const normal = point("normal", 0, 0, { horizontalAccuracyMeters: 11 });
  const poor = point("poor", 0, 0, { horizontalAccuracyMeters: 80 });

  assert.equal(locationUncertaintyRadiusMeters(good), 4);
  assert.equal(locationUncertaintyRadiusMeters(normal), 11);
  assert.equal(locationUncertaintyRadiusMeters(poor), 30);
  assert.equal(
    locationUncertaintyRadiusMeters(point("pdr", 0, 0, { source: "pdr" })),
    4,
  );
  assert.ok(
    coverageEvidenceConfidence(good) > coverageEvidenceConfidence(poor),
  );
});

test("uncertainty bands and coverage never connect separate sessions", () => {
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
  assert.ok(geometry.uncertaintyBands.every((item) => !item.id.includes("b:c")));
  assert.deepEqual(
    geometry.segments.map((item) => item.id),
    ["first", "second"],
  );

  const gapCells = geometry.cells.filter((cell) => {
    const xIndex = Number(cell.id.split(":")[0]);
    return xIndex > 2 && xIndex < 16;
  });
  assert.deepEqual(gapCells, []);
});

test("one traversal immediately creates cells while a later session strengthens them", () => {
  const first: ExploredSpaceSegment = {
    id: "first",
    points: [point("a", 0, 0), point("b", 20, 0), point("c", 40, 0)],
  };
  const revisit: ExploredSpaceSegment = {
    id: "revisit",
    points: [
      point("d", 0, 0),
      point("e", 20, 0),
      point("f", 40, 0),
    ],
  };
  const one = buildExploredSpaceGeometry({
    segments: [first],
    bounds: boundsFor([first]),
    width: 400,
    height: 300,
  });
  const twice = buildExploredSpaceGeometry({
    segments: [first, revisit],
    bounds: boundsFor([first]),
    width: 400,
    height: 300,
  });

  assert.ok(one.cells.length > 0);
  assert.ok(one.cells.every((cell) => cell.supportingSessionCount === 1));
  assert.ok(twice.cells.some((cell) => cell.supportingSessionCount === 2));
});

test("dense samples inside one session do not masquerade as repeated exploration", () => {
  const dense: ExploredSpaceSegment = {
    id: "dense",
    points: Array.from({ length: 81 }, (_, index) =>
      point(`dense-${index}`, index * 0.5, 0, {
        horizontalAccuracyMeters: 5,
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
  assert.ok(geometry.cells.every((cell) => cell.supportingSessionCount === 1));
});

test("poor accuracy widens uncertainty but does not increase coverage footprint", () => {
  const coordinates = [
    [0, 0],
    [30, 4],
    [65, 22],
    [100, 18],
    [135, 45],
  ] as const;
  const accurate: ExploredSpaceSegment = {
    id: "accurate",
    points: coordinates.map(([xMeters, yMeters], index) =>
      point(`accurate-${index}`, xMeters, yMeters, {
        horizontalAccuracyMeters: 4,
        confidence: 0.9,
      }),
    ),
  };
  const mixedAccuracies = [4, 6, 24, 30, 8] as const;
  const mixed: ExploredSpaceSegment = {
    id: "mixed",
    points: coordinates.map(([xMeters, yMeters], index) =>
      point(`mixed-${index}`, xMeters, yMeters, {
        horizontalAccuracyMeters: mixedAccuracies[index]!,
        confidence: 0.9,
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
  const mixedGeometry = buildExploredSpaceGeometry({
    segments: [mixed],
    bounds,
    width: 400,
    height: 300,
  });

  assert.equal(mixedGeometry.cellSizeMeters, accurateGeometry.cellSizeMeters);
  assert.deepEqual(
    mixedGeometry.cells.map((cell) => cell.id),
    accurateGeometry.cells.map((cell) => cell.id),
  );
  assert.ok(
    averageCellConfidence(mixedGeometry.cells) <
      averageCellConfidence(accurateGeometry.cells),
  );
  assert.ok(
    Math.max(...mixedGeometry.uncertaintyBands.map((item) => item.width)) >
      Math.max(...accurateGeometry.uncertaintyBands.map((item) => item.width)),
  );
});

test("accuracy changes uncertainty width inside one shared projection", () => {
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
  assert.ok(uncertainBand.width > accurateBand.width);
  assert.ok(uncertainBand.opacity < accurateBand.opacity);
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
