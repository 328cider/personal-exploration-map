export interface MapViewport {
  readonly scale: number;
  readonly panX: number;
  readonly panY: number;
}

export interface MapViewportPoint {
  readonly x: number;
  readonly y: number;
}

export const MIN_MAP_VIEWPORT_SCALE = 1;
export const MAX_MAP_VIEWPORT_SCALE = 32;
export const DEFAULT_MAP_VIEWPORT: MapViewport = {
  scale: MIN_MAP_VIEWPORT_SCALE,
  panX: 0,
  panY: 0,
};

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

/**
 * Keeps the transformed fit-to-all canvas covering the viewport.
 *
 * View state is renderer-only. It never changes PersonalMap bounds, raw
 * evidence, accepted/rejected samples, markers, or ExplorationSession edges.
 */
export function clampMapViewport(
  viewport: MapViewport,
  width: number,
  height: number,
): MapViewport {
  const scale = clamp(
    finiteOr(viewport.scale, MIN_MAP_VIEWPORT_SCALE),
    MIN_MAP_VIEWPORT_SCALE,
    MAX_MAP_VIEWPORT_SCALE,
  );
  if (scale <= MIN_MAP_VIEWPORT_SCALE || width <= 0 || height <= 0) {
    return DEFAULT_MAP_VIEWPORT;
  }

  const maximumPanX = (width * (scale - 1)) / 2;
  const maximumPanY = (height * (scale - 1)) / 2;
  return {
    scale,
    panX: clamp(finiteOr(viewport.panX, 0), -maximumPanX, maximumPanX),
    panY: clamp(finiteOr(viewport.panY, 0), -maximumPanY, maximumPanY),
  };
}

export function panMapViewport(
  viewport: MapViewport,
  deltaX: number,
  deltaY: number,
  width: number,
  height: number,
): MapViewport {
  return clampMapViewport(
    {
      scale: viewport.scale,
      panX: viewport.panX + finiteOr(deltaX, 0),
      panY: viewport.panY + finiteOr(deltaY, 0),
    },
    width,
    height,
  );
}

/**
 * Zooms while preserving the map coordinate under a gesture focal point.
 * `startFocal` and `currentFocal` differ during a moving two-finger pinch.
 */
export function zoomMapViewportBetweenFocals(
  viewport: MapViewport,
  nextScale: number,
  startFocal: MapViewportPoint,
  currentFocal: MapViewportPoint,
  width: number,
  height: number,
): MapViewport {
  const current = clampMapViewport(viewport, width, height);
  const scale = clamp(
    finiteOr(nextScale, current.scale),
    MIN_MAP_VIEWPORT_SCALE,
    MAX_MAP_VIEWPORT_SCALE,
  );
  if (scale <= MIN_MAP_VIEWPORT_SCALE) {
    return DEFAULT_MAP_VIEWPORT;
  }

  const ratio = scale / current.scale;
  const centerX = width / 2;
  const centerY = height / 2;
  return clampMapViewport(
    {
      scale,
      panX:
        currentFocal.x -
        centerX -
        ratio * (startFocal.x - centerX - current.panX),
      panY:
        currentFocal.y -
        centerY -
        ratio * (startFocal.y - centerY - current.panY),
    },
    width,
    height,
  );
}

export function zoomMapViewportAt(
  viewport: MapViewport,
  nextScale: number,
  focal: MapViewportPoint,
  width: number,
  height: number,
): MapViewport {
  return zoomMapViewportBetweenFocals(
    viewport,
    nextScale,
    focal,
    focal,
    width,
    height,
  );
}

export function projectMapViewportPoint(
  viewport: MapViewport,
  point: MapViewportPoint,
  width: number,
  height: number,
): MapViewportPoint {
  const current = clampMapViewport(viewport, width, height);
  const centerX = width / 2;
  const centerY = height / 2;
  return {
    x: centerX + (point.x - centerX) * current.scale + current.panX,
    y: centerY + (point.y - centerY) * current.scale + current.panY,
  };
}

export function unprojectMapViewportPoint(
  viewport: MapViewport,
  point: MapViewportPoint,
  width: number,
  height: number,
): MapViewportPoint {
  const current = clampMapViewport(viewport, width, height);
  const centerX = width / 2;
  const centerY = height / 2;
  return {
    x: centerX + (point.x - centerX - current.panX) / current.scale,
    y: centerY + (point.y - centerY - current.panY) / current.scale,
  };
}
