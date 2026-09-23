import { useRouter } from "expo-router";
import { useVault } from "@/context/VaultContext";
import { EntryForm } from "@/components/entry-form";
import { KeyboardSafeForm } from "@/components/keyboard-safe-form";
import { ThemedText } from "@/components/themed-text";

export default function NewEntryScreen() {
  const { createEntry } = useVault();
  const router = useRouter();

  return (
    <KeyboardSafeForm>
      <ThemedText variant="largeTitle">New entry</ThemedText>
      <EntryForm
        submitLabel="Save"
        onSubmit={async (content) => {
          await createEntry(content);
          router.back();
        }}
      />
    </KeyboardSafeForm>
  );
}
