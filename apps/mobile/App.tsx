import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { MapSnapshot, MarkerCategory } from "@exploration-map/mapping-core";

import { HomeScreen } from "./src/screens/HomeScreen";
import { PermissionScreen } from "./src/screens/PermissionScreen";
import { RecordingScreen } from "./src/screens/RecordingScreen";
import { ReviewScreen } from "./src/screens/ReviewScreen";
import { initializeDatabase } from "./src/storage/database";
import {
  addMarkerToExploration,
  completeExploration,
  createDemoExploration,
  createExploration,
  deleteExploration,
  getActiveExploration,
  getExplorationSummary,
  getLiveExplorationStats,
  listExplorations,
  loadExplorationMap,
  type ExplorationSummary,
  type LiveExplorationStats,
  type TrackingMode,
} from "./src/storage/explorationRepository";
import {
  getTrackingPermissionState,
  gnssTrackingProvider,
  requestBackgroundTrackingPermission,
  requestForegroundTrackingPermission,
} from "./src/tracking/locationRecorder";
import { palette, spacing } from "./src/theme";
import { defaultExplorationName } from "./src/utils/format";

type Screen =
  | { readonly kind: "home" }
  | { readonly kind: "permissions" }
  | { readonly kind: "recording"; readonly explorationId: string }
  | { readonly kind: "review"; readonly explorationId: string };

const EMPTY_LIVE_STATS: LiveExplorationStats = {
  rawSampleCount: 0,
  markerCount: 0,
  latestAccuracyMeters: null,
  latestRecordedAtMs: null,
};

