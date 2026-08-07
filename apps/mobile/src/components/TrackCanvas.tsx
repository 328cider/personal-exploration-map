import { useMemo, useState } from "react";
import {
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

type RenderableSnapshot = MapSnapshot | PersonalMapSnapshot;

interface TrackCanvasProps {
  readonly snapshot: RenderableSnapshot;
  readonly height?: number;
}

interface ScreenPoint {
  readonly x: number;
  readonly y: number;
  readonly source: TrackPoint;
}

interface ScreenSegment {
  readonly id: string;
  readonly points: readonly ScreenPoint[];
}

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
  readonly track: readonly TrackPoint[];
}[] {
  if ("segments" in snapshot) {
    return snapshot.segments.map((segment) => ({
      id: segment.explorationId,
      track: segment.track,
    }));
  }
  return [{ id: snapshot.explorationId, track: snapshot.track }];
}

export function TrackCanvas({ height = 360, snapshot }: TrackCanvasProps) {
  const [width, setWidth] = useState(0);
  const padding = 34;
  const projectedSegments = useMemo<readonly ScreenSegment[]>(() => {
    if (width <= 0 || snapshot.bounds === null) {
      return [];
    }

    const rangeX = Math.max(1, snapshot.bounds.maxX - snapshot.bounds.minX);
    const rangeY = Math.max(1, snapshot.bounds.maxY - snapshot.bounds.minY);
    const scale = Math.min(
      (width - padding * 2) / rangeX,
      (height - padding * 2) / rangeY,
    );
    const usedWidth = rangeX * scale;
    const usedHeight = rangeY * scale;
    const offsetX = (width - usedWidth) / 2;
    const offsetY = (height - usedHeight) / 2;

    return snapshotSegments(snapshot).map((segment) => ({
      id: segment.id,
      points: segment.track.map((point) => ({
        source: point,
        x: offsetX + (point.xMeters - snapshot.bounds!.minX) * scale,
        y:
          height -
          (offsetY + (point.yMeters - snapshot.bounds!.minY) * scale),
      })),
    }));
  }, [height, snapshot, width]);

  const markerPoints = useMemo(() => {
    if (width <= 0 || snapshot.bounds === null) {
      return [];
    }
    const rangeX = Math.max(1, snapshot.bounds.maxX - snapshot.bounds.minX);
    const rangeY = Math.max(1, snapshot.bounds.maxY - snapshot.bounds.minY);
    const scale = Math.min(
      (width - padding * 2) / rangeX,
      (height - padding * 2) / rangeY,
    );
    const usedWidth = rangeX * scale;
    const usedHeight = rangeY * scale;
    const offsetX = (width - usedWidth) / 2;
    const offsetY = (height - usedHeight) / 2;

    return snapshot.markers.flatMap((marker) => {
      if (marker.xMeters === undefined || marker.yMeters === undefined) {
        return [];
      }
      return [
        {
          marker,
          x: offsetX + (marker.xMeters - snapshot.bounds!.minX) * scale,
          y:
            height -
            (offsetY + (marker.yMeters - snapshot.bounds!.minY) * scale),
        },
      ];
    });
  }, [height, snapshot.bounds, snapshot.markers, width]);

  const pointCount = projectedSegments.reduce(
    (sum, segment) => sum + segment.points.length,
    0,
  );

  function handleLayout(event: LayoutChangeEvent) {
    setWidth(event.nativeEvent.layout.width);
  }

  return (
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

      {projectedSegments.flatMap((segment) =>
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
                  top: (previous.y + point.y) / 2 - 2,
                  width: length,
                  opacity: Math.max(0.35, confidence),
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

      {projectedSegments.map((segment, index) => {
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

      {projectedSegments.map((segment, index) => {
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

      {pointCount === 0 ? (
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
  );
}

const styles = StyleSheet.create({
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
  segment: {
    position: "absolute",
    height: 4,
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
});
