import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
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
  DEFAULT_MAP_VIEWPORT,
  MAX_MAP_VIEWPORT_SCALE,
  MIN_MAP_VIEWPORT_SCALE,
  panMapViewport,
  projectMapViewportPoint,
  zoomMapViewportAt,
  zoomMapViewportBetweenFocals,
  type MapViewport,
  type MapViewportPoint,
} from "./mapViewport";

type RenderableSnapshot = MapSnapshot | PersonalMapSnapshot;

interface TrackCanvasProps {
  readonly snapshot: RenderableSnapshot;
  readonly height?: number;
  readonly interactive?: boolean;
}

interface TouchLike {
  readonly locationX: number;
  readonly locationY: number;
}

type ViewportGesture =
  | {
      readonly kind: "pan";
      readonly viewport: MapViewport;
      readonly startPoint: MapViewportPoint;
    }
  | {
      readonly kind: "pinch";
      readonly viewport: MapViewport;
      readonly startFocal: MapViewportPoint;
      readonly startDistance: number;
    };

const DISPLAY_MODES: readonly {
  readonly value: MapDisplayMode;
  readonly label: string;
}[] = [
  { value: "uncertainty", label: "不確実性" },
  { value: "cells", label: "通過セル" },
  { value: "track", label: "軌跡" },
];

const ZOOM_STEP = 2;
const PAN_CAPTURE_DISTANCE_PX = 4;

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

function localTouchPoint(touch: TouchLike): MapViewportPoint {
  return {
    x: Number.isFinite(touch.locationX) ? touch.locationX : 0,
    y: Number.isFinite(touch.locationY) ? touch.locationY : 0,
  };
}

function pinchFocal(
  first: TouchLike,
  second: TouchLike,
): MapViewportPoint {
  const firstPoint = localTouchPoint(first);
  const secondPoint = localTouchPoint(second);
  return {
    x: (firstPoint.x + secondPoint.x) / 2,
    y: (firstPoint.y + secondPoint.y) / 2,
  };
}

function pinchDistance(first: TouchLike, second: TouchLike): number {
  const firstPoint = localTouchPoint(first);
  const secondPoint = localTouchPoint(second);
  return Math.max(
    1,
    Math.hypot(
      secondPoint.x - firstPoint.x,
      secondPoint.y - firstPoint.y,
    ),
  );
}

function formatScale(scale: number): string {
  return Number.isInteger(scale) ? scale.toFixed(0) : scale.toFixed(1);
}

