import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { entryToCsvRow, rowsToCsv } from "./csvFormat";
import type { VaultEntryContent } from "@/context/vaultEntry";

export async function exportVaultToCsv(entries: VaultEntryContent[]): Promise<void> {
  const rows = entries.map(entryToCsvRow);
  const csv = rowsToCsv(rows);
  const fileUri = `${FileSystem.cacheDirectory}vault-export.csv`;
  await FileSystem.writeAsStringAsync(fileUri, csv, { encoding: FileSystem.EncodingType.UTF8 });
  try {
    await Sharing.shareAsync(fileUri, { mimeType: "text/csv", UTI: "public.comma-separated-values-text" });
  } finally {
    // Delete the temp file right after the share sheet resolves — a
    // plaintext password export must not sit in the app's local storage
    // indefinitely. Runs even if shareAsync throws/is cancelled.
    await FileSystem.deleteAsync(fileUri, { idempotent: true });
  }
}
