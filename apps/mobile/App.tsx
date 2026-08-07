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
import type {
  MarkerCategory,
  PersonalMapSnapshot,
} from "@exploration-map/mapping-core";
import type { PersonalMapListItem } from "@exploration-map/mapping-engine";

import {
  addConfirmedMarker,
  continuePersonalMapExploration,
  createDemoPersonalMap,
  endActiveExploration,
  getMobileTrackingStatus,
  listMobilePersonalMaps,
  loadMobilePersonalMap,
  startNewPersonalMapExploration,
  stopOrphanedMobileTracking,
  type StartedExploration,
} from "./src/mapping/mobileMappingRuntime";
import { HomeScreen } from "./src/screens/HomeScreen";
import { PermissionScreen } from "./src/screens/PermissionScreen";
import { RecordingScreen } from "./src/screens/RecordingScreen";
import { ReviewScreen } from "./src/screens/ReviewScreen";
import { getActiveTrackingContext } from "./src/storage/activeTrackingState";
import { initializeDatabase } from "./src/storage/database";
import {
  getActiveExploration,
  getExplorationSummary,
  getLiveExplorationStats,
  type ExplorationSummary,
  type LiveExplorationStats,
} from "./src/storage/explorationRepository";
import {
  getTrackingPermissionState,
  requestBackgroundTrackingPermission,
  requestForegroundTrackingPermission,
} from "./src/tracking/locationRecorder";
import type { MobileTrackingMode } from "./src/tracking/types";
import { palette, spacing } from "./src/theme";
import { defaultExplorationName } from "./src/utils/format";

type ExplorationTarget =
  | { readonly kind: "new" }
  | {
      readonly kind: "continue";
      readonly personalMapId: string;
      readonly mapName: string;
    };

