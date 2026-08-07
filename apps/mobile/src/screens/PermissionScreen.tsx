import { ScrollView, StyleSheet, Text, View } from "react-native";

import { AppButton } from "../components/AppButton";
import { palette, spacing } from "../theme";

interface PermissionScreenProps {
  readonly loading: boolean;
  readonly targetMapName: string | null;
  readonly onStartBackground: () => void;
  readonly onStartForeground: () => void;
  readonly onBack: () => void;
}

export function PermissionScreen({
  loading,
  targetMapName,
  onStartBackground,
  onStartForeground,
  onBack,
}: PermissionScreenProps) {
  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.eyebrow}>探索を邪魔しないために</Text>
      <Text style={styles.title}>始めたら、スマホは{"\n"}しまって大丈夫です。</Text>
      <Text style={styles.intro}>
        画面を消しても移動を記録するには、利用中の位置情報に加えてバックグラウンド位置情報が必要です。
      </Text>

      {targetMapName === null ? null : (
        <View style={styles.targetCard}>
          <Text style={styles.targetLabel}>続きを追加する地図</Text>
          <Text numberOfLines={2} style={styles.targetName}>
            {targetMapName}
          </Text>
          <Text style={styles.targetBody}>
            今回の移動は、この個人地図へ新しい探索として追加されます。過去の探索とは別の経路として保持します。
          </Text>
        </View>
      )}

      <View style={styles.flowCard}>
        <View style={styles.flowStep}>
          <Text style={styles.flowNumber}>1</Text>
          <View style={styles.flowText}>
            <Text style={styles.flowTitle}>探索を始める</Text>
            <Text style={styles.flowBody}>この画面で許可して、記録を開始します。</Text>
          </View>
        </View>
        <View style={styles.flowLine} />
        <View style={styles.flowStep}>
          <Text style={styles.flowNumber}>2</Text>
          <View style={styles.flowText}>
            <Text style={styles.flowTitle}>スマホをポケットへ</Text>
            <Text style={styles.flowBody}>画面やカメラを見ながら歩く必要はありません。</Text>
          </View>
        </View>
        <View style={styles.flowLine} />
        <View style={styles.flowStep}>
          <Text style={styles.flowNumber}>3</Text>
          <View style={styles.flowText}>
            <Text style={styles.flowTitle}>必要な時だけ取り出す</Text>
            <Text style={styles.flowBody}>発見や分岐を短い操作で残せます。</Text>
          </View>
        </View>
      </View>

      <View style={styles.dataCard}>
        <Text style={styles.dataTitle}>位置情報の扱い</Text>
        <Text style={styles.dataBody}>
          現在のMVPは端末内のSQLiteに保存し、アカウントやクラウドへ送信しません。終了後も自分で地図を見返すために保持します。
        </Text>
      </View>

      <AppButton
        loading={loading}
        onPress={onStartBackground}
        style={styles.primaryAction}
      >
        ポケット記録を許可して開始
      </AppButton>
      <AppButton
        disabled={loading}
        onPress={onStartForeground}
        variant="secondary"
        style={styles.secondaryAction}
      >
        画面を開いたまま簡易記録
      </AppButton>
      <Text style={styles.foregroundNote}>
        簡易記録は、画面を消したり別のアプリを開くと止まる可能性があります。
      </Text>
      <AppButton disabled={loading} onPress={onBack} variant="ghost">
        戻る
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
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1,
  },
  title: {
    color: palette.ink,
    fontSize: 32,
    lineHeight: 41,
    fontWeight: "900",
    marginTop: spacing.sm,
  },
  intro: {
    color: palette.mutedInk,
    fontSize: 16,
    lineHeight: 25,
    marginTop: spacing.md,
  },
  targetCard: {
    marginTop: spacing.lg,
    padding: spacing.md,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.primarySoft,
  },
  targetLabel: {
    color: palette.primary,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  targetName: {
    color: palette.ink,
    fontSize: 18,
    lineHeight: 25,
    fontWeight: "900",
    marginTop: spacing.xs,
  },
  targetBody: {
    color: palette.mutedInk,
    fontSize: 13,
    lineHeight: 20,
    marginTop: spacing.xs,
  },
  flowCard: {
    marginTop: spacing.xl,
    padding: spacing.lg,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surface,
  },
  flowStep: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
  },
  flowNumber: {
    width: 30,
    height: 30,
    borderRadius: 15,
    textAlign: "center",
    textAlignVertical: "center",
    color: palette.white,
    backgroundColor: palette.primary,
    fontSize: 14,
    lineHeight: 30,
    fontWeight: "800",
  },
  flowText: {
    flex: 1,
    paddingTop: 2,
  },
  flowTitle: {
    color: palette.ink,
    fontSize: 15,
    fontWeight: "800",
  },
  flowBody: {
    color: palette.mutedInk,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 3,
  },
  flowLine: {
    width: 1,
    height: 24,
    backgroundColor: palette.border,
    marginLeft: 15,
    marginVertical: spacing.xs,
  },
  dataCard: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: 18,
    backgroundColor: palette.primarySoft,
  },
  dataTitle: {
    color: palette.primary,
    fontSize: 14,
    fontWeight: "800",
  },
  dataBody: {
    color: palette.mutedInk,
    fontSize: 13,
    lineHeight: 20,
    marginTop: spacing.xs,
  },
  primaryAction: {
    marginTop: spacing.xl,
  },
  secondaryAction: {
    marginTop: spacing.sm,
  },
  foregroundNote: {
    color: palette.mutedInk,
    fontSize: 11,
    lineHeight: 17,
    textAlign: "center",
    paddingHorizontal: spacing.md,
    marginTop: spacing.sm,
  },
});
