import { useLocalSearchParams, useRouter } from "expo-router";
import { View } from "react-native";
import { useVault } from "@/context/VaultContext";
import { Button } from "@/components/button";
import { KeyboardSafeForm } from "@/components/keyboard-safe-form";
import { Spotlight } from "@/components/spotlight";
import { ThemedText } from "@/components/themed-text";
import { spacing, useThemeColors } from "@/theme";
import type { VaultEntryContent } from "@/context/vaultEntry";

function EntrySummary({ label, content }: { label: string; content: VaultEntryContent }) {
  const colors = useThemeColors();
  return (
    <View style={{ gap: spacing.xs, padding: spacing.md, borderWidth: 1, borderColor: colors.separator, borderRadius: 8 }}>
      <ThemedText variant="headline">{label}</ThemedText>
      <ThemedText variant="body">Title: {content.title}</ThemedText>
      {content.username ? <ThemedText variant="body">Username: {content.username}</ThemedText> : null}
      <ThemedText variant="body">Password: {content.password}</ThemedText>
      {content.url ? <ThemedText variant="body">URL: {content.url}</ThemedText> : null}
      {content.notes ? <ThemedText variant="body">Notes: {content.notes}</ThemedText> : null}
    </View>
  );
}

export default function ConflictScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { getConflict, resolveConflict } = useVault();
  const router = useRouter();
  const conflict = getConflict(id);

  if (!conflict) {
    return (
      <Spotlight contentStyle={{ justifyContent: "center", padding: spacing.lg }}>
        <ThemedText variant="body">No conflict to resolve.</ThemedText>
      </Spotlight>
    );
  }

  async function handleResolve(keep: "mine" | "theirs") {
    try {
      await resolveConflict(id, keep);
      router.back();
    } catch {
      // resolveConflict re-queues the update for the next sync; if THIS call
      // itself throws (e.g. the local write fails), stay on screen rather
      // than navigating away as if it succeeded.
    }
  }

  return (
    <KeyboardSafeForm>
      <ThemedText variant="largeTitle">Resolve conflict</ThemedText>
      <ThemedText variant="subhead">
        This entry was changed on another device too. Choose which version to keep.
      </ThemedText>
      <EntrySummary label="Yours" content={conflict.mine} />
      <EntrySummary label="Theirs" content={conflict.theirs} />
      <Button title="Keep mine" onPress={() => handleResolve("mine")} />
      <Button title="Keep theirs" variant="secondary" onPress={() => handleResolve("theirs")} />
    </KeyboardSafeForm>
  );
}