type Screen =
  | { readonly kind: "home" }
  | { readonly kind: "permissions"; readonly target: ExplorationTarget }
  | ({ readonly kind: "recording" } & StartedExploration)
  | { readonly kind: "review"; readonly personalMapId: string };

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
  const [personalMaps, setPersonalMaps] = useState<
    readonly PersonalMapListItem[]
  >([]);
  const [activeExploration, setActiveExploration] =
    useState<ExplorationSummary | null>(null);
  const [liveStats, setLiveStats] =
    useState<LiveExplorationStats>(EMPTY_LIVE_STATS);
  const [runtimeRunning, setRuntimeRunning] = useState(false);
  const [reviewPersonalMap, setReviewPersonalMap] =
    useState<PersonalMapListItem | null>(null);
  const [reviewSnapshot, setReviewSnapshot] =
    useState<PersonalMapSnapshot | null>(null);

  const refreshHome = useCallback(async () => {
    const items = await listMobilePersonalMaps();
    setPersonalMaps(items);
  }, []);

  const refreshRecording = useCallback(async (explorationId: string) => {
    const [summary, stats, runtime] = await Promise.all([
      getExplorationSummary(explorationId),
      getLiveExplorationStats(explorationId),
      getMobileTrackingStatus(),
    ]);
    setActiveExploration(summary);
    setLiveStats(stats);
    setRuntimeRunning(
      runtime.running && runtime.explorationId === explorationId,
    );
  }, []);

  const openReview = useCallback(async (personalMapId: string) => {
    setBusy(true);
    setErrorMessage(null);
    try {
      const [snapshot, items] = await Promise.all([
        loadMobilePersonalMap(personalMapId),
        listMobilePersonalMaps(),
      ]);
      const personalMap = items.find((item) => item.id === personalMapId);
      if (snapshot === null || personalMap === undefined) {
        throw new Error("個人地図を読み込めませんでした。");
      }
      setPersonalMaps(items);
      setReviewPersonalMap(personalMap);
      setReviewSnapshot(snapshot);
      setScreen({ kind: "review", personalMapId });
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
        const [items, active, context] = await Promise.all([
          listMobilePersonalMaps(),
          getActiveExploration(),
          getActiveTrackingContext(),
        ]);

        if (active === null || context === null) {
          const runtime = await getMobileTrackingStatus();
          if (runtime.running || runtime.explorationId !== null) {
            await stopOrphanedMobileTracking();
          }
        }

        if (!mounted) {
          return;
        }
        setPersonalMaps(items);
        if (
          active !== null &&
          context !== null &&
          context.explorationId === active.id &&
          context.personalMapId === active.personalMapId
        ) {
          setActiveExploration(active);
          setScreen({ kind: "recording", ...context });
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

  async function beginExploration(mode: MobileTrackingMode) {
    if (screen.kind !== "permissions") {
      return;
    }
    const target = screen.target;
    setBusy(true);
    setErrorMessage(null);
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

      const explorationName = defaultExplorationName();
      const started =
        target.kind === "new"
          ? await startNewPersonalMapExploration(explorationName, mode)
          : await continuePersonalMapExploration(
              target.personalMapId,
              explorationName,
              mode,
            );
      await refreshRecording(started.explorationId);
      setScreen({ kind: "recording", ...started });
      await refreshHome();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleEndExploration(context: StartedExploration) {
    setBusy(true);
    setErrorMessage(null);
    try {
      await endActiveExploration(context);
      setRuntimeRunning(false);
      setActiveExploration(null);
      await Promise.all([
        refreshHome(),
        openReview(context.personalMapId),
      ]);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleAddMarker(
    context: StartedExploration,
    input: {
      readonly category: MarkerCategory;
      readonly label: string;
      readonly note?: string;
    },
  ) {
    await addConfirmedMarker(context, input);
    await refreshRecording(context.explorationId);
  }

  async function handleOpenPersonalMap(personalMapId: string) {
    setErrorMessage(null);
    try {
      const context = await getActiveTrackingContext();
      if (context?.personalMapId === personalMapId) {
        const summary = await getExplorationSummary(context.explorationId);
        if (summary === null) {
          throw new Error("記録中の探索を読み込めませんでした。");
        }
        setActiveExploration(summary);
        await refreshRecording(context.explorationId);
        setScreen({ kind: "recording", ...context });
        return;
      }
      await openReview(personalMapId);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleCreateDemo() {
    setBusy(true);
    try {
      const { personalMapId } = await createDemoPersonalMap();
      await refreshHome();
      await openReview(personalMapId);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function returnHome() {
    setReviewPersonalMap(null);
    setReviewSnapshot(null);
    await refreshHome();
    setScreen({ kind: "home" });
  }

  function continueReview() {
    if (reviewPersonalMap === null) {
      return;
    }
    setScreen({
      kind: "permissions",
      target: {
        kind: "continue",
        personalMapId: reviewPersonalMap.id,
        mapName: reviewPersonalMap.name,
      },
    });
  }

  function backFromPermissions() {
    if (
      screen.kind === "permissions" &&
      screen.target.kind === "continue" &&
      reviewPersonalMap !== null &&
      reviewSnapshot !== null
    ) {
      setScreen({
        kind: "review",
        personalMapId: screen.target.personalMapId,
      });
      return;
    }
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
          personalMaps={personalMaps}
          activePersonalMapId={activeExploration?.personalMapId ?? null}
          loading={busy}
          onCreateDemo={() => void handleCreateDemo()}
          onOpen={(id) => void handleOpenPersonalMap(id)}
          onStartNew={() =>
            setScreen({ kind: "permissions", target: { kind: "new" } })
          }
        />
      ) : null}

      {screen.kind === "permissions" ? (
        <PermissionScreen
          loading={busy}
          targetMapName={
            screen.target.kind === "continue" ? screen.target.mapName : null
          }
          onBack={backFromPermissions}
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
          onAddMarker={(input) => handleAddMarker(screen, input)}
          onEnd={() => void handleEndExploration(screen)}
        />
      ) : null}

      {screen.kind === "review" &&
      reviewPersonalMap !== null &&
      reviewSnapshot !== null ? (
        <ReviewScreen
          personalMap={reviewPersonalMap}
          snapshot={reviewSnapshot}
          onContinue={continueReview}
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
