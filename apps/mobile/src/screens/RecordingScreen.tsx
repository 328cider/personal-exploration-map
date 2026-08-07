import { useEffect, useRef, useState } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { MarkerCategory } from "@exploration-map/mapping-core";

import { AppButton } from "../components/AppButton";
import { LiveMapPreview } from "../components/LiveMapPreview";
import { MarkerModal } from "../components/MarkerModal";
import type {
  ExplorationSummary,
  LiveExplorationStats,
} from "../storage/explorationRepository";
import { palette, spacing } from "../theme";
import { formatElapsedClock } from "../utils/format";

interface RecordingScreenProps {
  readonly exploration: ExplorationSummary;
  readonly liveStats: LiveExplorationStats;
  readonly runtimeRunning: boolean;
  readonly stopping: boolean;
  readonly onAddMarker: (input: {
    readonly category: MarkerCategory;
    readonly label: string;
    readonly note?: string;
  }) => Promise<void>;
  readonly onMarkerInputMetric: (
    outcome: "completed" | "cancelled",
    durationMs: number,
  ) => Promise<void>;
  readonly onEnd: () => void;
}

export function RecordingScreen({
  exploration,
  liveStats,
  runtimeRunning,
  stopping,
  onAddMarker,
  onMarkerInputMetric,
  onEnd,
}: RecordingScreenProps) {
  const [now, setNow] = useState(Date.now());
  const [markerVisible, setMarkerVisible] = useState(false);
  const markerOpenedAtMs = useRef<number | null>(null);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const isBackground = exploration.trackingMode === "background";
  const accuracy = liveStats.latestAccuracyMeters;

  function openMarkerInput() {
    markerOpenedAtMs.current = Date.now();
    setMarkerVisible(true);
  }

  function closeMarkerInput() {
    const openedAtMs = markerOpenedAtMs.current;
    markerOpenedAtMs.current = null;
    setMarkerVisible(false);
    if (openedAtMs !== null) {
      void onMarkerInputMetric(
        "cancelled",
        Math.max(0, Date.now() - openedAtMs),
      );
    }
  }

  async function saveMarker(input: {
    readonly category: MarkerCategory;
    readonly label: string;
    readonly note?: string;
  }) {
    const openedAtMs = markerOpenedAtMs.current;
    const durationMs =
      openedAtMs === null ? 0 : Math.max(0, Date.now() - openedAtMs);
    await onAddMarker(input);
    // MarkerModal calls onClose after onSave resolves. Clear synchronously so
    // that close is not also recorded as a cancellation.
    markerOpenedAtMs.current = null;
    void onMarkerInputMetric("completed", durationMs);
  }

  return (
    <>
      <View style={styles.screen}>
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.statusRow}>
            <View
              style={[
                styles.statusDot,
                runtimeRunning
                  ? styles.statusDotActive
                  : styles.statusDotWarning,
              ]}
            />
            <Text style={styles.statusLabel}>
              {runtimeRunning ? "探索を記録中" : "記録状態を確認してください"}
            </Text>
          </View>

          <Text style={styles.timer}>
            {formatElapsedClock(now - exploration.startedAtMs)}
          </Text>
          <Text style={styles.pocketMessage}>
            {isBackground
              ? "スマホはしまって大丈夫です。"
              : "簡易記録中です。画面を閉じないでください。"}
          </Text>

          {!runtimeRunning ? (
            <View style={styles.warningCard}>
              <Text style={styles.warningTitle}>位置記録が動いていません</Text>
              <Text style={styles.warningBody}>
                OSによる停止またはアプリ再起動の可能性があります。現在までのデータは保存されています。探索を終了してレビューしてください。
              </Text>
            </View>
          ) : null}

          <View style={styles.metricGrid}>
            <View style={styles.metricCard}>
              <Text style={styles.metricValue}>{liveStats.rawSampleCount}</Text>
              <Text style={styles.metricLabel}>位置サンプル</Text>
            </View>
            <View style={styles.metricCard}>
              <Text style={styles.metricValue}>{liveStats.markerCount}</Text>
              <Text style={styles.metricLabel}>発見</Text>
            </View>
            <View style={styles.metricCard}>
              <Text style={styles.metricValue}>
                {accuracy === null ? "—" : `${Math.round(accuracy)}m`}
              </Text>
              <Text style={styles.metricLabel}>直近の精度</Text>
            </View>
          </View>

          <LiveMapPreview personalMapId={exploration.personalMapId} />
        </ScrollView>

        <View style={styles.actions}>
          <View style={styles.actionRow}>
            <AppButton
              disabled={stopping}
              onPress={openMarkerInput}
              style={styles.markerButton}
              variant="secondary"
            >
              ＋ 発見を記録
            </AppButton>
            <AppButton
              loading={stopping}
              onPress={onEnd}
              style={styles.endButton}
              variant="danger"
            >
              探索を終了して地図を見る
            </AppButton>
          </View>
          <Text style={styles.endNote}>
            終了しても、今回の生データと発見は端末内に残ります。
          </Text>
        </View>
      </View>

      <MarkerModal
        visible={markerVisible}
        onClose={closeMarkerInput}
        onSave={saveMarker}
      />
    </>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.lg,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  statusDotActive: {
    backgroundColor: palette.primary,
  },
  statusDotWarning: {
    backgroundColor: palette.warning,
  },
  statusLabel: {
    color: palette.mutedInk,
    fontSize: 14,
    fontWeight: "700",
  },
  timer: {
    color: palette.ink,
    fontSize: 48,
    lineHeight: 58,
    fontWeight: "300",
    letterSpacing: 1.5,
    textAlign: "center",
    marginTop: spacing.lg,
  },
  pocketMessage: {
    color: palette.primary,
    fontSize: 20,
    lineHeight: 28,
    fontWeight: "800",
    textAlign: "center",
    marginTop: spacing.sm,
  },
  warningCard: {
    marginTop: spacing.lg,
    padding: spacing.md,
    borderRadius: 18,
    backgroundColor: palette.warningSoft,
  },
  warningTitle: {
    color: palette.warning,
    fontSize: 14,
    fontWeight: "800",
  },
  warningBody: {
    color: palette.mutedInk,
    fontSize: 13,
    lineHeight: 20,
    marginTop: spacing.xs,
  },
  metricGrid: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.xl,
  },
  metricCard: {
    flex: 1,
    minHeight: 98,
    padding: spacing.md,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surface,
    justifyContent: "center",
  },
  metricValue: {
    color: palette.ink,
    fontSize: 24,
    lineHeight: 30,
    fontWeight: "800",
    textAlign: "center",
  },
  metricLabel: {
    color: palette.mutedInk,
    fontSize: 11,
    lineHeight: 16,
    textAlign: "center",
    marginTop: spacing.xs,
  },
  actions: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    backgroundColor: palette.background,
    borderTopWidth: 1,
    borderTopColor: palette.border,
  },
  actionRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  markerButton: {
    flex: 0.8,
    minHeight: 50,
    paddingHorizontal: spacing.sm,
  },
  endButton: {
    flex: 1.2,
    minHeight: 50,
    paddingHorizontal: spacing.sm,
  },
  endNote: {
    color: palette.mutedInk,
    fontSize: 10,
    lineHeight: 15,
    textAlign: "center",
    marginTop: spacing.xs,
  },
});
