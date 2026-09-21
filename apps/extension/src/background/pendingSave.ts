import type { KeyValueStore } from "./session";

export interface PendingRecord {
  kind: "save" | "update";
  username: string;
  password: string;
  pageUrl: string;
  existingId?: number;
  createdAt: number;
}

export const PENDING_TTL_MS = 2 * 60_000;
const PREFIX = "pendingSave:";
const keyFor = (tabId: number) => `${PREFIX}${tabId}`;

function isRecord(value: unknown): value is PendingRecord {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    (v.kind === "save" || v.kind === "update") &&
    typeof v.username === "string" &&
    typeof v.password === "string" &&
    typeof v.pageUrl === "string" &&
    typeof v.createdAt === "number"
  );
}

// A submitted credential survives the post-login page navigation here (in
// storage.session, memory only) so the NEXT page can show the save banner. The
// plaintext password stays in the background and is never sent to a content script.
export function createPendingStore(store: KeyValueStore, now: () => number) {
  return {
    async park(tabId: number, record: Omit<PendingRecord, "createdAt">): Promise<void> {
      await store.set({ [keyFor(tabId)]: { ...record, createdAt: now() } });
    },

    async peek(tabId: number): Promise<PendingRecord | null> {
      const stored = (await store.get(keyFor(tabId)))[keyFor(tabId)];
      if (!isRecord(stored)) return null;
      if (now() - stored.createdAt > PENDING_TTL_MS) {
        await store.remove(keyFor(tabId));
        return null;
      }
      return stored;
    },

    async discard(tabId: number): Promise<void> {
      await store.remove(keyFor(tabId));
    },

    async clearAll(): Promise<void> {
      const all = await store.get(null);
      for (const key of Object.keys(all)) {
        if (key.startsWith(PREFIX)) await store.remove(key);
      }
    },
  };
}

export type PendingStore = ReturnType<typeof createPendingStore>;
