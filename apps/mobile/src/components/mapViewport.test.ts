import assert from "node:assert/strict";
import test from "node:test";

import {
  buildExploredSpaceGeometry,
  projectExploredPoint,
  type ExploredSpaceSegment,
  type Projection,
} from "./exploredSpaceGeometry.ts";
import {
  applyMapViewportToProjection,
  clampMapViewport,
  FIT_MAP_VIEWPORT,
  MAX_MAP_ZOOM,
  panMapViewport,
  transformMapViewportPoint,
  zoomMapViewportAt,
  type MapViewportPoint,
  type MapViewportSize,
} from "./mapViewport.ts";

const SIZE: MapViewportSize = { width: 400, height: 300 };

function closeTo(
  actual: number,
  expected: number,
  tolerance = 1e-6,
): void {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );
}

function projection(): Projection {
  return {
    scale: 0.04,
    offsetX: 40,
    offsetY: 30,
    bounds: {
      minX: 0,
      minY: 0,
      maxX: 8_000,
      maxY: 6_000,
    },
    width: SIZE.width,
    height: SIZE.height,
  };
}

function screenPointFor(
  point: { readonly xMeters: number; readonly yMeters: number },
  viewport = FIT_MAP_VIEWPORT,
): MapViewportPoint {
  return projectExploredPoint(
    applyMapViewportToProjection(projection(), viewport),
    point,
  );
}

test("fit viewport is identity and invalid zoom returns to fit", () => {
  const base = projection();
  assert.deepEqual(
    applyMapViewportToProjection(base, FIT_MAP_VIEWPORT),
    base,
  );
  assert.deepEqual(
    clampMapViewport({ zoom: Number.NaN, panX: 50, panY: -20 }, SIZE),
    FIT_MAP_VIEWPORT,
  );
  assert.deepEqual(
    clampMapViewport({ zoom: 0.5, panX: 50, panY: -20 }, SIZE),
    FIT_MAP_VIEWPORT,
  );
});

test("zoom is bounded and pan cannot lose the fitted map completely", () => {
  const bounded = clampMapViewport(
    {
      zoom: 10_000,
      panX: Number.POSITIVE_INFINITY,
      panY: Number.NEGATIVE_INFINITY,
    },
    SIZE,
  );
  assert.equal(bounded.zoom, MAX_MAP_ZOOM);
  assert.ok(Number.isFinite(bounded.panX));
  assert.ok(Number.isFinite(bounded.panY));

  const moved = panMapViewport(
    { zoom: 4, panX: 0, panY: 0 },
    100_000,
    -100_000,
    SIZE,
  );
  assert.ok(Math.abs(moved.panX) < 1_000);
  assert.ok(Math.abs(moved.panY) < 1_000);
});

test("off-center zoom preserves the world point under the focal position", () => {
  const worldPoint = { xMeters: 1_500, yMeters: 2_000 };
  const initialViewport = { zoom: 2, panX: 30, panY: -15 };
  const focal = screenPointFor(worldPoint, initialViewport);
  const nextViewport = zoomMapViewportAt(
    initialViewport,
    8,
    focal,
    SIZE,
  );
  const after = screenPointFor(worldPoint, nextViewport);

  closeTo(after.x, focal.x);
  closeTo(after.y, focal.y);
});

test("screen point and projection transforms use the same viewport semantics", () => {
  const worldPoint = { xMeters: 2_400, yMeters: 1_700 };
  const viewport = { zoom: 6, panX: -80, panY: 45 };
  const baseScreen = projectExploredPoint(projection(), worldPoint);
  const transformedScreen = transformMapViewportPoint(
    baseScreen,
    viewport,
    SIZE,
  );
  const transformedProjectionScreen = screenPointFor(worldPoint, viewport);

  closeTo(transformedScreen.x, transformedProjectionScreen.x);
  closeTo(transformedScreen.y, transformedProjectionScreen.y);
});

test("a broad rail-scale route can enlarge a 400m walking section for inspection", () => {
  const segment: ExploredSpaceSegment = {
    id: "mixed-transport",
    points: [
      {
        sampleId: "home",
        xMeters: 0,
        yMeters: 0,
        confidence: 1,
        source: "gnss",
      },
      {
        sampleId: "station-walk",
        xMeters: 400,
        yMeters: 40,
        confidence: 1,
        source: "gnss",
      },
      {
        sampleId: "rail-destination",
        xMeters: 16_000,
        yMeters: 1_000,
        confidence: 1,
        source: "gnss",
      },
    ],
  };
  const geometry = buildExploredSpaceGeometry({
    segments: [segment],
    bounds: {
      minX: 0,
      minY: 0,
      maxX: 16_000,
      maxY: 1_000,
    },
    width: SIZE.width,
    height: SIZE.height,
  });
  assert.ok(geometry.projection !== null);

  const fitHome = projectExploredPoint(geometry.projection, segment.points[0]!);
  const fitWalk = projectExploredPoint(geometry.projection, segment.points[1]!);
  const fitSpan = Math.hypot(fitWalk.x - fitHome.x, fitWalk.y - fitHome.y);
  assert.ok(fitSpan < 15, `fit walking span was ${fitSpan.toFixed(1)}px`);

  const viewport = zoomMapViewportAt(
    FIT_MAP_VIEWPORT,
    32,
    fitHome,
    SIZE,
  );
  const zoomedProjection = applyMapViewportToProjection(
    geometry.projection,
    viewport,
  );
  const zoomedHome = projectExploredPoint(
    zoomedProjection,
    segment.points[0]!,
  );
  const zoomedWalk = projectExploredPoint(
    zoomedProjection,
    segment.points[1]!,
  );
  const zoomedSpan = Math.hypot(
    zoomedWalk.x - zoomedHome.x,
    zoomedWalk.y - zoomedHome.y,
  );

  assert.ok(zoomedSpan > 180, `zoomed walking span was ${zoomedSpan.toFixed(1)}px`);
  closeTo(zoomedHome.x, fitHome.x);
  closeTo(zoomedHome.y, fitHome.y);
});
