import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
  type NativeTouchEvent,
} from "react-native";
import type {
  MapSnapshot,
  PersonalMapSnapshot,
  TrackPoint,
} from "@exploration-map/mapping-core";

import { palette, spacing } from "../theme";
import {
  buildExploredSpaceGeometry,
  projectExploredPoint,
  type MapDisplayMode,
} from "./exploredSpaceGeometry";
import {
  applyMapViewportToProjection,
  clampMapViewport,
  FIT_MAP_VIEWPORT,
  MAX_MAP_ZOOM,
  MIN_MAP_ZOOM,
  panMapViewport,
  transformMapViewportPoint,
  zoomMapViewportAt,
  type MapViewport,
  type MapViewportPoint,
  type MapViewportSize,
} from "./mapViewport";

type RenderableSnapshot = MapSnapshot | PersonalMapSnapshot;

interface TrackCanvasProps {
  readonly snapshot: RenderableSnapshot;
  readonly height?: number;
  readonly interactive?: boolean;
}

interface PanGestureSession {
  readonly kind: "pan";
  readonly startViewport: MapViewport;
  readonly startPage: MapViewportPoint;
}

interface PinchGestureSession {
  readonly kind: "pinch";
  readonly startViewport: MapViewport;
  readonly startDistance: number;
  readonly startLocalFocal: MapViewportPoint;
  readonly startPageFocal: MapViewportPoint;
}

type GestureSession = PanGestureSession | PinchGestureSession;

const DISPLAY_MODES: readonly {
  readonly value: MapDisplayMode;
  readonly label: string;
}[] = [
  { value: "uncertainty", label: "不確実性" },
  { value: "cells", label: "通過セル" },
  { value: "track", label: "軌跡" },
];

const MAP_GESTURE_THRESHOLD_PX = 4;
const MAX_UNCERTAINTY_WIDTH_PX = 96;

function markerGlyph(category: string): string {
  switch (category) {
    case "entrance":
      return "↪";
    case "junction":
      return "⑂";
    case "stairs":
      return "↕";
    case "hazard":
      return "!";
    case "blocked":
      return "×";
    case "note":
      return "•";
    default:
      return "★";
  }
}

function snapshotSegments(snapshot: RenderableSnapshot): readonly {
  readonly id: string;
  readonly points: readonly TrackPoint[];
}[] {
  if ("segments" in snapshot) {
    return snapshot.segments.map((segment) => ({
      id: segment.explorationId,
      points: segment.track,
    }));
  }
  return [{ id: snapshot.explorationId, points: snapshot.track }];
}

function modeDescription(
  mode: MapDisplayMode,
  cellSizeMeters: number | null,
): string {
  switch (mode) {
    case "uncertainty":
      return "薄い帯は、実際の位置がこの付近だった可能性を示します。探索済み面積、道路幅、敷地や部屋の境界ではありません。";
    case "cells":
      return cellSizeMeters === null
        ? "位置情報が集まると、採用済み経路の近くを推定通過セルとして表示します。"
        : `採用済み経路の近くを約${Math.round(cellSizeMeters)}m単位の推定通過セルとして表示します。位置精度が悪くてもセル面積は広げず、確信度だけを下げます。別の探索で再び通ったセルは少し濃くなります。`;
    case "track":
      return "採用済み位置の中心推定を線で表示します。正確な道路線ではありません。";
  }
}

function centroid(
  touches: readonly NativeTouchEvent[],
  coordinate: "page" | "local",
): MapViewportPoint {
  const count = Math.max(1, touches.length);
  return touches.reduce(
    (result, touch) => ({
      x:
        result.x +
        (coordinate === "page" ? touch.pageX : touch.locationX) / count,
      y:
        result.y +
        (coordinate === "page" ? touch.pageY : touch.locationY) / count,
    }),
    { x: 0, y: 0 },
  );
}

function distanceBetweenTouches(
  touches: readonly NativeTouchEvent[],
): number {
  const first = touches[0];
  const second = touches[1];
  if (first === undefined || second === undefined) {
    return 0;
  }
  return Math.hypot(second.pageX - first.pageX, second.pageY - first.pageY);
}

