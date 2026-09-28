import { Text, TextProps } from "react-native";
import { type, typeColorRole, useThemeColors } from "@/theme";

export function ThemedText({
  variant = "body",
  style,
  ...props
}: TextProps & { variant?: keyof typeof type }) {
  const colors = useThemeColors();
  const color = colors[typeColorRole[variant]];
  return <Text style={[type[variant], { color }, style]} {...props} />;
}
