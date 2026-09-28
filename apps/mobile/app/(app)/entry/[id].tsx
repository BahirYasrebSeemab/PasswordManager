import { useLocalSearchParams, useRouter } from "expo-router";
import { Alert } from "react-native";
import { useVault } from "@/context/VaultContext";
import { EntryForm } from "@/components/entry-form";
import { Button } from "@/components/button";
import { KeyboardSafeForm } from "@/components/keyboard-safe-form";
import { Spotlight } from "@/components/spotlight";
import { ThemedText } from "@/components/themed-text";
import { spacing } from "@/theme";

export default function EntryDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { entries, updateEntry, deleteEntry } = useVault();
  const router = useRouter();
  const entry = entries.find((e) => e.id === id);

  if (!entry) {
    return (
      <Spotlight contentStyle={{ justifyContent: "center", padding: spacing.lg }}>
        <ThemedText variant="body">Entry not found.</ThemedText>
      </Spotlight>
    );
  }

  return (
    <KeyboardSafeForm>
      <ThemedText variant="largeTitle">{entry.content.title}</ThemedText>
      <EntryForm
        initialValue={entry.content}
        submitLabel="Save changes"
        onSubmit={async (content) => {
          await updateEntry(entry.id, content);
          router.back();
        }}
      />
      <Button
        title="Delete"
        variant="secondary"
        onPress={() => {
          Alert.alert("Delete entry?", "This can't be undone.", [
            { text: "Cancel", style: "cancel" },
            {
              text: "Delete",
              style: "destructive",
              onPress: async () => {
                await deleteEntry(entry.id);
                router.back();
              },
            },
          ]);
        }}
      />
    </KeyboardSafeForm>
  );
}