function formatZoom(zoom: number): string {
  if (zoom >= 10) {
    return `${Math.round(zoom)}×`;
  }
  return `${zoom.toFixed(1).replace(/\.0$/u, "")}×`;
}

function copyFitViewport(): MapViewport {
  return { ...FIT_MAP_VIEWPORT };
}

export function TrackCanvas({
  height = 360,
  interactive = false,
  snapshot,
}: TrackCanvasProps) {
  const [width, setWidth] = useState(0);
  const [displayMode, setDisplayMode] =
    useState<MapDisplayMode>("uncertainty");
  const [viewport, setViewport] = useState<MapViewport>(copyFitViewport);
  const viewportRef = useRef<MapViewport>(viewport);
  const pendingViewportRef = useRef<MapViewport | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const gestureSessionRef = useRef<GestureSession | null>(null);

  const viewportSize = useMemo<MapViewportSize>(
    () => ({ width, height }),
    [height, width],
  );
  const boundedViewport = useMemo(
    () => clampMapViewport(viewport, viewportSize),
    [viewport, viewportSize],
  );

  const commitViewport = useCallback(
    (nextViewport: MapViewport) => {
      const bounded = clampMapViewport(nextViewport, {
        width,
        height,
      });
      viewportRef.current = bounded;
      pendingViewportRef.current = bounded;
      if (animationFrameRef.current !== null) {
        return;
      }
      animationFrameRef.current = requestAnimationFrame(() => {
        animationFrameRef.current = null;
        const pending = pendingViewportRef.current;
        pendingViewportRef.current = null;
        if (pending !== null) {
          setViewport(pending);
        }
      });
    },
    [height, width],
  );

  const resetViewport = useCallback(() => {
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    pendingViewportRef.current = null;
    gestureSessionRef.current = null;
    const fit = copyFitViewport();
    viewportRef.current = fit;
    setViewport(fit);
  }, []);

  useEffect(() => {
    viewportRef.current = boundedViewport;
  }, [boundedViewport]);

  useEffect(() => {
    resetViewport();
  }, [resetViewport, snapshot]);

  useEffect(
    () => () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    },
    [],
  );

  const sourceSegments = useMemo(() => snapshotSegments(snapshot), [snapshot]);
  const geometry = useMemo(
    () =>
      buildExploredSpaceGeometry({
        segments: sourceSegments,
        bounds: snapshot.bounds,
        width,
        height,
      }),
    [height, snapshot.bounds, sourceSegments, width],
  );

  const viewportProjection = useMemo(() => {
    if (geometry.projection === null) {
      return null;
    }
    return applyMapViewportToProjection(
      geometry.projection,
      boundedViewport,
    );
  }, [boundedViewport, geometry.projection]);

  const renderedSegments = useMemo(() => {
    if (viewportProjection === null) {
      return [];
    }
    return geometry.segments.map((segment) => ({
      id: segment.id,
      points: segment.points.map((point) => ({
        ...projectExploredPoint(viewportProjection, point.source),
        source: point.source,
      })),
    }));
  }, [geometry.segments, viewportProjection]);

  const renderedBands = useMemo(
    () =>
      geometry.uncertaintyBands.map((band) => {
        const center = transformMapViewportPoint(
          {
            x: band.left + band.length / 2,
            y: band.top + band.width / 2,
          },
          boundedViewport,
          viewportSize,
        );
        const length = band.length * boundedViewport.zoom;
        const bandWidth = Math.min(
          MAX_UNCERTAINTY_WIDTH_PX,
          Math.max(10, band.width * boundedViewport.zoom),
        );
        return {
          ...band,
          left: center.x - length / 2,
          top: center.y - bandWidth / 2,
          length,
          width: bandWidth,
        };
      }),
    [boundedViewport, geometry.uncertaintyBands, viewportSize],
  );

  const renderedCells = useMemo(
    () =>
      geometry.cells.map((cell) => {
        const topLeft = transformMapViewportPoint(
          { x: cell.left, y: cell.top },
          boundedViewport,
          viewportSize,
        );
        return {
          ...cell,
          left: topLeft.x,
          top: topLeft.y,
          size: cell.size * boundedViewport.zoom,
        };
      }),
    [boundedViewport, geometry.cells, viewportSize],
  );

  const markerPoints = useMemo(() => {
    if (viewportProjection === null) {
      return [];
    }
    return snapshot.markers.flatMap((marker) => {
      if (marker.xMeters === undefined || marker.yMeters === undefined) {
        return [];
      }
      return [
        {
          marker,
          ...projectExploredPoint(viewportProjection, {
            xMeters: marker.xMeters,
            yMeters: marker.yMeters,
          }),
        },
      ];
    });
  }, [snapshot.markers, viewportProjection]);

  const panResponder = useMemo(() => {
    function beginGesture(event: GestureResponderEvent) {
      const touches = event.nativeEvent.touches;
      if (touches.length >= 2) {
        const startDistance = distanceBetweenTouches(touches);
        if (startDistance <= 0) {
          gestureSessionRef.current = null;
          return;
        }
        gestureSessionRef.current = {
          kind: "pinch",
          startViewport: viewportRef.current,
          startDistance,
          startLocalFocal: centroid(touches, "local"),
          startPageFocal: centroid(touches, "page"),
        };
        return;
      }
      const touch = touches[0];
      if (touch === undefined || viewportRef.current.zoom <= MIN_MAP_ZOOM) {
        gestureSessionRef.current = null;
        return;
      }
      gestureSessionRef.current = {
        kind: "pan",
        startViewport: viewportRef.current,
        startPage: { x: touch.pageX, y: touch.pageY },
      };
    }

    return PanResponder.create({
      onStartShouldSetPanResponder: (event) =>
        interactive && event.nativeEvent.touches.length >= 2,
      onStartShouldSetPanResponderCapture: (event) =>
        interactive && event.nativeEvent.touches.length >= 2,
      onMoveShouldSetPanResponder: (event, gestureState) =>
        interactive &&
        (event.nativeEvent.touches.length >= 2 ||
          (viewportRef.current.zoom > MIN_MAP_ZOOM &&
            (Math.abs(gestureState.dx) >= MAP_GESTURE_THRESHOLD_PX ||
              Math.abs(gestureState.dy) >= MAP_GESTURE_THRESHOLD_PX))),
      onMoveShouldSetPanResponderCapture: (event, gestureState) =>
        interactive &&
        (event.nativeEvent.touches.length >= 2 ||
          (viewportRef.current.zoom > MIN_MAP_ZOOM &&
            (Math.abs(gestureState.dx) >= MAP_GESTURE_THRESHOLD_PX ||
              Math.abs(gestureState.dy) >= MAP_GESTURE_THRESHOLD_PX))),
      onPanResponderGrant: beginGesture,
      onPanResponderMove: (event) => {
        const touches = event.nativeEvent.touches;
        if (touches.length >= 2) {
          if (gestureSessionRef.current?.kind !== "pinch") {
            beginGesture(event);
            return;
          }
          const session = gestureSessionRef.current;
          const currentDistance = distanceBetweenTouches(touches);
          if (currentDistance <= 0) {
            return;
          }
          const currentPageFocal = centroid(touches, "page");
          const zoomed = zoomMapViewportAt(
            session.startViewport,
            session.startViewport.zoom *
              (currentDistance / session.startDistance),
            session.startLocalFocal,
            viewportSize,
          );
          commitViewport(
            panMapViewport(
              zoomed,
              currentPageFocal.x - session.startPageFocal.x,
              currentPageFocal.y - session.startPageFocal.y,
              viewportSize,
            ),
          );
          return;
        }

        const touch = touches[0];
        if (touch === undefined) {
          return;
        }
        if (gestureSessionRef.current?.kind !== "pan") {
          beginGesture(event);
          return;
        }
        const session = gestureSessionRef.current;
        commitViewport(
          panMapViewport(
            session.startViewport,
            touch.pageX - session.startPage.x,
            touch.pageY - session.startPage.y,
            viewportSize,
          ),
        );
      },
      onPanResponderRelease: () => {
        gestureSessionRef.current = null;
      },
      onPanResponderTerminate: () => {
        gestureSessionRef.current = null;
      },
      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true,
    });
  }, [commitViewport, interactive, viewportSize]);

  function handleLayout(event: LayoutChangeEvent) {
    setWidth(event.nativeEvent.layout.width);
  }

  function zoomBy(factor: number) {
    if (width <= 0) {
      return;
    }
    commitViewport(
      zoomMapViewportAt(
        viewportRef.current,
        viewportRef.current.zoom * factor,
        { x: width / 2, y: height / 2 },
        viewportSize,
      ),
    );
  }

  const canZoomOut = boundedViewport.zoom > MIN_MAP_ZOOM;
  const canZoomIn = boundedViewport.zoom < MAX_MAP_ZOOM;
  const atFit = !canZoomOut;

  return (
    <View style={styles.wrapper}>
      <View accessibilityLabel="地図表示モード" style={styles.modeSwitcher}>
        {DISPLAY_MODES.map((mode) => {
          const selected = displayMode === mode.value;
          return (
            <Pressable
              key={mode.value}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={`地図表示 ${mode.label}`}
              onPress={() => setDisplayMode(mode.value)}
              style={({ pressed }: { readonly pressed: boolean }) => [
                styles.modeButton,
                selected ? styles.modeButtonSelected : null,
                pressed ? styles.modeButtonPressed : null,
              ]}
            >
              <Text
                style={[
                  styles.modeButtonText,
                  selected ? styles.modeButtonTextSelected : null,
                ]}
              >
                {mode.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {interactive ? (
        <View style={styles.viewportBar}>
          <Text style={styles.viewportHint}>
            2本指で拡大。拡大中は1本指で移動。
          </Text>
          <View accessibilityLabel="地図の拡大縮小" style={styles.viewportControls}>
            <Pressable
              accessibilityLabel="地図を縮小"
              accessibilityRole="button"
              accessibilityState={{ disabled: !canZoomOut }}
              disabled={!canZoomOut}
              hitSlop={6}
              onPress={() => zoomBy(0.5)}
              style={({ pressed }: { readonly pressed: boolean }) => [
                styles.viewportButton,
                !canZoomOut ? styles.viewportButtonDisabled : null,
                pressed && canZoomOut ? styles.viewportButtonPressed : null,
              ]}
            >
              <Text style={styles.viewportButtonText}>−</Text>
            </Pressable>
            <Text
              accessibilityLabel={`地図の倍率 ${formatZoom(boundedViewport.zoom)}`}
              accessibilityRole="text"
              style={styles.zoomReadout}
            >
              {formatZoom(boundedViewport.zoom)}
            </Text>
            <Pressable
              accessibilityLabel="地図を拡大"
              accessibilityRole="button"
              accessibilityState={{ disabled: !canZoomIn }}
              disabled={!canZoomIn}
              hitSlop={6}
              onPress={() => zoomBy(2)}
              style={({ pressed }: { readonly pressed: boolean }) => [
                styles.viewportButton,
                !canZoomIn ? styles.viewportButtonDisabled : null,
                pressed && canZoomIn ? styles.viewportButtonPressed : null,
              ]}
            >
              <Text style={styles.viewportButtonText}>＋</Text>
            </Pressable>
            <Pressable
              accessibilityLabel="地図を全体表示"
              accessibilityRole="button"
              accessibilityState={{ disabled: atFit }}
              disabled={atFit}
              hitSlop={6}
              onPress={resetViewport}
              style={({ pressed }: { readonly pressed: boolean }) => [
                styles.fitButton,
                atFit ? styles.viewportButtonDisabled : null,
                pressed && !atFit ? styles.viewportButtonPressed : null,
              ]}
            >
              <Text style={styles.fitButtonText}>全体</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      <View
        accessibilityLabel={
          interactive
            ? "探索地図。2本指で拡大し、拡大中は1本指で移動できます。"
            : "探索地図"
        }
        style={[styles.canvas, { height }]}
        onLayout={handleLayout}
        {...(interactive ? panResponder.panHandlers : {})}
      >
        {[1, 2, 3, 4].map((step) => (
          <View
            key={`vertical-${step}`}
            style={[styles.verticalGrid, { left: `${step * 20}%` }]}
          />
        ))}
        {[1, 2, 3, 4].map((step) => (
          <View
            key={`horizontal-${step}`}
            style={[styles.horizontalGrid, { top: `${step * 20}%` }]}
          />
        ))}

        {displayMode === "cells"
          ? renderedCells.map((cell) => (
              <View
                key={`cell-${cell.id}`}
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                style={[
                  styles.coverageCell,
                  {
                    left: cell.left,
                    top: cell.top,
                    width: cell.size,
                    height: cell.size,
                    opacity: cell.opacity,
                  },
                ]}
              />
            ))
          : null}

        {displayMode === "uncertainty"
          ? renderedBands.map((band) => (
              <View
                key={`uncertainty-${band.id}`}
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                style={[
                  styles.uncertaintyBand,
                  {
                    left: band.left,
                    top: band.top,
                    width: band.length,
                    height: band.width,
                    borderRadius: band.width / 2,
                    opacity: band.opacity,
                    transform: [{ rotateZ: `${band.angleRadians}rad` }],
                  },
                ]}
              />
            ))
          : null}

        {renderedSegments.flatMap((segment) =>
          segment.points.slice(1).map((point, index) => {
            const previous = segment.points[index];
            if (previous === undefined) {
              return null;
            }
            const deltaX = point.x - previous.x;
            const deltaY = point.y - previous.y;
            const length = Math.hypot(deltaX, deltaY);
            const angle = Math.atan2(deltaY, deltaX);
            const confidence = Math.min(
              point.source.confidence,
              previous.source.confidence,
            );
            const thickness = displayMode === "track" ? 4 : 2;
            return (
              <View
                key={`${segment.id}-${previous.source.sampleId}-${point.source.sampleId}`}
                style={[
                  styles.segment,
                  {
                    left: (previous.x + point.x) / 2 - length / 2,
                    top: (previous.y + point.y) / 2 - thickness / 2,
                    width: length,
                    height: thickness,
                    opacity:
                      displayMode === "track"
                        ? Math.max(0.35, confidence)
                        : Math.max(0.45, confidence * 0.75),
                    backgroundColor:
                      confidence >= 0.5
                        ? palette.track
                        : palette.trackLowConfidence,
                    transform: [{ rotateZ: `${angle}rad` }],
                  },
                ]}
              />
            );
          }),
        )}

        {renderedSegments.map((segment, index) => {
          const first = segment.points[0];
          if (first === undefined) {
            return null;
          }
          return (
            <View
              key={`start-${segment.id}`}
              accessibilityLabel={`探索${index + 1}の開始地点`}
              style={[
                styles.startPoint,
                { left: first.x - 6, top: first.y - 6 },
              ]}
            />
          );
        })}

        {renderedSegments.map((segment, index) => {
          const last = segment.points.at(-1);
          if (segment.points.length < 2 || last === undefined) {
            return null;
          }
          return (
            <View
              key={`end-${segment.id}`}
              accessibilityLabel={`探索${index + 1}の終了地点`}
              style={[
                styles.endPoint,
                { left: last.x - 7, top: last.y - 7 },
              ]}
            />
          );
        })}

        {markerPoints.map(({ marker, x, y }) => (
          <View
            key={marker.id}
            accessibilityLabel={marker.label}
            style={[styles.marker, { left: x - 13, top: y - 13 }]}
          >
            <Text style={styles.markerText}>{markerGlyph(marker.category)}</Text>
          </View>
        ))}

        {geometry.pointCount === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>まだ経路がありません</Text>
            <Text style={styles.emptyBody}>
              位置情報が記録されると、ここに自分の地図が現れます。
            </Text>
          </View>
        ) : null}

        <View style={styles.compass}>
          <Text style={styles.compassText}>N</Text>
          <View style={styles.compassLine} />
        </View>
      </View>

      <View accessibilityLabel="地図表示の説明" style={styles.legend}>
        <Text style={styles.legendTitle}>
          {displayMode === "uncertainty"
            ? "位置の不確実性"
            : displayMode === "cells"
              ? `推定通過セル ${geometry.cells.length}個`
              : "採用済み位置の中心線"}
        </Text>
        <Text style={styles.legendBody}>
          {modeDescription(displayMode, geometry.cellSizeMeters)}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    width: "100%",
  },
  modeSwitcher: {
    flexDirection: "row",
    alignSelf: "flex-start",
    gap: spacing.xs,
    padding: 4,
    marginBottom: spacing.sm,
    borderRadius: 14,
    backgroundColor: palette.background,
    borderWidth: 1,
    borderColor: palette.border,
  },
  modeButton: {
    minHeight: 34,
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    borderRadius: 10,
  },
  modeButtonSelected: {
    backgroundColor: palette.primary,
  },
  modeButtonPressed: {
    opacity: 0.78,
  },
  modeButtonText: {
    color: palette.mutedInk,
    fontSize: 12,
    fontWeight: "700",
  },
  modeButtonTextSelected: {
    color: palette.white,
  },
  viewportBar: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  viewportHint: {
    flexGrow: 1,
    flexShrink: 1,
    color: palette.mutedInk,
    fontSize: 11,
    lineHeight: 16,
  },
  viewportControls: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  viewportButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
  },
  fitButton: {
    minWidth: 56,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
    borderRadius: 12,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
  },
  viewportButtonPressed: {
    backgroundColor: palette.primarySoft,
  },
  viewportButtonDisabled: {
    opacity: 0.35,
  },
  viewportButtonText: {
    color: palette.primary,
    fontSize: 23,
    lineHeight: 26,
    fontWeight: "700",
  },
  fitButtonText: {
    color: palette.primary,
    fontSize: 12,
    fontWeight: "800",
  },
  zoomReadout: {
    minWidth: 46,
    color: palette.ink,
    fontSize: 12,
    fontWeight: "800",
    textAlign: "center",
  },
  canvas: {
    width: "100%",
    backgroundColor: palette.surface,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: palette.border,
    overflow: "hidden",
  },
  verticalGrid: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: StyleSheet.hairlineWidth,
    backgroundColor: palette.border,
    opacity: 0.55,
  },
  horizontalGrid: {
    position: "absolute",
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: palette.border,
    opacity: 0.55,
  },
  uncertaintyBand: {
    position: "absolute",
    backgroundColor: palette.primary,
  },
  coverageCell: {
    position: "absolute",
    backgroundColor: palette.primary,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.primaryPressed,
  },
  segment: {
    position: "absolute",
    borderRadius: 3,
  },
  startPoint: {
    position: "absolute",
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: palette.surface,
    borderWidth: 3,
    borderColor: palette.track,
  },
  endPoint: {
    position: "absolute",
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: palette.track,
    borderWidth: 2,
    borderColor: palette.surface,
  },
  marker: {
    position: "absolute",
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.marker,
    borderWidth: 2,
    borderColor: palette.surface,
  },
  markerText: {
    color: palette.white,
    fontSize: 14,
    lineHeight: 16,
    fontWeight: "800",
  },
  emptyState: {
    position: "absolute",
    left: spacing.xl,
    right: spacing.xl,
    top: "38%",
    alignItems: "center",
  },
  emptyTitle: {
    color: palette.ink,
    fontSize: 17,
    fontWeight: "700",
    marginBottom: spacing.sm,
  },
  emptyBody: {
    color: palette.mutedInk,
    fontSize: 14,
    lineHeight: 21,
    textAlign: "center",
  },
  compass: {
    position: "absolute",
    right: spacing.md,
    top: spacing.md,
    alignItems: "center",
  },
  compassText: {
    color: palette.mutedInk,
    fontSize: 11,
    fontWeight: "800",
  },
  compassLine: {
    width: 2,
    height: 18,
    marginTop: 2,
    backgroundColor: palette.mutedInk,
    borderRadius: 1,
  },
  legend: {
    marginTop: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  legendTitle: {
    color: palette.primary,
    fontSize: 12,
    fontWeight: "800",
  },
  legendBody: {
    color: palette.mutedInk,
    fontSize: 11,
    lineHeight: 17,
    marginTop: 2,
  },
});
