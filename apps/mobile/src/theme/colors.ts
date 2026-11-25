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
  // Primary buttons always carry white text/spinner — a deliberate,
  // scheme-independent choice, not a bug: an earlier version inverted the
  // whole button (white pill + black text in dark mode), which on-device
  // read as invisible against the dark page. Only the FILL changes between
  // themes, so the button still visibly separates from its own page:
  // a lighter-than-black "elevated surface" gray in dark mode, solid black
  // in light mode (classic high-contrast call-to-action look either way).
  const scheme = useColorScheme();
  const isDark = scheme !== "light";
  return {
    primaryFill: isDark ? "#2C2C2E" : "#000000",
    primaryText: "#FFFFFF",
  };
}

// Static-safe default (dark), for module-scope code that can't call a hook.
// Components/screens should prefer useThemeColors() so they follow the
// device's light/dark setting; this export exists only where that isn't
// possible (see theme/typography.ts's structural-only tokens).
export const colors = palette.dark;
