import { useMemo, useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
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

type RenderableSnapshot = MapSnapshot | PersonalMapSnapshot;

interface TrackCanvasProps {
  readonly snapshot: RenderableSnapshot;
  readonly height?: number;
}

const DISPLAY_MODES: readonly {
  readonly value: MapDisplayMode;
  readonly label: string;
}[] = [
  { value: "uncertainty", label: "不確実性" },
  { value: "cells", label: "通過セル" },
  { value: "track", label: "軌跡" },
];

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
      return "帯は採用済み位置の中心推定がどこにあり得るかを示します。幅が広いほど位置が曖昧で、探索済み面積・道路幅・境界を意味しません。";
    case "cells":
      return cellSizeMeters === null
        ? "位置情報が集まると、中心推定経路の近傍を保守的な通過セルとして表示します。"
        : `中心推定経路の近傍を約${Math.round(cellSizeMeters)}m単位で保守的にセル化しています。位置精度は色の濃さに反映し、セル面積は広げません。別の探索で再観測されると少し濃くなります。`;
    case "track":
      return "採用済み位置の中心推定を結んだ線です。GPSロガーとの比較用に残しています。";
  }
}

export function TrackCanvas({ height = 360, snapshot }: TrackCanvasProps) {
  const [width, setWidth] = useState(0);
  const [displayMode, setDisplayMode] =
    useState<MapDisplayMode>("uncertainty");
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

  function handleLayout(event: LayoutChangeEvent) {
    setWidth(event.nativeEvent.layout.width);
  }

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

      <View style={[styles.canvas, { height }]} onLayout={handleLayout}>
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
          ? geometry.cells.map((cell) => (
              <View
                key={`cell-${cell.id}`}
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                style={[
                  styles.passageCell,
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
                    transform: [{ rotateZ: `${band.angleRadians}rad` }],
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

        {geometry.segments.map((segment, index) => {
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

        {geometry.segments.map((segment, index) => {
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
              : "採用済み軌跡"}
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
  passageCell: {
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
