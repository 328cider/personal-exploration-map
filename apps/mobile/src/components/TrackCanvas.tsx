import { useMemo, useState } from "react";
import {
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from "react-native";
import Svg, {
  Circle,
  G,
  Line,
  Path,
  Text as SvgText,
} from "react-native-svg";
import type {
  MapSnapshot,
  PersonalMapSnapshot,
} from "@exploration-map/mapping-core";

import { buildTrackCanvasGeometry } from "../rendering/trackGeometry";
import { palette, spacing } from "../theme";

type RenderableSnapshot = MapSnapshot | PersonalMapSnapshot;

interface TrackCanvasProps {
  readonly snapshot: RenderableSnapshot;
  readonly height?: number;
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

export function TrackCanvas({ height = 360, snapshot }: TrackCanvasProps) {
  const [width, setWidth] = useState(0);
  const geometry = useMemo(
    () =>
      buildTrackCanvasGeometry({
        snapshot,
        width,
        height,
      }),
    [height, snapshot, width],
  );

  function handleLayout(event: LayoutChangeEvent) {
    setWidth(event.nativeEvent.layout.width);
  }

  return (
    <View style={[styles.canvas, { height }]} onLayout={handleLayout}>
      {width <= 0 ? null : (
        <Svg
          accessibilityLabel="自分の探索地図"
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          width="100%"
        >
          {[1, 2, 3, 4].map((step) => (
            <Line
              key={`vertical-${step}`}
              opacity={0.55}
              stroke={palette.border}
              strokeWidth={StyleSheet.hairlineWidth}
              x1={width * step * 0.2}
              x2={width * step * 0.2}
              y1={0}
              y2={height}
            />
          ))}
          {[1, 2, 3, 4].map((step) => (
            <Line
              key={`horizontal-${step}`}
              opacity={0.55}
              stroke={palette.border}
              strokeWidth={StyleSheet.hairlineWidth}
              x1={0}
              x2={width}
              y1={height * step * 0.2}
              y2={height * step * 0.2}
            />
          ))}

          {geometry.strokes.map((stroke) => (
            <Path
              key={stroke.id}
              d={stroke.pathData}
              fill="none"
              opacity={stroke.opacity}
              stroke={
                stroke.confidenceBand === "high"
                  ? palette.track
                  : palette.trackLowConfidence
              }
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={4}
            />
          ))}

          {geometry.endpoints.map((endpoint) => (
            <G
              key={`${endpoint.explorationId}-${endpoint.kind}`}
              accessibilityLabel={`探索${endpoint.explorationIndex + 1}の${endpoint.kind === "start" ? "開始" : "終了"}地点`}
              accessible
            >
              <Circle
                cx={endpoint.point.x}
                cy={endpoint.point.y}
                fill={
                  endpoint.kind === "start"
                    ? palette.surface
                    : palette.track
                }
                r={endpoint.kind === "start" ? 6 : 7}
                stroke={
                  endpoint.kind === "start"
                    ? palette.track
                    : palette.surface
                }
                strokeWidth={endpoint.kind === "start" ? 3 : 2}
              />
            </G>
          ))}

          {geometry.markers.map(({ marker, point }) => (
            <G
              key={marker.id}
              accessibilityLabel={marker.label}
              accessible
            >
              <Circle
                cx={point.x}
                cy={point.y}
                fill={palette.marker}
                r={13}
                stroke={palette.surface}
                strokeWidth={2}
              />
              <SvgText
                fill={palette.white}
                fontSize={14}
                fontWeight="800"
                textAnchor="middle"
                x={point.x}
                y={point.y + 5}
              >
                {markerGlyph(marker.category)}
              </SvgText>
            </G>
          ))}

          <SvgText
            fill={palette.mutedInk}
            fontSize={11}
            fontWeight="800"
            textAnchor="middle"
            x={width - spacing.md - 1}
            y={spacing.md + 10}
          >
            N
          </SvgText>
          <Line
            stroke={palette.mutedInk}
            strokeLinecap="round"
            strokeWidth={2}
            x1={width - spacing.md - 1}
            x2={width - spacing.md - 1}
            y1={spacing.md + 15}
            y2={spacing.md + 33}
          />
        </Svg>
      )}

      {geometry.pointCount === 0 ? (
        <View pointerEvents="none" style={styles.emptyState}>
          <Text style={styles.emptyTitle}>まだ経路がありません</Text>
          <Text style={styles.emptyBody}>
            位置情報が記録されると、ここに自分の地図が現れます。
          </Text>
        </View>
      ) : null}
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
});
