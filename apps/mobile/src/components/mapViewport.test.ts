import assert from "node:assert/strict";
import test from "node:test";

import {
  clampMapViewport,
  DEFAULT_MAP_VIEWPORT,
  MAX_MAP_VIEWPORT_SCALE,
  panMapViewport,
  projectMapViewportPoint,
  unprojectMapViewportPoint,
  zoomMapViewportAt,
  zoomMapViewportBetweenFocals,
} from "./mapViewport.ts";

const WIDTH = 400;
const HEIGHT = 300;

function assertClose(actual: number, expected: number): void {
  assert.ok(
    Math.abs(actual - expected) < 1e-8,
    `expected ${actual} to be close to ${expected}`,
  );
}

test("fit-to-all viewport is the stable minimum state", () => {
  assert.deepEqual(
    clampMapViewport(
      { scale: 0.25, panX: 999, panY: -999 },
      WIDTH,
      HEIGHT,
    ),
    DEFAULT_MAP_VIEWPORT,
  );
  assert.deepEqual(
    clampMapViewport(
      { scale: Number.NaN, panX: Number.NaN, panY: Number.NaN },
      WIDTH,
      HEIGHT,
    ),
    DEFAULT_MAP_VIEWPORT,
  );
});

test("zooming around a focal point preserves the map point under that focal", () => {
  const start = { scale: 2, panX: 40, panY: -25 };
  const focal = { x: 110, y: 225 };
  const mapPoint = unprojectMapViewportPoint(
    start,
    focal,
    WIDTH,
    HEIGHT,
  );
  const zoomed = zoomMapViewportAt(start, 8, focal, WIDTH, HEIGHT);
  const projected = projectMapViewportPoint(
    zoomed,
    mapPoint,
    WIDTH,
    HEIGHT,
  );

  assert.equal(zoomed.scale, 8);
  assertClose(projected.x, focal.x);
  assertClose(projected.y, focal.y);
});

test("a moving pinch keeps the same map point under the moving midpoint", () => {
  const start = { scale: 3, panX: -30, panY: 15 };
  const startFocal = { x: 160, y: 120 };
  const currentFocal = { x: 190, y: 145 };
  const mapPoint = unprojectMapViewportPoint(
    start,
    startFocal,
    WIDTH,
    HEIGHT,
  );
  const zoomed = zoomMapViewportBetweenFocals(
    start,
    6,
    startFocal,
    currentFocal,
    WIDTH,
    HEIGHT,
  );
  const projected = projectMapViewportPoint(
    zoomed,
    mapPoint,
    WIDTH,
    HEIGHT,
  );

  assertClose(projected.x, currentFocal.x);
  assertClose(projected.y, currentFocal.y);
});

test("pan remains bounded while still exposing distant fit-to-all endpoints", () => {
  const zoomed = { scale: 8, panX: 0, panY: 0 };
  const panned = panMapViewport(
    zoomed,
    Number.POSITIVE_INFINITY,
    -100_000,
    WIDTH,
    HEIGHT,
  );

  assert.deepEqual(panned, {
    scale: 8,
    panX: 0,
    panY: -(HEIGHT * 7) / 2,
  });

  const farRight = panMapViewport(zoomed, 100_000, 0, WIDTH, HEIGHT);
  assert.equal(farRight.panX, (WIDTH * 7) / 2);
  assert.equal(
    projectMapViewportPoint(farRight, { x: 0, y: HEIGHT / 2 }, WIDTH, HEIGHT).x,
    0,
  );
});

test("maximum zoom supports wide-route to local inspection without unbounded scale", () => {
  const zoomed = zoomMapViewportAt(
    DEFAULT_MAP_VIEWPORT,
    1_000,
    { x: WIDTH / 2, y: HEIGHT / 2 },
    WIDTH,
    HEIGHT,
  );
  assert.equal(zoomed.scale, MAX_MAP_VIEWPORT_SCALE);

  const tenKilometerFitWidthMeters = 10_000;
  const visibleWidthMeters = tenKilometerFitWidthMeters / zoomed.scale;
  assert.ok(visibleWidthMeters <= 312.5);
});

test("zooming back to one resets pan and returns the whole-map view", () => {
  const reset = zoomMapViewportAt(
    { scale: 12, panX: 320, panY: -180 },
    1,
    { x: 50, y: 50 },
    WIDTH,
    HEIGHT,
  );
  assert.deepEqual(reset, DEFAULT_MAP_VIEWPORT);
});
