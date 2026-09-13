import type { SQLiteDatabaseLike, VaultCacheEntry } from "./types";

interface VaultCacheRowRaw {
  id: string;
  ciphertext: string;
  updated_at: string;
  base_updated_at: string;
  sync_status: string;
  conflict_ciphertext: string | null;
}

function mapRow(row: VaultCacheRowRaw): VaultCacheEntry {
  return {
    id: row.id,
    ciphertext: row.ciphertext,
    updatedAt: row.updated_at,
    baseUpdatedAt: row.base_updated_at,
    syncStatus: row.sync_status as VaultCacheEntry["syncStatus"],
    conflictCiphertext: row.conflict_ciphertext,
  };
}

// Local-only temp id for an entry created offline, before the server has
// assigned it a real (integer) id. Never collides with a real id, which is
// always a plain digit string.
export function generateLocalId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `local-${hex}`;
}

export async function upsertEntry(db: SQLiteDatabaseLike, entry: VaultCacheEntry): Promise<void> {
  await db.runAsync(
    `INSERT INTO vault_entries_cache (id, ciphertext, updated_at, base_updated_at, sync_status, conflict_ciphertext)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       ciphertext = excluded.ciphertext,
       updated_at = excluded.updated_at,
       base_updated_at = excluded.base_updated_at,
       sync_status = excluded.sync_status,
       conflict_ciphertext = excluded.conflict_ciphertext`,
    [entry.id, entry.ciphertext, entry.updatedAt, entry.baseUpdatedAt, entry.syncStatus, entry.conflictCiphertext]
  );
}

export async function getAllEntries(db: SQLiteDatabaseLike): Promise<VaultCacheEntry[]> {
  const rows = await db.getAllAsync<VaultCacheRowRaw>(
    "SELECT * FROM vault_entries_cache ORDER BY updated_at DESC"
  );
  return rows.map(mapRow);
}

export async function getEntry(db: SQLiteDatabaseLike, id: string): Promise<VaultCacheEntry | null> {
  const row = await db.getFirstAsync<VaultCacheRowRaw>(
    "SELECT * FROM vault_entries_cache WHERE id = ?",
    [id]
  );
  return row ? mapRow(row) : null;
}

export async function deleteEntry(db: SQLiteDatabaseLike, id: string): Promise<void> {
  await db.runAsync("DELETE FROM vault_entries_cache WHERE id = ?", [id]);
}

export async function replaceEntryId(db: SQLiteDatabaseLike, oldId: string, newId: string): Promise<void> {
  await db.runAsync("UPDATE vault_entries_cache SET id = ? WHERE id = ?", [newId, oldId]);
}

export async function markSynced(
  db: SQLiteDatabaseLike,
  id: string,
  fields: { ciphertext: string; updatedAt: string }
): Promise<void> {
  await db.runAsync(
    `UPDATE vault_entries_cache
     SET ciphertext = ?, updated_at = ?, base_updated_at = ?, sync_status = 'synced', conflict_ciphertext = NULL
     WHERE id = ?`,
    [fields.ciphertext, fields.updatedAt, fields.updatedAt, id]
  );
}

// Records a local, not-yet-pushed edit. Deliberately does NOT touch
// base_updated_at — it must stay at the last server-confirmed value so the
// sync engine's pre-flight conflict check (comparing the server's live
// updated_at to base_updated_at) stays meaningful.
export async function markPending(
  db: SQLiteDatabaseLike,
  id: string,
  fields: { ciphertext: string; updatedAt: string }
): Promise<void> {
  await db.runAsync(
    "UPDATE vault_entries_cache SET ciphertext = ?, updated_at = ?, sync_status = 'pending', conflict_ciphertext = NULL WHERE id = ?",
    [fields.ciphertext, fields.updatedAt, id]
  );
}

// Records a detected conflict. Also advances base_updated_at to the
// remote's updated_at — we just observed the server's current state via
// the pre-flight fetch, which is exactly what base_updated_at is defined to
// mean. Without this, the re-queued update produced by resolving the
// conflict would keep comparing against the stale pre-conflict baseline on
// its next sync and could never actually push.
export async function markConflict(
  db: SQLiteDatabaseLike,
  id: string,
  conflictCiphertext: string,
  remoteUpdatedAt: string
): Promise<void> {
  await db.runAsync(
    "UPDATE vault_entries_cache SET sync_status = 'conflict', conflict_ciphertext = ?, base_updated_at = ? WHERE id = ?",
    [conflictCiphertext, remoteUpdatedAt, id]
  );
}
