import { Platform, TextStyle } from "react-native";

// Structural styles only (size/weight/font) — deliberately no `color` here.
// Color depends on the active light/dark theme, which only a component can
// read (via useThemeColors()), not this module-scope table. ThemedText pairs
// each variant with a color role from typeColorRole below.
export const type = {
  largeTitle: { fontSize: 34, fontWeight: "700" } as TextStyle,
  title: { fontSize: 22, fontWeight: "600" } as TextStyle,
  headline: { fontSize: 17, fontWeight: "600" } as TextStyle,
  body: { fontSize: 17, fontWeight: "400" } as TextStyle,
  subhead: { fontSize: 15, fontWeight: "400" } as TextStyle,
  caption: { fontSize: 12, fontWeight: "400" } as TextStyle,
  mono: {
    fontSize: 13,
    fontWeight: "400",
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }),
  } as TextStyle,
} as const;

export const typeColorRole: Record<keyof typeof type, "label" | "secondaryLabel"> = {
  largeTitle: "label",
  title: "label",
  headline: "label",
  body: "label",
  subhead: "secondaryLabel",
  caption: "secondaryLabel",
  mono: "secondaryLabel",
};
