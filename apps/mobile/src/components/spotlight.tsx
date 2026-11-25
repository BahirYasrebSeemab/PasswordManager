import { LinearGradient } from "expo-linear-gradient";
import { StyleSheet, useColorScheme, View, ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useThemeColors } from "@/theme";

interface SpotlightProps {
  style?: ViewStyle;
  contentStyle?: ViewStyle;
  intensity?: number; // 0-1, how strong the glow is
  children: React.ReactNode;
}

/**
 * Full-page background: a soft glow falling from the top center over the
 * theme's own black-or-white background — the "spotlight" look, used behind
 * every screen in the app.
 *
 * It's grayscale only, no hue: in dark mode the glow is white (light landing
 * on black), and in light mode it's the same effect inverted — the page
 * starts at pure white and a soft gray glow settles in from the top — so the
 * same component works for both themes without any color, just the two ends
 * of the light/dark scheme swapped.
 */
export function Spotlight({ children, intensity = 0.3, style, contentStyle }: SpotlightProps) {
  const scheme = useColorScheme();
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const glow = scheme === "light" ? "0, 0, 0" : "255, 255, 255";

  return (
    <View style={[{ flex: 1, backgroundColor: colors.systemBackground }, style]}>
      {/* paddingTop goes on the CONTENT, not this outer view, so the
          background/gradient still bleeds fully edge-to-edge behind the
          notch/status bar — only the title/text/buttons get pushed clear
          of it. */}
      <View style={[{ flex: 1, paddingTop: insets.top }, contentStyle]}>{children}</View>
      <LinearGradient
        colors={[
          `rgba(${glow}, ${intensity})`,
          `rgba(${glow}, ${intensity * 0.6})`,
          `rgba(${glow}, ${intensity * 0.3})`,
          "rgba(0, 0, 0, 0)",
        ]}
        locations={[0, 0.15, 0.4, 1]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
    </View>
  );
}