export function TrackCanvas({
  height = 360,
  interactive = false,
  snapshot,
}: TrackCanvasProps) {
  const [width, setWidth] = useState(0);
  const [displayMode, setDisplayMode] =
    useState<MapDisplayMode>("uncertainty");
  const [viewport, setViewport] =
    useState<MapViewport>(DEFAULT_MAP_VIEWPORT);
  const viewportRef = useRef<MapViewport>(DEFAULT_MAP_VIEWPORT);
  const gestureRef = useRef<ViewportGesture | null>(null);

  const sourceSegments = useMemo(() => snapshotSegments(snapshot), [snapshot]);
  const sourcePointCount = useMemo(
    () =>
      sourceSegments.reduce(
        (total, segment) => total + segment.points.length,
        0,
      ),
    [sourceSegments],
  );
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

  const commitViewport = useCallback((nextViewport: MapViewport) => {
    viewportRef.current = nextViewport;
    setViewport(nextViewport);
  }, []);

  const viewportResetKey = useMemo(() => {
    const bounds = snapshot.bounds;
    return bounds === null
      ? `empty:${sourcePointCount}`
      : [
          bounds.minX,
          bounds.minY,
          bounds.maxX,
          bounds.maxY,
          sourcePointCount,
        ].join(":");
  }, [snapshot.bounds, sourcePointCount]);

  useEffect(() => {
    commitViewport(DEFAULT_MAP_VIEWPORT);
    gestureRef.current = null;
  }, [commitViewport, height, viewportResetKey, width]);

  const markerPoints = useMemo(() => {
    const projection = geometry.projection;
    if (projection === null) {
      return [];
    }
    return snapshot.markers.flatMap((marker) => {
      if (marker.xMeters === undefined || marker.yMeters === undefined) {
        return [];
      }
      return [
        {
          marker,
          ...projectExploredPoint(projection, {
            xMeters: marker.xMeters,
            yMeters: marker.yMeters,
          }),
        },
      ];
    });
  }, [geometry.projection, snapshot.markers]);

  const viewedMarkerPoints = useMemo(
    () =>
      markerPoints.map(({ marker, x, y }) => ({
        marker,
        ...projectMapViewportPoint(viewport, { x, y }, width, height),
      })),
    [height, markerPoints, viewport, width],
  );

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponderCapture: (event) =>
          interactive &&
          geometry.pointCount > 0 &&
          event.nativeEvent.touches.length >= 2,
        onMoveShouldSetPanResponderCapture: (event, gestureState) =>
          interactive &&
          geometry.pointCount > 0 &&
          (event.nativeEvent.touches.length >= 2 ||
            (viewportRef.current.scale > MIN_MAP_VIEWPORT_SCALE &&
              Math.hypot(gestureState.dx, gestureState.dy) >=
                PAN_CAPTURE_DISTANCE_PX)),
        onPanResponderGrant: (event: GestureResponderEvent) => {
          const touches = event.nativeEvent.touches;
          const current = viewportRef.current;
          if (touches.length >= 2) {
            const first = touches[0]!;
            const second = touches[1]!;
            gestureRef.current = {
              kind: "pinch",
              viewport: current,
              startFocal: pinchFocal(first, second),
              startDistance: pinchDistance(first, second),
            };
          } else if (
            touches.length === 1 &&
            current.scale > MIN_MAP_VIEWPORT_SCALE
          ) {
            gestureRef.current = {
              kind: "pan",
              viewport: current,
              startPoint: localTouchPoint(touches[0]!),
            };
          }
        },
        onPanResponderMove: (event: GestureResponderEvent) => {
          const touches = event.nativeEvent.touches;
          const gesture = gestureRef.current;

          if (touches.length >= 2) {
            const first = touches[0]!;
            const second = touches[1]!;
            if (gesture === null || gesture.kind !== "pinch") {
              gestureRef.current = {
                kind: "pinch",
                viewport: viewportRef.current,
                startFocal: pinchFocal(first, second),
                startDistance: pinchDistance(first, second),
              };
              return;
            }
            const currentDistance = pinchDistance(first, second);
            commitViewport(
              zoomMapViewportBetweenFocals(
                gesture.viewport,
                gesture.viewport.scale *
                  (currentDistance / gesture.startDistance),
                gesture.startFocal,
                pinchFocal(first, second),
                width,
                height,
              ),
            );
            return;
          }

          if (
            touches.length === 1 &&
            gesture !== null &&
            gesture.kind === "pan"
          ) {
            const currentPoint = localTouchPoint(touches[0]!);
            commitViewport(
              panMapViewport(
                gesture.viewport,
                currentPoint.x - gesture.startPoint.x,
                currentPoint.y - gesture.startPoint.y,
                width,
                height,
              ),
            );
          }
        },
        onPanResponderRelease: () => {
          gestureRef.current = null;
        },
        onPanResponderTerminate: () => {
          gestureRef.current = null;
        },
        onPanResponderTerminationRequest: () => false,
        onShouldBlockNativeResponder: () => true,
      }),
    [commitViewport, geometry.pointCount, height, interactive, width],
  );

  function handleLayout(event: LayoutChangeEvent) {
    setWidth(event.nativeEvent.layout.width);
  }

  function zoomTo(nextScale: number) {
    commitViewport(
      zoomMapViewportAt(
        viewportRef.current,
        nextScale,
        { x: width / 2, y: height / 2 },
        width,
        height,
      ),
    );
  }

  function resetViewport() {
    commitViewport(DEFAULT_MAP_VIEWPORT);
  }

  const canInteract = interactive && geometry.pointCount > 0 && width > 0;
  const canZoomOut =
    canInteract && viewport.scale > MIN_MAP_VIEWPORT_SCALE;
  const canZoomIn = canInteract && viewport.scale < MAX_MAP_VIEWPORT_SCALE;
  const viewportChanged =
    viewport.scale > MIN_MAP_VIEWPORT_SCALE ||
    viewport.panX !== 0 ||
    viewport.panY !== 0;
  const scaleLabel = formatScale(viewport.scale);
  const logicalSegmentThickness =
    (displayMode === "track" ? 4 : 2) / viewport.scale;

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
        <View style={styles.viewportToolbar}>
          <View style={styles.viewportGuidance}>
            <Text style={styles.viewportTitle}>地図を詳しく見る</Text>
            <Text style={styles.viewportHint}>
              2本指で拡大。拡大後は1本指で移動できます。
            </Text>
          </View>
          <View style={styles.viewportButtons}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="地図を縮小"
              accessibilityState={{ disabled: !canZoomOut }}
              disabled={!canZoomOut}
              onPress={() => zoomTo(viewportRef.current.scale / ZOOM_STEP)}
              style={({ pressed }: { readonly pressed: boolean }) => [
                styles.viewportButton,
                !canZoomOut ? styles.viewportButtonDisabled : null,
                pressed && canZoomOut ? styles.viewportButtonPressed : null,
              ]}
            >
              <Text style={styles.viewportButtonText}>−</Text>
            </Pressable>
            <Text
              accessibilityLabel={`地図倍率 ${scaleLabel}倍`}
              style={styles.viewportScale}
            >
              ×{scaleLabel}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="地図を拡大"
              accessibilityState={{ disabled: !canZoomIn }}
              disabled={!canZoomIn}
              onPress={() => zoomTo(viewportRef.current.scale * ZOOM_STEP)}
              style={({ pressed }: { readonly pressed: boolean }) => [
                styles.viewportButton,
                !canZoomIn ? styles.viewportButtonDisabled : null,
                pressed && canZoomIn ? styles.viewportButtonPressed : null,
              ]}
            >
              <Text style={styles.viewportButtonText}>＋</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="地図を全体表示"
              accessibilityState={{ disabled: !viewportChanged }}
              disabled={!viewportChanged}
              onPress={resetViewport}
              style={({ pressed }: { readonly pressed: boolean }) => [
                styles.fitButton,
                !viewportChanged ? styles.viewportButtonDisabled : null,
                pressed && viewportChanged ? styles.viewportButtonPressed : null,
              ]}
            >
              <Text style={styles.fitButtonText}>全体</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      <View style={[styles.canvas, { height }]} onLayout={handleLayout}>
        {[1, 2, 3, 4].map((step) => (
          <View
            key={`vertical-${step}`}
            pointerEvents="none"
            style={[styles.verticalGrid, { left: `${step * 20}%` }]}
          />
        ))}
        {[1, 2, 3, 4].map((step) => (
          <View
            key={`horizontal-${step}`}
            pointerEvents="none"
            style={[styles.horizontalGrid, { top: `${step * 20}%` }]}
          />
        ))}

        <View
          pointerEvents="none"
          style={[
            styles.mapPanLayer,
            {
              transform: [
                { translateX: viewport.panX },
                { translateY: viewport.panY },
              ],
            },
          ]}
        >
          <View
            style={[
              styles.mapZoomLayer,
              { transform: [{ scale: viewport.scale }] },
            ]}
          >
            {displayMode === "cells"
              ? geometry.cells.map((cell) => (
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
              ? geometry.uncertaintyBands.map((band) => (
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
                        transform: [
                          { rotateZ: `${band.angleRadians}rad` },
                        ],
                      },
                    ]}
                  />
                ))
              : null}

            {geometry.segments.flatMap((segment) =>
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
                return (
                  <View
                    key={`${segment.id}-${previous.source.sampleId}-${point.source.sampleId}`}
                    style={[
                      styles.segment,
                      {
                        left: (previous.x + point.x) / 2 - length / 2,
                        top:
                          (previous.y + point.y) / 2 -
                          logicalSegmentThickness / 2,
                        width: length,
                        height: logicalSegmentThickness,
                        borderRadius: 3 / viewport.scale,
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
          </View>
        </View>

        <View pointerEvents="none" style={styles.mapAnchorLayer}>
          {geometry.segments.map((segment, index) => {
            const first = segment.points[0];
            if (first === undefined) {
              return null;
            }
            const viewed = projectMapViewportPoint(
              viewport,
              first,
              width,
              height,
            );
            return (
              <View
                key={`start-${segment.id}`}
                accessibilityLabel={`探索${index + 1}の開始地点`}
                style={[
                  styles.startPoint,
                  { left: viewed.x - 6, top: viewed.y - 6 },
                ]}
              />
            );
          })}

          {geometry.segments.map((segment, index) => {
            const last = segment.points.at(-1);
            if (segment.points.length < 2 || last === undefined) {
              return null;
            }
            const viewed = projectMapViewportPoint(
              viewport,
              last,
              width,
              height,
            );
            return (
              <View
                key={`end-${segment.id}`}
                accessibilityLabel={`探索${index + 1}の終了地点`}
                style={[
                  styles.endPoint,
                  { left: viewed.x - 7, top: viewed.y - 7 },
                ]}
              />
            );
          })}

          {viewedMarkerPoints.map(({ marker, x, y }) => (
            <View
              key={marker.id}
              accessibilityLabel={marker.label}
              style={[styles.marker, { left: x - 13, top: y - 13 }]}
            >
              <Text style={styles.markerText}>
                {markerGlyph(marker.category)}
              </Text>
            </View>
          ))}
        </View>

        {geometry.pointCount === 0 ? (
          <View pointerEvents="none" style={styles.emptyState}>
            <Text style={styles.emptyTitle}>まだ経路がありません</Text>
            <Text style={styles.emptyBody}>
              位置情報が記録されると、ここに自分の地図が現れます。
            </Text>
          </View>
        ) : null}

        {interactive && geometry.pointCount > 0 ? (
          <View
            {...panResponder.panHandlers}
            accessible
            accessibilityLabel={`探索地図。現在${scaleLabel}倍。2本指で拡大し、拡大後は1本指で移動できます。`}
            style={styles.gestureLayer}
          />
        ) : null}

        <View pointerEvents="none" style={styles.compass}>
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
  viewportToolbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  viewportGuidance: {
    flex: 1,
  },
  viewportTitle: {
    color: palette.ink,
    fontSize: 12,
    fontWeight: "800",
  },
  viewportHint: {
    color: palette.mutedInk,
    fontSize: 10,
    lineHeight: 15,
    marginTop: 1,
  },
  viewportButtons: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  viewportButton: {
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surface,
  },
  fitButton: {
    minWidth: 46,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surface,
  },
  viewportButtonPressed: {
    backgroundColor: palette.primarySoft,
    opacity: 0.82,
  },
  viewportButtonDisabled: {
    opacity: 0.35,
  },
  viewportButtonText: {
    color: palette.primary,
    fontSize: 20,
    lineHeight: 22,
    fontWeight: "800",
  },
  fitButtonText: {
    color: palette.primary,
    fontSize: 11,
    fontWeight: "800",
  },
  viewportScale: {
    minWidth: 34,
    color: palette.ink,
    fontSize: 11,
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
  mapPanLayer: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
  },
  mapZoomLayer: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
  },
  mapAnchorLayer: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
  },
  gestureLayer: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
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
