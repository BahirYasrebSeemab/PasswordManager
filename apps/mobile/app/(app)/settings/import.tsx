import { useState } from "react";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import { useVault } from "@/context/VaultContext";
import { parseImportCsv, importEntries } from "@/import-export/importVault";
import { Button } from "@/components/button";
import { Spotlight } from "@/components/spotlight";
import { ThemedText } from "@/components/themed-text";
import { spacing } from "@/theme";

export default function ImportScreen() {
  const { createEntry } = useVault();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importedCount, setImportedCount] = useState<number | null>(null);

  async function handleImport() {
    setError(null);
    setImportedCount(null);
    const result = await DocumentPicker.getDocumentAsync({ type: "text/csv" });
    if (result.canceled) return;
    setLoading(true);
    try {
      const csv = await FileSystem.readAsStringAsync(result.assets[0].uri);
      const entries = parseImportCsv(csv);
      const count = await importEntries(entries, createEntry);
      setImportedCount(count);
    } catch {
      setError("Couldn't import that file. Make sure it's a CSV exported from Chrome or Firefox.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Spotlight contentStyle={{ padding: spacing.lg, gap: spacing.md }}>
      <ThemedText variant="largeTitle">Import vault</ThemedText>
      <ThemedText variant="subhead">
        Pick a CSV file exported from Chrome or Firefox. Imported entries aren't checked against your
        existing vault, so re-importing the same file will create duplicates.
      </ThemedText>
      {importedCount !== null ? <ThemedText variant="subhead">{importedCount} imported.</ThemedText> : null}
      {error ? (
        <ThemedText variant="subhead" style={{ color: "#E5484D" }}>
          {error}
        </ThemedText>
      ) : null}
      <Button title="Choose file" loading={loading} onPress={handleImport} />
    </Spotlight>
  );
}
