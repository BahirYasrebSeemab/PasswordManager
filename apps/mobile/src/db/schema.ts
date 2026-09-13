import type { SQLiteDatabaseLike } from "./types";

export const CREATE_VAULT_ENTRIES_CACHE_TABLE = `
CREATE TABLE IF NOT EXISTS vault_entries_cache (
  id TEXT PRIMARY KEY,
  ciphertext TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  base_updated_at TEXT NOT NULL,
  sync_status TEXT NOT NULL,
  conflict_ciphertext TEXT
)`;

export const CREATE_PENDING_OPERATIONS_TABLE = `
CREATE TABLE IF NOT EXISTS pending_operations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id TEXT NOT NULL,
  op TEXT NOT NULL,
  payload TEXT,
  created_at TEXT NOT NULL
)`;

export async function initDatabase(db: SQLiteDatabaseLike): Promise<void> {
  await db.execAsync(CREATE_VAULT_ENTRIES_CACHE_TABLE);
  await db.execAsync(CREATE_PENDING_OPERATIONS_TABLE);
}
