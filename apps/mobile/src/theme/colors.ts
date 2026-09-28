import { useColorScheme } from "react-native";

// Pure grayscale only — no hue anywhere, by design (see the monochrome
// "spotlight" theme). Every value here is R=G=B so there's no warm/cool
// tint hiding in what looks like a neutral gray.
const palette = {
  dark: {
    label: "#FFFFFF",
    secondaryLabel: "#999999",
    separator: "#333333",
    systemBackground: "#000000",
  },
  light: {
    label: "#000000",
    secondaryLabel: "#666666",
    separator: "#DDDDDD",
    systemBackground: "#FFFFFF",
  },
} as const;

export interface ThemeColors {
  label: string;
  secondaryLabel: string;
  separator: string;
  systemBackground: string;
}

export function useThemeColors(): ThemeColors {
  const scheme = useColorScheme();
  return palette[scheme === "light" ? "light" : "dark"];
}

export function useBrandColors() {
  // Monochrome theme: there's no accent hue to speak of, so "brand" colors
  // are just the theme's own foreground/background pair, inverted — e.g. a
  // solid white pill with black text in dark mode, a solid black pill with
  // white text in light mode.
  const colors = useThemeColors();
  return { accent: colors.label, accentContrast: colors.systemBackground };
}

// Static-safe default (dark), for module-scope code that can't call a hook.
// Components/screens should prefer useThemeColors() so they follow the
// device's light/dark setting; this export exists only where that isn't
// possible (see theme/typography.ts's structural-only tokens).
export const colors = palette.dark;
