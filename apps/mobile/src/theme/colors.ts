import { Platform, useColorScheme } from "react-native";

const palette = {
  dark: {
    label: "#FFFFFF",
    secondaryLabel: "#A0A0A8",
    separator: "#2C2C30",
    systemBackground: "#0B0B0E",
  },
  light: {
    label: "#1A1612",
    secondaryLabel: "#6B6560",
    separator: "#E8E2D8",
    systemBackground: "#FAF6EE",
  },
} as const;

export function useThemeColors() {
  const scheme = useColorScheme();
  return palette[scheme === "light" ? "light" : "dark"];
}

const brandPalette = {
  light: { accent: "#8A5A1E", accentContrast: "#FFFFFF" },
  dark: { accent: "#C9974C", accentContrast: "#1A1206" },
} as const;

export function useBrandColors() {
  // Deliberately NOT scheme-aware: the static `colors` export above and
  // typography.ts are both hardcoded to the dark palette (this app doesn't
  // have a light theme yet), so switching just the accent pair here on
  // light-mode devices produced a real contrast bug (light accent color
  // rendered against the app's always-dark background). Always return the
  // dark brand colors until the rest of the app supports light mode too.
  return brandPalette.dark;
}

// Static-safe default (dark), for token files that need a color at module
// scope rather than inside a component — see theme/typography.ts.
export const colors = palette.dark;
