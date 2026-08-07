import { ScrollView, StyleSheet, Text, View } from "react-native";
import type { PersonalMapSnapshot } from "@exploration-map/mapping-core";
import type { PersonalMapListItem } from "@exploration-map/mapping-engine";

import { AppButton } from "../components/AppButton";
import { TrackCanvas } from "../components/TrackCanvas";
import { TrackingDiagnosticsPanel } from "../components/TrackingDiagnosticsPanel";
import type { ExplorationTrackingReportItem } from "../diagnostics/trackingDiagnostics";
import { palette, spacing } from "../theme";
import {
  formatDateTime,
  formatDistance,
  formatDuration,
} from "../utils/format";

interface ReviewScreenProps {
  readonly personalMap: PersonalMapListItem;
  readonly snapshot: PersonalMapSnapshot;
  readonly diagnostics: readonly ExplorationTrackingReportItem[];
  readonly onContinue: () => void;
  readonly onHome: () => void;
}

export function ReviewScreen({
  personalMap,
  snapshot,
  diagnostics,
  onContinue,
  onHome,
}: ReviewScreenProps) {
  return (
    <ScrollView
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <Text style={styles.eyebrow}>YOUR PERSONAL MAP</Text>
      <Text style={styles.title}>{personalMap.name}</Text>
      <Text style={styles.date}>
        最終更新 {formatDateTime(personalMap.updatedAtMs)}
      </Text>

      <View style={styles.canvasWrapper}>
        <TrackCanvas snapshot={snapshot} />
      </View>

      <View style={styles.legend}>
        <View style={styles.legendItem}>
          <View style={styles.startLegend} />
          <Text style={styles.legendText}>各探索の開始</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={styles.endLegend} />
          <Text style={styles.legendText}>各探索の終了</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={styles.markerLegend} />
          <Text style={styles.legendText}>発見</Text>
        </View>
      </View>

      <Text style={styles.segmentNote}>
        探索ごとの経路は別々に保持し、実際に歩いていない区間を直線でつないでいません。
      </Text>

      <View style={styles.metrics}>
        <View style={styles.metric}>
          <Text style={styles.metricValue}>
            {formatDistance(snapshot.stats.distanceMeters)}
          </Text>
          <Text style={styles.metricLabel}>合計経路</Text>
        </View>
        <View style={styles.metricDivider} />
        <View style={styles.metric}>
          <Text style={styles.metricValue}>
            {snapshot.stats.explorationCount}
          </Text>
          <Text style={styles.metricLabel}>探索回数</Text>
        </View>
        <View style={styles.metricDivider} />
        <View style={styles.metric}>
          <Text style={styles.metricValue}>{snapshot.stats.markerCount}</Text>
          <Text style={styles.metricLabel}>発見</Text>
        </View>
      </View>

      <View style={styles.qualityCard}>
        <View style={styles.qualityHeader}>
          <Text style={styles.qualityTitle}>地図の根拠</Text>
          <Text style={styles.qualityRevision}>rev {snapshot.revision}</Text>
        </View>
        <View style={styles.qualityRow}>
          <Text style={styles.qualityLabel}>合計探索時間</Text>
          <Text style={styles.qualityValue}>
            {formatDuration(snapshot.stats.durationMs)}
          </Text>
        </View>
        <View style={styles.qualityRow}>
          <Text style={styles.qualityLabel}>生の位置サンプル</Text>
          <Text style={styles.qualityValue}>{snapshot.stats.rawSampleCount}</Text>
        </View>
        <View style={styles.qualityRow}>
          <Text style={styles.qualityLabel}>地図に採用</Text>
          <Text style={styles.qualityValue}>
            {snapshot.stats.acceptedSampleCount}
          </Text>
        </View>
        <View style={styles.qualityRow}>
          <Text style={styles.qualityLabel}>異常値として除外</Text>
          <Text style={styles.qualityValue}>
            {snapshot.stats.rejectedSampleCount}
          </Text>
        </View>
        <Text style={styles.qualityNote}>
          除外した位置も削除せず保持しています。フィルタを改善した時に、すべての探索から地図を再生成できます。
        </Text>
      </View>

      {snapshot.markers.length > 0 ? (
        <View style={styles.markerSection}>
          <Text style={styles.sectionTitle}>発見</Text>
          {snapshot.markers.map((marker) => (
            <View key={marker.id} style={styles.markerCard}>
              <View style={styles.markerGlyph}>
                <Text style={styles.markerGlyphText}>★</Text>
              </View>
              <View style={styles.markerBody}>
                <Text style={styles.markerTitle}>{marker.label}</Text>
                {marker.note === undefined ? null : (
                  <Text style={styles.markerNote}>{marker.note}</Text>
                )}
              </View>
            </View>
          ))}
        </View>
      ) : null}

      {__DEV__ ? <TrackingDiagnosticsPanel reports={diagnostics} /> : null}

      <AppButton onPress={onContinue} style={styles.continueButton}>
        この地図の続きを探索
      </AppButton>
      <AppButton onPress={onHome} style={styles.homeButton} variant="ghost">
        自分の地図一覧へ
      </AppButton>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xxl,
  },
  eyebrow: {
    color: palette.primary,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.3,
  },
  title: {
    color: palette.ink,
    fontSize: 28,
    lineHeight: 35,
    fontWeight: "900",
    marginTop: spacing.xs,
  },
  date: {
    color: palette.mutedInk,
    fontSize: 13,
    marginTop: spacing.xs,
  },
  canvasWrapper: {
    marginTop: spacing.lg,
  },
  legend: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  legendText: {
    color: palette.mutedInk,
    fontSize: 11,
  },
  startLegend: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: palette.track,
    backgroundColor: palette.surface,
  },
  endLegend: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: palette.track,
  },
  markerLegend: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: palette.marker,
  },
  segmentNote: {
    color: palette.mutedInk,
    fontSize: 11,
    lineHeight: 17,
    textAlign: "center",
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  metrics: {
    flexDirection: "row",
    alignItems: "stretch",
    marginTop: spacing.xl,
    paddingVertical: spacing.lg,
    borderRadius: 20,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
  },
  metric: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  metricValue: {
    color: palette.ink,
    fontSize: 19,
    lineHeight: 25,
    fontWeight: "800",
  },
  metricLabel: {
    color: palette.mutedInk,
    fontSize: 11,
    marginTop: spacing.xs,
  },
  metricDivider: {
    width: 1,
    backgroundColor: palette.border,
  },
  qualityCard: {
    marginTop: spacing.md,
    padding: spacing.lg,
    borderRadius: 20,
    backgroundColor: palette.primarySoft,
  },
  qualityHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.sm,
  },
  qualityTitle: {
    color: palette.primary,
    fontSize: 15,
    fontWeight: "800",
  },
  qualityRevision: {
    color: palette.mutedInk,
    fontSize: 11,
  },
  qualityRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: spacing.xs,
  },
  qualityLabel: {
    color: palette.mutedInk,
    fontSize: 13,
  },
  qualityValue: {
    color: palette.ink,
    fontSize: 13,
    fontWeight: "700",
  },
  qualityNote: {
    color: palette.mutedInk,
    fontSize: 11,
    lineHeight: 17,
    marginTop: spacing.sm,
  },
  markerSection: {
    marginTop: spacing.xl,
  },
  sectionTitle: {
    color: palette.ink,
    fontSize: 21,
    lineHeight: 27,
    fontWeight: "800",
    marginBottom: spacing.sm,
  },
  markerCard: {
    flexDirection: "row",
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: 18,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
    marginBottom: spacing.sm,
  },
  markerGlyph: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.marker,
  },
  markerGlyphText: {
    color: palette.white,
    fontSize: 16,
    fontWeight: "800",
  },
  markerBody: {
    flex: 1,
  },
  markerTitle: {
    color: palette.ink,
    fontSize: 14,
    fontWeight: "800",
  },
  markerNote: {
    color: palette.mutedInk,
    fontSize: 13,
    lineHeight: 20,
    marginTop: spacing.xs,
  },
  continueButton: {
    marginTop: spacing.xl,
  },
  homeButton: {
    marginTop: spacing.sm,
  },
});
