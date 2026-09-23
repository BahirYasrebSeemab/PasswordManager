import { KeyboardAvoidingView, Platform, ScrollView, StyleProp, ViewStyle } from "react-native";
import { colors, spacing } from "@/theme";

// Every screen with a TextInput needs this: without it, opening the keyboard
// pushes content below the visible area on iOS (which never resizes the
// window itself) with no way to scroll back to it — e.g. a submit button
// sitting right after the last field becomes unreachable while typing.
export function KeyboardSafeForm({
  children,
  contentStyle,
}: {
  children: React.ReactNode;
  contentStyle?: StyleProp<ViewStyle>;
}) {
  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.systemBackground }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        testID="keyboard-safe-scroll"
        contentContainerStyle={[{ flexGrow: 1, padding: spacing.lg, gap: spacing.md }, contentStyle]}
        keyboardShouldPersistTaps="handled"
      >
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
