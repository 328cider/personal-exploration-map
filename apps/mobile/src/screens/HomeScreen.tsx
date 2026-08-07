import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { PersonalMapListItem } from "@exploration-map/mapping-engine";

import { AppButton } from "../components/AppButton";
import { palette, spacing } from "../theme";
import { formatDateTime } from "../utils/format";

interface HomeScreenProps {
  readonly personalMaps: readonly PersonalMapListItem[];
  readonly activePersonalMapId: string | null;
  readonly loading: boolean;
  readonly onStartNew: () => void;
  readonly onOpen: (personalMapId: string) => void;
  readonly onCreateDemo: () => void;
}

export function HomeScreen({
  personalMaps,
  activePersonalMapId,
  loading,
  onStartNew,
  onOpen,
  onCreateDemo,
}: HomeScreenProps) {
  return (
    <ScrollView
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.hero}>
        <Text style={styles.eyebrow}>PERSONAL EXPLORATION MAP</Text>
        <Text style={styles.title}>歩いたぶんだけ、{"\n"}自分の地図になる。</Text>
        <Text style={styles.description}>
          探索を始めたらスマホはポケットへ。必要な時だけ発見を残し、同じ地図へ少しずつ知った空間を足していきます。
        </Text>
        <AppButton
          loading={loading}
          onPress={onStartNew}
          style={styles.startButton}
        >
          新しい地図を探索する
        </AppButton>
        <View style={styles.privacyNote}>
          <Text style={styles.privacyIcon}>◎</Text>
          <Text style={styles.privacyText}>
            MVPでは位置履歴を端末内だけに保存します。カメラは使いません。
          </Text>
        </View>
      </View>

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>自分の地図</Text>
        <Text style={styles.sectionMeta}>{personalMaps.length}件</Text>
      </View>

      {personalMaps.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyGlyph}>⌁</Text>
          <Text style={styles.emptyTitle}>まだ地図はありません</Text>
          <Text style={styles.emptyBody}>
            最初の探索を記録するか、デモで白紙地図の見え方を確認できます。
          </Text>
          {__DEV__ ? (
            <AppButton onPress={onCreateDemo} variant="secondary">
              デモ地図を見る
            </AppButton>
          ) : null}
        </View>
      ) : (
        <View style={styles.list}>
          {personalMaps.map((personalMap) => {
            const recording = personalMap.id === activePersonalMapId;
            return (
              <Pressable
                key={personalMap.id}
                accessibilityRole="button"
                onPress={() => onOpen(personalMap.id)}
                style={({ pressed }: { pressed: boolean }) => [
                  styles.card,
                  pressed && styles.cardPressed,
                ]}
              >
                <View style={styles.cardMapPreview}>
                  <View style={styles.previewLineOne} />
                  <View style={styles.previewLineTwo} />
                  <View style={styles.previewDot} />
                </View>
                <View style={styles.cardBody}>
                  <View style={styles.cardTitleRow}>
                    <Text numberOfLines={1} style={styles.cardTitle}>
                      {personalMap.name}
                    </Text>
                    {recording ? (
                      <View style={styles.recordingBadge}>
                        <Text style={styles.recordingBadgeText}>記録中</Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={styles.cardMeta}>
                    {formatDateTime(personalMap.updatedAtMs)} ・ 探索
                    {personalMap.explorationCount}回
                  </Text>
                  <Text style={styles.cardHint}>
                    {recording ? "タップして記録画面へ" : "タップして地図を見る"}
                  </Text>
                </View>
                <Text style={styles.chevron}>›</Text>
              </Pressable>
            );
          })}
          {__DEV__ ? (
            <AppButton onPress={onCreateDemo} variant="ghost">
              デモ地図を追加
            </AppButton>
          ) : null}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xxl,
  },
  hero: {
    paddingTop: spacing.md,
  },
  eyebrow: {
    color: palette.primary,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "800",
    letterSpacing: 1.4,
  },
  title: {
    color: palette.ink,
    fontSize: 37,
    lineHeight: 46,
    fontWeight: "900",
    letterSpacing: -1,
    marginTop: spacing.sm,
  },
  description: {
    color: palette.mutedInk,
    fontSize: 16,
    lineHeight: 26,
    marginTop: spacing.md,
  },
  startButton: {
    marginTop: spacing.xl,
  },
  privacyNote: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    marginTop: spacing.md,
    paddingHorizontal: spacing.sm,
  },
  privacyIcon: {
    color: palette.primary,
    fontSize: 15,
    fontWeight: "800",
  },
  privacyText: {
    flex: 1,
    color: palette.mutedInk,
    fontSize: 12,
    lineHeight: 18,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    marginTop: spacing.xxl,
    marginBottom: spacing.md,
  },
  sectionTitle: {
    color: palette.ink,
    fontSize: 22,
    lineHeight: 28,
    fontWeight: "800",
  },
  sectionMeta: {
    color: palette.mutedInk,
    fontSize: 13,
  },
  emptyCard: {
    padding: spacing.xl,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surface,
    alignItems: "center",
  },
  emptyGlyph: {
    color: palette.primary,
    fontSize: 42,
    lineHeight: 48,
    fontWeight: "700",
  },
  emptyTitle: {
    color: palette.ink,
    fontSize: 18,
    fontWeight: "800",
    marginTop: spacing.sm,
  },
  emptyBody: {
    color: palette.mutedInk,
    fontSize: 14,
    lineHeight: 21,
    textAlign: "center",
    marginTop: spacing.sm,
    marginBottom: spacing.lg,
  },
  list: {
    gap: spacing.sm,
  },
  card: {
    minHeight: 104,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surface,
    flexDirection: "row",
    alignItems: "center",
    padding: spacing.sm,
  },
  cardPressed: {
    opacity: 0.72,
  },
  cardMapPreview: {
    width: 78,
    height: 78,
    borderRadius: 15,
    backgroundColor: palette.primarySoft,
    overflow: "hidden",
  },
  previewLineOne: {
    position: "absolute",
    width: 48,
    height: 3,
    borderRadius: 2,
    backgroundColor: palette.primary,
    left: 8,
    top: 38,
    transform: [{ rotateZ: "20deg" }],
  },
  previewLineTwo: {
    position: "absolute",
    width: 33,
    height: 3,
    borderRadius: 2,
    backgroundColor: palette.primary,
    left: 39,
    top: 28,
    transform: [{ rotateZ: "-55deg" }],
  },
  previewDot: {
    position: "absolute",
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: palette.marker,
    left: 56,
    top: 21,
  },
  cardBody: {
    flex: 1,
    paddingHorizontal: spacing.md,
  },
  cardTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  cardTitle: {
    flexShrink: 1,
    color: palette.ink,
    fontSize: 16,
    lineHeight: 21,
    fontWeight: "700",
  },
  cardMeta: {
    color: palette.mutedInk,
    fontSize: 12,
    lineHeight: 18,
    marginTop: spacing.xs,
  },
  cardHint: {
    color: palette.primary,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "700",
    marginTop: 2,
  },
  recordingBadge: {
    borderRadius: 999,
    backgroundColor: palette.warningSoft,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  recordingBadgeText: {
    color: palette.warning,
    fontSize: 10,
    fontWeight: "800",
  },
  chevron: {
    color: palette.mutedInk,
    fontSize: 30,
    lineHeight: 34,
    paddingRight: spacing.sm,
  },
});
