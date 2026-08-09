import { useState } from "react";
import { Share, StyleSheet, Text, View } from "react-native";
import { formatTrackingDiagnosticsSummary } from "@exploration-map/mapping-engine";

import type { ExplorationTrackingReportItem } from "../diagnostics/trackingDiagnostics";
import { palette, spacing } from "../theme";
import { formatDateTime, formatDuration } from "../utils/format";
import { AppButton } from "./AppButton";

interface TrackingDiagnosticsPanelProps {
  readonly reports: readonly ExplorationTrackingReportItem[];
}

function formatNumber(value: number | null, suffix = ""): string {
  return value === null ? "—" : `${Math.round(value)}${suffix}`;
}

function formatPercent(value: number | null): string {
  return value === null ? "—" : `${Math.round(value * 100)}%`;
}

function formatBattery(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(1)}%`;
}

function formatBoolean(value: boolean | null): string {
  if (value === null) {
    return "—";
  }
  return value ? "ON" : "OFF";
}

function transitionLabel(kind: string): string {
  switch (kind) {
    case "provider.start.requested":
      return "開始要求";
    case "provider.started":
      return "provider開始";
    case "provider.start.failed":
      return "開始失敗";
    case "provider.stop.requested":
      return "停止要求";
    case "provider.stopped":
      return "provider停止";
    case "provider.stop.failed":
      return "停止失敗";
    case "app.state.changed":
      return "アプリ状態";
    case "app.session.recovered":
      return "session復元";
    case "environment.session.started":
      return "端末状態・開始";
    case "environment.session.ended":
      return "端末状態・終了";
    case "environment.snapshot.failed":
      return "端末状態取得失敗";
    default:
      return kind;
  }
}

function shareText(
  reports: readonly ExplorationTrackingReportItem[],
): string {
  const sections = reports.map(
    ({ report }, index) =>
      `[exploration_${index + 1}]\n${formatTrackingDiagnosticsSummary(report)}`,
  );
  return [
    "Personal Exploration Map / field-test diagnostics",
    "privacy=no_coordinates_no_map_names_no_ids_no_marker_text_no_map_images",
    "contains=device_time_battery_permissions_and_aggregate_tracking_metrics",
    `exploration_count=${reports.length}`,
    ...sections,
  ].join("\n\n");
}

function DiagnosticValue({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}) {
  return (
    <View style={styles.valueRow}>
      <Text style={styles.valueLabel}>{label}</Text>
      <Text style={styles.valueText}>{value}</Text>
    </View>
  );
}

export function TrackingDiagnosticsPanel({
  reports,
}: TrackingDiagnosticsPanelProps) {
  const [sharing, setSharing] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);

  if (reports.length === 0) {
    return null;
  }

  async function handleShare(): Promise<void> {
    setSharing(true);
    setShareError(null);
    try {
      await Share.share({
        title: "受動記録の座標なし診断集計",
        message: shareText(reports),
      });
    } catch (error) {
      setShareError(
        error instanceof Error ? error.message : "共有画面を開けませんでした。",
      );
    } finally {
      setSharing(false);
    }
  }

  return (
    <View style={styles.section}>
      <Text style={styles.eyebrow}>FIELD-TEST DIAGNOSTICS</Text>
      <Text style={styles.title}>受動記録の計測</Text>
      <Text style={styles.description}>
        診断イベントは地図の正本ではありません。採否・距離・経路はraw位置情報から再計算しています。
      </Text>
      <AppButton
        loading={sharing}
        onPress={() => void handleShare()}
        variant="secondary"
        style={styles.shareButton}
      >
        座標なし集計を共有
      </AppButton>
      <Text style={styles.shareNote}>
        端末、Android、開始・終了時刻、電池、権限、省電力状態と集計値を含みます。緯度経度、ローカル座標、地図名、ID、marker文、地図画像は含みません。
      </Text>
      {shareError === null ? null : (
        <Text style={styles.shareError}>{shareError}</Text>
      )}

      {reports.map(({ explorationId, name, providerId, report }, index) => {
        const environment = report.environment.start ?? report.environment.end;
        return (
          <View key={explorationId} style={styles.card}>
            <View style={styles.headerRow}>
              <View style={styles.headerText}>
                <Text style={styles.cardTitle}>
                  探索{index + 1}: {name}
                </Text>
                <Text style={styles.cardMeta}>
                  {providerId} ・ {formatDateTime(report.startedAtMs)}
                </Text>
              </View>
              <Text style={styles.duration}>
                {formatDuration(report.durationMs)}
              </Text>
            </View>

            <View style={styles.group}>
              <Text style={styles.groupTitle}>端末・電池（自動）</Text>
              <DiagnosticValue
                label="端末 / Android"
                value={
                  environment === null
                    ? "—"
                    : `${environment.manufacturer ?? "?"} ${environment.model ?? "?"} / ${environment.androidVersion ?? "?"}`
                }
              />
              <DiagnosticValue
                label="開始 / 終了電池"
                value={`${formatBattery(report.environment.start?.batteryLevelPercent ?? null)} / ${formatBattery(report.environment.end?.batteryLevelPercent ?? null)}`}
              />
              <DiagnosticValue
                label="消費ポイント"
                value={formatNumber(
                  report.environment.batteryConsumedPercentagePoints,
                  "pt",
                )}
              />
              <DiagnosticValue
                label="省電力 開始 / 終了"
                value={`${formatBoolean(report.environment.start?.powerSaveMode ?? null)} / ${formatBoolean(report.environment.end?.powerSaveMode ?? null)}`}
              />
              <DiagnosticValue
                label="電池最適化"
                value={formatBoolean(
                  report.environment.start?.batteryOptimizationEnabled ?? null,
                )}
              />
              <DiagnosticValue
                label="background位置 / 通知"
                value={`${formatBoolean(report.environment.start?.backgroundLocationGranted ?? null)} / ${formatBoolean(report.environment.start?.notificationGranted ?? null)}`}
              />
            </View>

            <View style={styles.group}>
              <Text style={styles.groupTitle}>位置と採否</Text>
              <DiagnosticValue
                label="raw / 採用 / 除外"
                value={`${report.rawSampleCount} / ${report.acceptedSampleCount} / ${report.rejectedSampleCount}`}
              />
              <DiagnosticValue
                label="採用率"
                value={formatPercent(report.acceptanceRate)}
              />
              <DiagnosticValue
                label="水平精度 median / p95 / max"
                value={`${formatNumber(report.horizontalAccuracyMeters.median, "m")} / ${formatNumber(report.horizontalAccuracyMeters.p95, "m")} / ${formatNumber(report.horizontalAccuracyMeters.maximum, "m")}`}
              />
              {report.rejectionReasons.length === 0 ? null : (
                <Text style={styles.detailText}>
                  除外理由: {report.rejectionReasons
                    .map((item) => `${item.reason} ${item.count}`)
                    .join("、")}
                </Text>
              )}
            </View>

            <View style={styles.group}>
              <Text style={styles.groupTitle}>継続性</Text>
              <DiagnosticValue
                label="sample gap median / p95 / max"
                value={`${formatNumber(report.sampleGapsMs.median, "ms")} / ${formatNumber(report.sampleGapsMs.p95, "ms")} / ${formatNumber(report.sampleGapsMs.maximum, "ms")}`}
              />
              <DiagnosticValue
                label="30秒 / 60秒 / 120秒以上"
                value={`${report.sampleGapsMs.atLeast30Seconds} / ${report.sampleGapsMs.atLeast60Seconds} / ${report.sampleGapsMs.atLeast120Seconds}`}
              />
              <DiagnosticValue
                label="callback batches / failures"
                value={`${report.callbacks.receivedBatchCount} / ${report.callbacks.failedBatchCount}`}
              />
              <DiagnosticValue
                label="received / persisted / duplicate"
                value={`${report.callbacks.receivedSampleCount} / ${report.callbacks.persistedSampleCount} / ${report.callbacks.duplicateSampleCount}`}
              />
            </View>

            <View style={styles.group}>
              <Text style={styles.groupTitle}>中断コスト</Text>
              <DiagnosticValue
                label="発見入力 completed / cancelled"
                value={`${report.markerInputMs.completedCount} / ${report.markerInputMs.cancelledCount}`}
              />
              <DiagnosticValue
                label="入力時間 median / p95"
                value={`${formatNumber(report.markerInputMs.median, "ms")} / ${formatNumber(report.markerInputMs.p95, "ms")}`}
              />
            </View>

            {report.lastError === null ? null : (
              <View style={styles.errorBox}>
                <Text style={styles.errorTitle}>最終エラー</Text>
                <Text style={styles.errorText}>
                  {formatDateTime(report.lastError.occurredAtMs)} ・ {report.lastError.message}
                </Text>
              </View>
            )}

            {report.lifecycle.length === 0 ? null : (
              <View style={styles.timeline}>
                <Text style={styles.groupTitle}>状態遷移</Text>
                {report.lifecycle.slice(-10).map((transition, transitionIndex) => (
                  <Text
                    key={`${transition.occurredAtMs}-${transition.kind}-${transitionIndex}`}
                    style={styles.timelineText}
                  >
                    {formatDateTime(transition.occurredAtMs)} ・ {transitionLabel(transition.kind)}
                    {transition.detail === null ? "" : ` ・ ${transition.detail}`}
                  </Text>
                ))}
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginTop: spacing.xl,
  },
  eyebrow: {
    color: palette.warning,
    fontSize: 10,
    lineHeight: 15,
    fontWeight: "800",
    letterSpacing: 1.2,
  },
  title: {
    color: palette.ink,
    fontSize: 20,
    lineHeight: 26,
    fontWeight: "800",
    marginTop: spacing.xs,
  },
  description: {
    color: palette.mutedInk,
    fontSize: 12,
    lineHeight: 18,
    marginTop: spacing.xs,
    marginBottom: spacing.md,
  },
  shareButton: {
    marginBottom: spacing.sm,
  },
  shareNote: {
    color: palette.mutedInk,
    fontSize: 10,
    lineHeight: 16,
    marginBottom: spacing.md,
  },
  shareError: {
    color: palette.danger,
    fontSize: 11,
    lineHeight: 17,
    marginBottom: spacing.md,
  },
  card: {
    padding: spacing.md,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surface,
    marginBottom: spacing.md,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  headerText: {
    flex: 1,
  },
  cardTitle: {
    color: palette.ink,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "800",
  },
  cardMeta: {
    color: palette.mutedInk,
    fontSize: 10,
    lineHeight: 15,
    marginTop: 2,
  },
  duration: {
    color: palette.primary,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "800",
  },
  group: {
    marginTop: spacing.md,
  },
  groupTitle: {
    color: palette.primary,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "800",
    marginBottom: spacing.xs,
  },
  valueRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing.sm,
    paddingVertical: 2,
  },
  valueLabel: {
    flex: 1,
    color: palette.mutedInk,
    fontSize: 11,
    lineHeight: 17,
  },
  valueText: {
    color: palette.ink,
    fontSize: 11,
    lineHeight: 17,
    fontWeight: "700",
    textAlign: "right",
  },
  detailText: {
    color: palette.mutedInk,
    fontSize: 10,
    lineHeight: 16,
    marginTop: spacing.xs,
  },
  errorBox: {
    marginTop: spacing.md,
    padding: spacing.sm,
    borderRadius: 12,
    backgroundColor: "#F8DEDE",
  },
  errorTitle: {
    color: palette.danger,
    fontSize: 11,
    fontWeight: "800",
  },
  errorText: {
    color: palette.danger,
    fontSize: 10,
    lineHeight: 16,
    marginTop: 2,
  },
  timeline: {
    marginTop: spacing.md,
  },
  timelineText: {
    color: palette.mutedInk,
    fontSize: 10,
    lineHeight: 16,
  },
});
