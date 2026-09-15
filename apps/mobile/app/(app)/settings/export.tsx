import { useState } from "react";
import { View } from "react-native";
import { useVault } from "@/context/VaultContext";
import { exportVaultToCsv } from "@/import-export/exportVault";
import { Button } from "@/components/button";
import { ThemedText } from "@/components/themed-text";
import { colors, spacing } from "@/theme";

export default function ExportScreen() {
  const { entries } = useVault();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleExport() {
    setError(null);
    setLoading(true);
    try {
      await exportVaultToCsv(entries.map((e) => e.content));
    } catch {
      setError("Couldn't export your vault. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.systemBackground, padding: spacing.lg, gap: spacing.md }}>
      <ThemedText variant="largeTitle">Export vault</ThemedText>
      <ThemedText variant="subhead">
        Saves a CSV file with every entry's title, URL, username, and password in plain text — share it
        somewhere safe.
      </ThemedText>
      {error ? (
        <ThemedText variant="subhead" style={{ color: "#E5484D" }}>
          {error}
        </ThemedText>
      ) : null}
      <Button title="Export" loading={loading} onPress={handleExport} />
    </View>
  );
}
