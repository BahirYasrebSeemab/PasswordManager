export interface SQLiteRunResult {
  lastInsertRowId: number;
  changes: number;
}

// The narrow subset of expo-sqlite's SQLiteDatabase class that db/ and
// sync/ depend on. Real expo-sqlite instances (from SQLite.openDatabaseAsync)
// satisfy this structurally. In tests, testUtils.ts provides a different
// concrete implementation backed by node:sqlite, since real expo-sqlite
// cannot execute under Jest (see the plan's Global Constraints).
export interface SQLiteDatabaseLike {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, params?: unknown[]): Promise<SQLiteRunResult>;
  getAllAsync<T>(sql: string, params?: unknown[]): Promise<T[]>;
  getFirstAsync<T>(sql: string, params?: unknown[]): Promise<T | null>;
}

export type SyncStatus = "synced" | "pending" | "conflict";

export interface VaultCacheEntry {
  id: string;
  ciphertext: string;
  updatedAt: string;
  baseUpdatedAt: string;
  syncStatus: SyncStatus;
  conflictCiphertext: string | null;
}

export type PendingOp = "create" | "update" | "delete";

export interface PendingOperation {
  id: number;
  entryId: string;
  op: PendingOp;
  payload: string | null;
  createdAt: string;
}
