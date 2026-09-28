import { Ionicons } from "@expo/vector-icons";
import { useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Text,
  TextInput,
  TextInputProps,
  TouchableOpacity,
  View,
  ViewStyle,
} from "react-native";
import { spacing, useThemeColors } from "@/theme";

// Not part of the monochrome theme — this is the same functional red the
// rest of the app already uses for error states (e.g. login/register's
// error banners). Errors need to read as "wrong" at a glance, so this one
// color survives the "no more color" theme change on purpose.
const ERROR_COLOR = "#E5484D";

export interface InputProps extends Omit<TextInputProps, "style"> {
  label?: string;
  error?: string;
  password?: boolean;
  containerStyle?: ViewStyle;
  style?: TextInputProps["style"];
}

/**
 * Text field with a floating label: the label sits inside the field until
 * you focus it or type something, then it animates up and shrinks — the
 * usual iOS/Material "floating label" pattern.
 *
 * Border stays this app's existing look (a single bottom line, not a boxed
 * border) — only the animated label is new. The line just changes color: the
 * theme's separator gray at rest, full foreground color while focused, red
 * on an error.
 */
export function Input({
  label,
  error,
  password,
  value,
  containerStyle,
  style,
  onFocus,
  onBlur,
  ...props
}: InputProps) {
  const colors = useThemeColors();
  const [isFocused, setIsFocused] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const animatedLabel = useRef(new Animated.Value(value ? 1 : 0)).current;

  useEffect(() => {
    const animation = Animated.timing(animatedLabel, {
      toValue: isFocused || !!value ? 1 : 0,
      duration: 150,
      easing: Easing.ease,
      useNativeDriver: false,
    });
    animation.start();
    // Stop a still-running animation when the effect re-fires or the
    // component unmounts — otherwise its timer keeps ticking and tries to
    // update state after the screen (or a test) has moved on.
    return () => animation.stop();
  }, [isFocused, value, animatedLabel]);

  const borderColor = error ? ERROR_COLOR : isFocused ? colors.label : colors.separator;

  const labelStyle = {
    position: "absolute" as const,
    left: 0,
    top: animatedLabel.interpolate({ inputRange: [0, 1], outputRange: [10, -14] }),
    fontSize: animatedLabel.interpolate({ inputRange: [0, 1], outputRange: [17, 12] }),
    color: isFocused ? colors.label : colors.secondaryLabel,
  };

  return (
    <View style={[{ marginBottom: spacing.sm }, containerStyle]}>
      <View style={{ position: "relative" }}>
        {label ? (
          <Animated.Text style={labelStyle} pointerEvents="none">
            {label}
          </Animated.Text>
        ) : null}
        <TextInput
          value={value}
          secureTextEntry={password && !showPassword}
          onFocus={(event) => {
            setIsFocused(true);
            onFocus?.(event);
          }}
          onBlur={(event) => {
            setIsFocused(false);
            onBlur?.(event);
          }}
          placeholderTextColor={colors.secondaryLabel}
          style={[
            {
              color: colors.label,
              fontSize: 17,
              borderBottomWidth: 1,
              borderColor,
              paddingVertical: spacing.sm,
              paddingRight: password ? spacing.xl : 0,
            },
            style,
          ]}
          {...props}
        />
        {password ? (
          <TouchableOpacity
            onPress={() => setShowPassword((prev) => !prev)}
            style={{ position: "absolute", right: 0, top: spacing.sm }}
            accessibilityRole="button"
            accessibilityLabel={showPassword ? "Hide password" : "Show password"}
          >
            <Ionicons
              name={showPassword ? "eye-off-outline" : "eye-outline"}
              size={20}
              color={colors.secondaryLabel}
            />
          </TouchableOpacity>
        ) : null}
      </View>
      {error ? <Text style={{ color: ERROR_COLOR, fontSize: 12, marginTop: spacing.xs }}>{error}</Text> : null}
    </View>
  );
}
