import { ActivityIndicator, Pressable, StyleProp, ViewStyle } from "react-native";
import { radius, spacing, useBrandColors, useThemeColors } from "@/theme";
import { ThemedText } from "./themed-text";

const sizes = {
  sm: { paddingVertical: spacing.xs, paddingHorizontal: spacing.sm },
  md: { paddingVertical: spacing.sm, paddingHorizontal: spacing.md },
} as const;

export function Button({
  variant = "primary",
  size = "md",
  title,
  loading,
  disabled,
  style,
  onPress,
}: {
  variant?: "primary" | "secondary";
  size?: keyof typeof sizes;
  title: string;
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
}) {
  const brand = useBrandColors();
  const colors = useThemeColors();
  const variants = {
    primary: { backgroundColor: brand.primaryFill, textColor: brand.primaryText },
    secondary: { backgroundColor: "transparent", textColor: colors.label },
  } as const;
  const isDisabled = disabled || loading;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled }}
      disabled={isDisabled}
      onPress={onPress}
      style={({ pressed }) => [
        {
          backgroundColor: variants[variant].backgroundColor,
          borderRadius: radius.md,
          borderCurve: "continuous",
          alignItems: "center",
          justifyContent: "center",
          opacity: disabled ? 0.4 : pressed ? 0.7 : 1,
          ...sizes[size],
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variants[variant].textColor} />
      ) : (
        <ThemedText variant="headline" style={{ color: variants[variant].textColor }}>
          {title}
        </ThemedText>
      )}
    </Pressable>
  );
}
