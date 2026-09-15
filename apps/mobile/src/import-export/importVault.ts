import { csvToRows, csvRowToEntry } from "./csvFormat";
import type { VaultEntryContent } from "@/context/vaultEntry";

export function parseImportCsv(csv: string): VaultEntryContent[] {
  return csvToRows(csv)
    .filter((row) => row.password.length > 0)
    .map(csvRowToEntry);
}

// No conflict/dedup detection by design (see spec) — importing over
// existing entries just creates duplicates the user can clean up manually.
// Goes through the normal createEntry path so every imported entry is
// properly client-side encrypted and queued, exactly like a manually
// created one — never a bulk-insert bypass.
export async function importEntries(
  entries: VaultEntryContent[],
  createEntry: (content: VaultEntryContent) => Promise<void>
): Promise<number> {
  for (const entry of entries) {
    await createEntry(entry);
  }
  return entries.length;
}
