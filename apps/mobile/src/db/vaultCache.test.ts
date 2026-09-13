import { createTestDatabase } from "./testUtils";
import { initDatabase } from "./schema";
import * as vaultCache from "./vaultCache";
import type { SQLiteDatabaseLike, VaultCacheEntry } from "./types";

let db: SQLiteDatabaseLike;

beforeEach(async () => {
  db = createTestDatabase();
  await initDatabase(db);
});

function makeEntry(overrides: Partial<VaultCacheEntry> = {}): VaultCacheEntry {
  return {
    id: "1",
    ciphertext: "ct-v1",
    updatedAt: "2026-01-01T00:00:00Z",
    baseUpdatedAt: "2026-01-01T00:00:00Z",
    syncStatus: "synced",
    conflictCiphertext: null,
    ...overrides,
  };
}

test("generateLocalId returns a 'local-' prefixed id that never matches a real numeric id", () => {
  const id = vaultCache.generateLocalId();
  expect(id).toMatch(/^local-[0-9a-f]{32}$/);
});

test("upsertEntry inserts a new row that getEntry can read back", async () => {
  await vaultCache.upsertEntry(db, makeEntry());

  const entry = await vaultCache.getEntry(db, "1");
  expect(entry).toEqual(makeEntry());
});

test("upsertEntry on an existing id updates the row instead of erroring", async () => {
  await vaultCache.upsertEntry(db, makeEntry());
  await vaultCache.upsertEntry(db, makeEntry({ ciphertext: "ct-v2" }));

  const entry = await vaultCache.getEntry(db, "1");
  expect(entry?.ciphertext).toBe("ct-v2");
  expect(await vaultCache.getAllEntries(db)).toHaveLength(1);
});

test("getEntry returns null for a missing id", async () => {
  expect(await vaultCache.getEntry(db, "missing")).toBeNull();
});

test("getAllEntries returns every row", async () => {
  await vaultCache.upsertEntry(db, makeEntry({ id: "1" }));
  await vaultCache.upsertEntry(db, makeEntry({ id: "2" }));

  expect(await vaultCache.getAllEntries(db)).toHaveLength(2);
});

test("deleteEntry removes the row", async () => {
  await vaultCache.upsertEntry(db, makeEntry());
  await vaultCache.deleteEntry(db, "1");

  expect(await vaultCache.getEntry(db, "1")).toBeNull();
});

test("replaceEntryId renames the primary key", async () => {
  await vaultCache.upsertEntry(db, makeEntry({ id: "local-abc" }));
  await vaultCache.replaceEntryId(db, "local-abc", "42");

  expect(await vaultCache.getEntry(db, "local-abc")).toBeNull();
  expect(await vaultCache.getEntry(db, "42")).not.toBeNull();
});

test("markSynced sets ciphertext/updatedAt/baseUpdatedAt and clears conflict state", async () => {
  await vaultCache.upsertEntry(db, makeEntry({ syncStatus: "conflict", conflictCiphertext: "ct-theirs" }));

  await vaultCache.markSynced(db, "1", { ciphertext: "ct-final", updatedAt: "2026-02-01T00:00:00Z" });

  const entry = await vaultCache.getEntry(db, "1");
  expect(entry).toEqual(
    makeEntry({
      ciphertext: "ct-final",
      updatedAt: "2026-02-01T00:00:00Z",
      baseUpdatedAt: "2026-02-01T00:00:00Z",
      syncStatus: "synced",
      conflictCiphertext: null,
    })
  );
});

test("markPending updates ciphertext/updatedAt/status but leaves baseUpdatedAt untouched", async () => {
  await vaultCache.upsertEntry(db, makeEntry());

  await vaultCache.markPending(db, "1", { ciphertext: "ct-edited", updatedAt: "2026-02-01T00:00:00Z" });

  const entry = await vaultCache.getEntry(db, "1");
  expect(entry?.ciphertext).toBe("ct-edited");
  expect(entry?.updatedAt).toBe("2026-02-01T00:00:00Z");
  expect(entry?.baseUpdatedAt).toBe("2026-01-01T00:00:00Z");
  expect(entry?.syncStatus).toBe("pending");
});

test("markConflict sets status to conflict, stores the server's ciphertext, and advances the baseline", async () => {
  await vaultCache.upsertEntry(db, makeEntry());

  await vaultCache.markConflict(db, "1", "ct-theirs", "2026-02-01T00:00:00Z");

  const entry = await vaultCache.getEntry(db, "1");
  expect(entry?.syncStatus).toBe("conflict");
  expect(entry?.conflictCiphertext).toBe("ct-theirs");
  expect(entry?.baseUpdatedAt).toBe("2026-02-01T00:00:00Z");
});
