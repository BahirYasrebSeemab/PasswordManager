import { useRouter } from "expo-router";
import { View } from "react-native";
import { useVault } from "@/context/VaultContext";
import { EntryForm } from "@/components/entry-form";
import { ThemedText } from "@/components/themed-text";
import { colors, spacing } from "@/theme";

export default function NewEntryScreen() {
  const { createEntry } = useVault();
  const router = useRouter();

  return (
    <View style={{ flex: 1, backgroundColor: colors.systemBackground, padding: spacing.lg, gap: spacing.md }}>
      <ThemedText variant="largeTitle">New entry</ThemedText>
      <EntryForm
        submitLabel="Save"
        onSubmit={async (content) => {
          await createEntry(content);
          router.back();
        }}
      />
    </View>
  );
}
