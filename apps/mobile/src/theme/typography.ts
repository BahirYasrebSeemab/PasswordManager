import { Platform, TextStyle } from "react-native";
import { colors } from "./colors";

export const type = {
  largeTitle: { fontSize: 34, fontWeight: "700", color: colors.label } as TextStyle,
  title: { fontSize: 22, fontWeight: "600", color: colors.label } as TextStyle,
  headline: { fontSize: 17, fontWeight: "600", color: colors.label } as TextStyle,
  body: { fontSize: 17, fontWeight: "400", color: colors.label } as TextStyle,
  subhead: { fontSize: 15, fontWeight: "400", color: colors.secondaryLabel } as TextStyle,
  caption: { fontSize: 12, fontWeight: "400", color: colors.secondaryLabel } as TextStyle,
  mono: {
    fontSize: 13,
    fontWeight: "400",
    color: colors.secondaryLabel,
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }),
  } as TextStyle,
} as const;
