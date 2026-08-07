import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { PersonalMapSnapshot } from "@exploration-map/mapping-core";

import { loadMobilePersonalMap } from "../mapping/mobileMappingRuntime";
import { palette, spacing } from "../theme";
import { TrackCanvas } from "./TrackCanvas";

const REFRESH_INTERVAL_MS = 8_000;

interface LiveMapPreviewProps {
  readonly personalMapId: string;
}

function formatRefreshTime(timestampMs: number | null): string {
  if (timestampMs === null) {
    return "更新待ち";
  }
  return new Date(timestampMs).toLocaleTimeString("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/**
 * Read-only PersonalMap preview for an intentionally opened recording screen.
 *
 * Passive-first does not mean map-invisible. The preview refreshes only while
 * the app is foregrounded, so screen-off pocket recording does not poll or
 * render merely to create a live-map effect.
 */
export function LiveMapPreview({ personalMapId }: LiveMapPreviewProps) {
  const [snapshot, setSnapshot] = useState<PersonalMapSnapshot | null>(null);
  const [lastUpdatedAtMs, setLastUpdatedAtMs] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const refreshInFlight = useRef(false);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    if (refreshInFlight.current || AppState.currentState !== "active") {
      return;
    }
    refreshInFlight.current = true;
    if (mounted.current) {
      setRefreshing(true);
    }
    try {
      const nextSnapshot = await loadMobilePersonalMap(personalMapId);
      if (!mounted.current) {
        return;
      }
      setSnapshot(nextSnapshot);
      setLastUpdatedAtMs(Date.now());
      setErrorMessage(null);
    } catch (error) {
      if (mounted.current) {
        setErrorMessage(error instanceof Error ? error.message : String(error));
      }
    } finally {
      refreshInFlight.current = false;
      if (mounted.current) {
        setRefreshing(false);
      }
    }
  }, [personalMapId]);

  useEffect(() => {
    mounted.current = true;
    void refresh();

    const timer = setInterval(() => {
      void refresh();
    }, REFRESH_INTERVAL_MS);
    const appStateSubscription = AppState.addEventListener(
      "change",
      (nextState) => {
        if (nextState === "active") {
          void refresh();
        }
      },
    );

    return () => {
      mounted.current = false;
      clearInterval(timer);
      appStateSubscription.remove();
    };
  }, [refresh]);

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>探索中の地図</Text>
          <Text style={styles.subtitle}>開いている間だけ約8秒ごとに更新</Text>
        </View>
        <View style={styles.refreshState}>
          {refreshing ? (
            <ActivityIndicator color={palette.primary} size="small" />
          ) : null}
          <Text style={styles.refreshText}>
            {formatRefreshTime(lastUpdatedAtMs)}
          </Text>
        </View>
      </View>

      {snapshot === null ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>位置が集まると地図が現れます</Text>
          <Text style={styles.emptyBody}>
            記録は裏側で続いています。少し移動してから、この画面を開き直してください。
          </Text>
        </View>
      ) : (
        <TrackCanvas snapshot={snapshot} height={230} />
      )}

      {errorMessage === null ? null : (
        <Text style={styles.errorText}>
          地図プレビューの更新に失敗しました。位置記録は継続しています。
        </Text>
      )}
      <Text style={styles.note}>
        画面を見続ける必要はありません。確認したい時だけ開くと、PersonalMapが育った状態を見られます。
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: spacing.lg,
    padding: spacing.md,
    borderRadius: 22,
    backgroundColor: palette.primarySoft,
    borderWidth: 1,
    borderColor: palette.border,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    marginBottom: spacing.sm,
  },
  title: {
    color: palette.primary,
    fontSize: 16,
    fontWeight: "800",
  },
  subtitle: {
    color: palette.mutedInk,
    fontSize: 11,
    marginTop: 2,
  },
  refreshState: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  refreshText: {
    color: palette.mutedInk,
    fontSize: 10,
  },
  emptyState: {
    minHeight: 180,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
    borderRadius: 18,
    backgroundColor: palette.surface,
  },
  emptyTitle: {
    color: palette.ink,
    fontSize: 15,
    fontWeight: "800",
    textAlign: "center",
  },
  emptyBody: {
    color: palette.mutedInk,
    fontSize: 12,
    lineHeight: 18,
    textAlign: "center",
    marginTop: spacing.xs,
  },
  errorText: {
    color: palette.danger,
    fontSize: 11,
    lineHeight: 17,
    marginTop: spacing.sm,
  },
  note: {
    color: palette.mutedInk,
    fontSize: 11,
    lineHeight: 17,
    textAlign: "center",
    marginTop: spacing.sm,
  },
});
