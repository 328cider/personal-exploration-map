import { useEffect, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { MarkerCategory } from "@exploration-map/mapping-core";

import { palette, spacing } from "../theme";
import { AppButton } from "./AppButton";

interface CategoryOption {
  readonly category: MarkerCategory;
  readonly glyph: string;
  readonly label: string;
}

const OPTIONS: readonly CategoryOption[] = [
  { category: "interesting", glyph: "★", label: "気になる" },
  { category: "entrance", glyph: "↪", label: "入口・出口" },
  { category: "junction", glyph: "⑂", label: "分岐・接続" },
  { category: "stairs", glyph: "↕", label: "階段・高低差" },
  { category: "hazard", glyph: "!", label: "危険" },
  { category: "blocked", glyph: "×", label: "通れない" },
  { category: "note", glyph: "•", label: "メモ" },
];

interface MarkerModalProps {
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly onSave: (input: {
    readonly category: MarkerCategory;
    readonly label: string;
    readonly note?: string;
  }) => Promise<void>;
}

export function MarkerModal({ visible, onClose, onSave }: MarkerModalProps) {
  const [selected, setSelected] = useState<CategoryOption>(OPTIONS[0]!);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible) {
      setSelected(OPTIONS[0]!);
      setNote("");
      setSaving(false);
    }
  }, [visible]);

  async function handleSave() {
    setSaving(true);
    try {
      await onSave({
        category: selected.category,
        label: selected.label,
        ...(note.trim().length === 0 ? {} : { note: note.trim() }),
      });
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      animationType="slide"
      transparent
      visible={visible}
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.handle} />
        <Text style={styles.title}>発見を記録</Text>
        <Text style={styles.description}>
          今いる場所に短い意味だけを残します。写真は不要です。
        </Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.options}
        >
          {OPTIONS.map((option) => {
            const active = option.category === selected.category;
            return (
              <Pressable
                key={option.category}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                onPress={() => setSelected(option)}
                style={[styles.option, active && styles.optionActive]}
              >
                <Text style={styles.optionGlyph}>{option.glyph}</Text>
                <Text
                  style={[
                    styles.optionLabel,
                    active && styles.optionLabelActive,
                  ]}
                >
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
        <TextInput
          accessibilityLabel="任意のメモ"
          multiline
          maxLength={240}
          onChangeText={setNote}
          placeholder="メモは任意です"
          placeholderTextColor={palette.mutedInk}
          style={styles.input}
          value={note}
        />
        <View style={styles.actions}>
          <AppButton onPress={onClose} variant="ghost" style={styles.actionButton}>
            キャンセル
          </AppButton>
          <AppButton
            loading={saving}
            onPress={() => void handleSave()}
            style={styles.actionButton}
          >
            この場所に保存
          </AppButton>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: "rgba(23, 32, 29, 0.38)",
  },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
    backgroundColor: palette.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
  },
  handle: {
    alignSelf: "center",
    width: 44,
    height: 5,
    borderRadius: 3,
    backgroundColor: palette.border,
    marginBottom: spacing.lg,
  },
  title: {
    color: palette.ink,
    fontSize: 24,
    lineHeight: 30,
    fontWeight: "800",
  },
  description: {
    color: palette.mutedInk,
    fontSize: 14,
    lineHeight: 21,
    marginTop: spacing.xs,
  },
  options: {
    gap: spacing.sm,
    paddingVertical: spacing.lg,
  },
  option: {
    width: 92,
    minHeight: 86,
    padding: spacing.sm,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: palette.border,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.background,
  },
  optionActive: {
    borderColor: palette.primary,
    backgroundColor: palette.primarySoft,
  },
  optionGlyph: {
    color: palette.primary,
    fontSize: 24,
    fontWeight: "800",
    marginBottom: spacing.xs,
  },
  optionLabel: {
    color: palette.mutedInk,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "600",
    textAlign: "center",
  },
  optionLabelActive: {
    color: palette.primary,
  },
  input: {
    minHeight: 92,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.background,
    color: palette.ink,
    fontSize: 15,
    lineHeight: 22,
    padding: spacing.md,
    textAlignVertical: "top",
  },
  actions: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  actionButton: {
    flex: 1,
  },
});
