export interface MapViewport {
  readonly zoom: number;
  readonly panX: number;
  readonly panY: number;
}

export interface MapViewportSize {
  readonly width: number;
  readonly height: number;
}

export interface MapViewportPoint {
  readonly x: number;
  readonly y: number;
}

interface ProjectionLike {
  readonly scale: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly width: number;
  readonly height: number;
}

export const MIN_MAP_ZOOM = 1;
export const MAX_MAP_ZOOM = 64;
export const FIT_MAP_VIEWPORT: MapViewport = {
  zoom: MIN_MAP_ZOOM,
  panX: 0,
  panY: 0,
};

const RETAINED_MAP_FRACTION = 0.35;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function clampMapZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) {
    return MIN_MAP_ZOOM;
  }
  return clamp(zoom, MIN_MAP_ZOOM, MAX_MAP_ZOOM);
}

/**
 * Keeps a zoomed map from being panned completely off-screen.
 *
 * At fit-to-all (1x), pan is always zero so a single-finger vertical swipe can
 * remain owned by the parent Review ScrollView. Once zoomed, the viewport may
 * move far enough to inspect either end of a long route while retaining a
 * bounded portion of the fitted map inside the canvas.
 */
export function clampMapViewport(
  viewport: MapViewport,
  size: MapViewportSize,
): MapViewport {
  const zoom = clampMapZoom(viewport.zoom);
  if (size.width <= 0 || size.height <= 0 || zoom <= MIN_MAP_ZOOM) {
    return FIT_MAP_VIEWPORT;
  }

  const maximumPanX =
    ((zoom - 1) * size.width) / 2 + size.width * RETAINED_MAP_FRACTION;
  const maximumPanY =
    ((zoom - 1) * size.height) / 2 + size.height * RETAINED_MAP_FRACTION;
  return {
    zoom,
    panX: clamp(viewport.panX, -maximumPanX, maximumPanX),
    panY: clamp(viewport.panY, -maximumPanY, maximumPanY),
  };
}

export function panMapViewport(
  viewport: MapViewport,
  deltaX: number,
  deltaY: number,
  size: MapViewportSize,
): MapViewport {
  return clampMapViewport(
    {
      ...viewport,
      panX: viewport.panX + deltaX,
      panY: viewport.panY + deltaY,
    },
    size,
  );
}

/**
 * Changes zoom while preserving the map position currently under `focal`.
 * The caller may add a centroid delta afterwards to support a moving pinch.
 */
export function zoomMapViewportAt(
  viewport: MapViewport,
  requestedZoom: number,
  focal: MapViewportPoint,
  size: MapViewportSize,
): MapViewport {
  const current = clampMapViewport(viewport, size);
  const zoom = clampMapZoom(requestedZoom);
  if (zoom === current.zoom) {
    return current;
  }

  const centerX = size.width / 2;
  const centerY = size.height / 2;
  const ratio = zoom / current.zoom;
  return clampMapViewport(
    {
      zoom,
      panX:
        current.panX +
        (focal.x - centerX - current.panX) * (1 - ratio),
      panY:
        current.panY +
        (focal.y - centerY - current.panY) * (1 - ratio),
    },
    size,
  );
}

/**
 * Applies the read-only screen viewport to a fit-to-all map projection.
 * Marker and line thickness remain controlled by the renderer rather than
 * being scaled as a single bitmap or transformed container.
 */
export function applyMapViewportToProjection<Projection extends ProjectionLike>(
  projection: Projection,
  viewport: MapViewport,
): Projection {
  const current = clampMapViewport(viewport, {
    width: projection.width,
    height: projection.height,
  });
  const centerX = projection.width / 2;
  const centerY = projection.height / 2;
  return {
    ...projection,
    scale: projection.scale * current.zoom,
    offsetX:
      centerX +
      (projection.offsetX - centerX) * current.zoom +
      current.panX,
    offsetY:
      centerY +
      (projection.offsetY - centerY) * current.zoom -
      current.panY,
  };
}
