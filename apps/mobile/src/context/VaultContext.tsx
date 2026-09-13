import { createContext, useContext, useCallback, useEffect, useState, useRef, ReactNode } from "react";
import * as SQLite from "expo-sqlite";
import type { SQLiteDatabaseLike, VaultCacheEntry } from "@/db/types";
import { initDatabase } from "@/db/schema";
import * as vaultCache from "@/db/vaultCache";
import * as syncQueueDb from "@/db/syncQueue";
import { sync as runSync } from "@/sync/syncEngine";
import { encryptEntry, decryptEntry } from "@/crypto/cipher";
import { useAuth } from "./AuthContext";
import type { VaultEntryContent } from "./vaultEntry";

export type { VaultEntryContent } from "./vaultEntry";

export interface DecryptedEntry {
  id: string;
  content: VaultEntryContent;
  syncStatus: VaultCacheEntry["syncStatus"];
}

interface VaultContextValue {
  entries: DecryptedEntry[];
  isSyncing: boolean;
  refresh: () => Promise<void>;
  createEntry: (content: VaultEntryContent) => Promise<void>;
  updateEntry: (id: string, content: VaultEntryContent) => Promise<void>;
  deleteEntry: (id: string) => Promise<void>;
  getConflict: (id: string) => { mine: VaultEntryContent; theirs: VaultEntryContent } | null;
  resolveConflict: (id: string, keep: "mine" | "theirs") => Promise<void>;
}

const VaultContext = createContext<VaultContextValue | undefined>(undefined);

export function VaultProvider({ children }: { children: ReactNode }) {
  const { vaultKey, accessToken, status, user } = useAuth();
  const [db, setDb] = useState<SQLiteDatabaseLike | null>(null);
  const [rawEntries, setRawEntries] = useState<VaultCacheEntry[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const syncInFlightRef = useRef<Promise<void> | null>(null);

  // Each signed-in user gets their own SQLite file (vault-<id>.db), opened
  // only once a user is actually present. Switching accounts opens a
  // completely different, isolated database file, so there's no
  // cross-account contamination of cached rows or queued operations.
  // Logging out and auto-lock both clear `user` to null (db becomes null
  // until sign-in), while re-signing in as the SAME user re-opens their
  // SAME file, preserving their offline cache across an auto-lock/unlock
  // cycle — only a real account switch changes the file.
  useEffect(() => {
    if (!user) {
      setDb(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const nativeDb = await SQLite.openDatabaseAsync(`vault-${user.id}.db`);
      await initDatabase(nativeDb as SQLiteDatabaseLike);
      if (!cancelled) setDb(nativeDb as SQLiteDatabaseLike);
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const reload = useCallback(async (activeDb: SQLiteDatabaseLike) => {
    setRawEntries(await vaultCache.getAllEntries(activeDb));
  }, []);

  const refresh = useCallback(async () => {
    if (!db || !accessToken) return;
    if (syncInFlightRef.current) {
      return syncInFlightRef.current;
    }
    setIsSyncing(true);
    const promise = (async () => {
      try {
        await runSync(db, accessToken);
        await reload(db);
      } finally {
        setIsSyncing(false);
        syncInFlightRef.current = null;
      }
    })();
    syncInFlightRef.current = promise;
    return promise;
  }, [db, accessToken, reload]);

  useEffect(() => {
    if (db && status === "unlocked" && accessToken) {
      reload(db);
      refresh();
    }
  }, [db, status, accessToken, reload, refresh]);

  const createEntry = useCallback(
    async (content: VaultEntryContent) => {
      if (!db || !vaultKey) throw new Error("Vault is not ready");
      const id = vaultCache.generateLocalId();
      const ciphertext = encryptEntry(vaultKey, JSON.stringify(content));
      const now = new Date().toISOString();
      await vaultCache.upsertEntry(db, {
        id,
        ciphertext,
        updatedAt: now,
        baseUpdatedAt: now,
        syncStatus: "pending",
        conflictCiphertext: null,
      });
      await syncQueueDb.enqueueOperation(db, id, "create", ciphertext);
      await reload(db);
      refresh(); // fire-and-forget: optimistic UI already reflects the new entry
    },
    [db, vaultKey, reload, refresh]
  );

  const updateEntry = useCallback(
    async (id: string, content: VaultEntryContent) => {
      if (!db || !vaultKey) throw new Error("Vault is not ready");
      const ciphertext = encryptEntry(vaultKey, JSON.stringify(content));
      const now = new Date().toISOString();
      await vaultCache.markPending(db, id, { ciphertext, updatedAt: now });
      await syncQueueDb.enqueueOperation(db, id, "update", ciphertext);
      await reload(db);
      refresh();
    },
    [db, vaultKey, reload, refresh]
  );

  const deleteEntry = useCallback(
    async (id: string) => {
      if (!db) throw new Error("Vault is not ready");
      await vaultCache.deleteEntry(db, id);
      await syncQueueDb.enqueueOperation(db, id, "delete", null);
      await reload(db);
      refresh();
    },
    [db, reload, refresh]
  );

  const getConflict = useCallback(
    (id: string): { mine: VaultEntryContent; theirs: VaultEntryContent } | null => {
      const row = rawEntries.find((entry) => entry.id === id);
      if (!row || row.syncStatus !== "conflict" || !row.conflictCiphertext || !vaultKey) return null;
      return {
        mine: JSON.parse(decryptEntry(vaultKey, row.ciphertext)) as VaultEntryContent,
        theirs: JSON.parse(decryptEntry(vaultKey, row.conflictCiphertext)) as VaultEntryContent,
      };
    },
    [rawEntries, vaultKey]
  );

  const resolveConflict = useCallback(
    async (id: string, keep: "mine" | "theirs") => {
      if (!db || !vaultKey) return;
      const row = rawEntries.find((entry) => entry.id === id);
      if (!row || !row.conflictCiphertext) return;
      const ciphertext = keep === "mine" ? row.ciphertext : row.conflictCiphertext;
      const now = new Date().toISOString();
      await vaultCache.markPending(db, id, { ciphertext, updatedAt: now });
      await syncQueueDb.enqueueOperation(db, id, "update", ciphertext);
      await reload(db);
      refresh();
    },
    [db, vaultKey, rawEntries, reload, refresh]
  );

  const entries: DecryptedEntry[] = vaultKey
    ? rawEntries.flatMap((entry) => {
        try {
          return [
            {
              id: entry.id,
              content: JSON.parse(decryptEntry(vaultKey, entry.ciphertext)) as VaultEntryContent,
              syncStatus: entry.syncStatus,
            },
          ];
        } catch {
          return [];
        }
      })
    : [];

  return (
    <VaultContext.Provider
      value={{ entries, isSyncing, refresh, createEntry, updateEntry, deleteEntry, getConflict, resolveConflict }}
    >
      {children}
    </VaultContext.Provider>
  );
}

export function useVault(): VaultContextValue {
  const context = useContext(VaultContext);
  if (!context) {
    throw new Error("useVault must be used within a VaultProvider");
  }
  return context;
}
