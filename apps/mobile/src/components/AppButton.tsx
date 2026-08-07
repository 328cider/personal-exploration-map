import type { ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  type ViewStyle,
} from "react-native";

import { palette, spacing } from "../theme";

interface AppButtonProps {
  readonly children: ReactNode;
  readonly onPress: () => void;
  readonly variant?: "primary" | "secondary" | "danger" | "ghost";
  readonly disabled?: boolean;
  readonly loading?: boolean;
  readonly style?: ViewStyle;
}

export function AppButton({
  children,
  onPress,
  variant = "primary",
  disabled = false,
  loading = false,
  style,
}: AppButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }: { pressed: boolean }) => [
        styles.base,
        styles[variant],
        pressed && !disabled && !loading && styles.pressed,
        (disabled || loading) && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator
          color={variant === "primary" ? palette.white : palette.primary}
        />
      ) : (
        <Text
          style={[
            styles.label,
            variant === "primary" || variant === "danger"
              ? styles.lightLabel
              : styles.darkLabel,
          ]}
        >
          {children}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 54,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderWidth: 1,
  },
  primary: {
    backgroundColor: palette.primary,
    borderColor: palette.primary,
  },
  secondary: {
    backgroundColor: palette.surface,
    borderColor: palette.primary,
  },
  danger: {
    backgroundColor: palette.danger,
    borderColor: palette.danger,
  },
  ghost: {
    backgroundColor: "transparent",
    borderColor: "transparent",
  },
  pressed: {
    opacity: 0.78,
  },
  disabled: {
    opacity: 0.48,
  },
  label: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "700",
    textAlign: "center",
  },
  lightLabel: {
    color: palette.white,
  },
  darkLabel: {
    color: palette.primary,
  },
});