export default function App() {
  const [screen, setScreen] = useState<Screen>({ kind: "home" });
  const [initialized, setInitialized] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [explorations, setExplorations] = useState<
    readonly ExplorationSummary[]
  >([]);
  const [activeExploration, setActiveExploration] =
    useState<ExplorationSummary | null>(null);
  const [liveStats, setLiveStats] =
    useState<LiveExplorationStats>(EMPTY_LIVE_STATS);
  const [runtimeRunning, setRuntimeRunning] = useState(false);
  const [reviewExploration, setReviewExploration] =
    useState<ExplorationSummary | null>(null);
  const [reviewSnapshot, setReviewSnapshot] = useState<MapSnapshot | null>(null);

  const refreshHome = useCallback(async () => {
    const items = await listExplorations();
    setExplorations(items);
  }, []);

  const refreshRecording = useCallback(async (explorationId: string) => {
    const [summary, stats, runtime] = await Promise.all([
      getExplorationSummary(explorationId),
      getLiveExplorationStats(explorationId),
      gnssTrackingProvider.status(),
    ]);
    setActiveExploration(summary);
    setLiveStats(stats);
    setRuntimeRunning(runtime.running);
  }, []);

  const openReview = useCallback(async (explorationId: string) => {
    setBusy(true);
    setErrorMessage(null);
    try {
      const [summary, snapshot] = await Promise.all([
        getExplorationSummary(explorationId),
        loadExplorationMap(explorationId),
      ]);
      if (summary === null || snapshot === null) {
        throw new Error("探索地図を読み込めませんでした。");
      }
      setReviewExploration(summary);
      setReviewSnapshot(snapshot);
      setScreen({ kind: "review", explorationId });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        await initializeDatabase();
        const [items, active] = await Promise.all([
          listExplorations(),
          getActiveExploration(),
        ]);

        if (active === null) {
          const runtime = await gnssTrackingProvider.status();
          if (runtime.running) {
            await gnssTrackingProvider.stop();
          }
        }

        if (!mounted) {
          return;
        }
        setExplorations(items);
        if (active !== null) {
          setActiveExploration(active);
          setScreen({ kind: "recording", explorationId: active.id });
          await refreshRecording(active.id);
        }
      } catch (error) {
        if (mounted) {
          setErrorMessage(error instanceof Error ? error.message : String(error));
        }
      } finally {
        if (mounted) {
          setInitialized(true);
        }
      }
    })();
    return () => {
      mounted = false;
    };
  }, [refreshRecording]);

  useEffect(() => {
    if (screen.kind !== "recording") {
      return;
    }
    const explorationId = screen.explorationId;
    const timer = setInterval(() => {
      void refreshRecording(explorationId).catch((error: unknown) => {
        setErrorMessage(error instanceof Error ? error.message : String(error));
      });
    }, 2_500);
    return () => clearInterval(timer);
  }, [refreshRecording, screen]);

  async function ensureForegroundPermission(): Promise<boolean> {
    const current = await getTrackingPermissionState();
    if (current.foregroundGranted) {
      return true;
    }
    const granted = await requestForegroundTrackingPermission();
    if (!granted) {
      Alert.alert(
        "位置情報が必要です",
        "探索経路を記録するため、位置情報の利用を許可してください。",
        [
          { text: "キャンセル", style: "cancel" },
          { text: "設定を開く", onPress: () => void Linking.openSettings() },
        ],
      );
    }
    return granted;
  }

  async function beginExploration(mode: Exclude<TrackingMode, "demo">) {
    setBusy(true);
    setErrorMessage(null);
    let createdId: string | null = null;
    try {
      const foregroundGranted = await ensureForegroundPermission();
      if (!foregroundGranted) {
        return;
      }

      if (mode === "background") {
        const current = await getTrackingPermissionState();
        const backgroundGranted =
          current.backgroundGranted ||
          (await requestBackgroundTrackingPermission());
        if (!backgroundGranted) {
          Alert.alert(
            "バックグラウンド位置情報が未許可です",
            "スマホをしまって記録するには、設定で位置情報を「常に許可」にしてください。簡易記録はこの画面から選べます。",
            [
              { text: "閉じる", style: "cancel" },
              {
                text: "設定を開く",
                onPress: () => void Linking.openSettings(),
              },
            ],
          );
          return;
        }
      }

      createdId = await createExploration(defaultExplorationName(), mode);
      await gnssTrackingProvider.start(mode);
      await refreshRecording(createdId);
      setScreen({ kind: "recording", explorationId: createdId });
      await refreshHome();
    } catch (error) {
      if (createdId !== null) {
        await deleteExploration(createdId).catch(() => undefined);
      }
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleEndExploration(explorationId: string) {
    setBusy(true);
    setErrorMessage(null);
    try {
      await gnssTrackingProvider.stop();
    } catch (error) {
      setErrorMessage(
        `位置記録の停止確認に失敗しました: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    try {
      await completeExploration(explorationId);
      setRuntimeRunning(false);
      await Promise.all([refreshHome(), openReview(explorationId)]);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleAddMarker(
    explorationId: string,
    input: {
      readonly category: MarkerCategory;
      readonly label: string;
      readonly note?: string;
    },
  ) {
    await addMarkerToExploration(explorationId, input);
    await refreshRecording(explorationId);
  }

  async function handleOpenExploration(explorationId: string) {
    const summary = await getExplorationSummary(explorationId);
    if (summary?.status === "recording") {
      setActiveExploration(summary);
      await refreshRecording(explorationId);
      setScreen({ kind: "recording", explorationId });
      return;
    }
    await openReview(explorationId);
  }

  async function handleCreateDemo() {
    setBusy(true);
    try {
      const id = await createDemoExploration();
      await refreshHome();
      await openReview(id);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function returnHome() {
    setReviewExploration(null);
    setReviewSnapshot(null);
    await refreshHome();
    setScreen({ kind: "home" });
  }

  if (!initialized) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar barStyle="dark-content" backgroundColor={palette.background} />
        <View style={styles.loadingScreen}>
          <ActivityIndicator color={palette.primary} size="large" />
          <Text style={styles.loadingText}>自分の地図を準備しています</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" backgroundColor={palette.background} />
      {errorMessage === null ? null : (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{errorMessage}</Text>
          <Text style={styles.errorDismiss} onPress={() => setErrorMessage(null)}>
            閉じる
          </Text>
        </View>
      )}

      {screen.kind === "home" ? (
        <HomeScreen
          explorations={explorations}
          loading={busy}
          onCreateDemo={() => void handleCreateDemo()}
          onOpen={(id) => void handleOpenExploration(id)}
          onStart={() => setScreen({ kind: "permissions" })}
        />
      ) : null}

      {screen.kind === "permissions" ? (
        <PermissionScreen
          loading={busy}
          onBack={() => setScreen({ kind: "home" })}
          onStartBackground={() => void beginExploration("background")}
          onStartForeground={() => void beginExploration("foreground")}
        />
      ) : null}

      {screen.kind === "recording" && activeExploration !== null ? (
        <RecordingScreen
          exploration={activeExploration}
          liveStats={liveStats}
          runtimeRunning={runtimeRunning}
          stopping={busy}
          onAddMarker={(input) =>
            handleAddMarker(activeExploration.id, input)
          }
          onEnd={() => void handleEndExploration(activeExploration.id)}
        />
      ) : null}

      {screen.kind === "review" &&
      reviewExploration !== null &&
      reviewSnapshot !== null ? (
        <ReviewScreen
          exploration={reviewExploration}
          snapshot={reviewSnapshot}
          onHome={() => void returnHome()}
        />
      ) : null}

      {busy && screen.kind === "review" && reviewSnapshot === null ? (
        <View style={styles.loadingScreen}>
          <ActivityIndicator color={palette.primary} size="large" />
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: palette.background,
  },
  loadingScreen: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
  },
  loadingText: {
    color: palette.mutedInk,
    fontSize: 14,
  },
  errorBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: "#F8DEDE",
    borderBottomWidth: 1,
    borderBottomColor: "#E9BDBD",
  },
  errorText: {
    flex: 1,
    color: palette.danger,
    fontSize: 12,
    lineHeight: 18,
  },
  errorDismiss: {
    color: palette.danger,
    fontSize: 12,
    fontWeight: "800",
  },
});
