import { createTestDatabase } from "@/db/testUtils";
import { initDatabase } from "@/db/schema";
import * as vaultCache from "@/db/vaultCache";
import * as syncQueue from "@/db/syncQueue";
import { sync } from "./syncEngine";
import type { SQLiteDatabaseLike } from "@/db/types";

jest.mock("@/api/vault");
import * as vaultApi from "@/api/vault";
import { ApiError } from "@/api/client";

let db: SQLiteDatabaseLike;

beforeEach(async () => {
  db = createTestDatabase();
  await initDatabase(db);
  jest.clearAllMocks();
});

test("flushes a queued create: replaces the temp id, marks synced, dequeues", async () => {
  await vaultCache.upsertEntry(db, {
    id: "local-abc",
    ciphertext: "ct-new",
    updatedAt: "2026-01-01T00:00:00Z",
    baseUpdatedAt: "2026-01-01T00:00:00Z",
    syncStatus: "pending",
    conflictCiphertext: null,
  });
  await syncQueue.enqueueOperation(db, "local-abc", "create", "ct-new");
  (vaultApi.createVaultEntry as jest.Mock).mockResolvedValue({
    id: 42,
    ciphertext: "ct-new",
    created_at: "2026-01-02T00:00:00Z",
    updated_at: "2026-01-02T00:00:00Z",
  });
  (vaultApi.listVaultEntries as jest.Mock).mockResolvedValue([
    { id: 42, ciphertext: "ct-new", created_at: "2026-01-02T00:00:00Z", updated_at: "2026-01-02T00:00:00Z" },
  ]);

  await sync(db, "tok");

  expect(await vaultCache.getEntry(db, "local-abc")).toBeNull();
  const entry = await vaultCache.getEntry(db, "42");
  expect(entry).toMatchObject({ syncStatus: "synced", updatedAt: "2026-01-02T00:00:00Z" });
  expect(await syncQueue.getQueuedOperations(db)).toHaveLength(0);
});

test("flushes a queued update when the server is unchanged since our base_updated_at", async () => {
  await vaultCache.upsertEntry(db, {
    id: "1",
    ciphertext: "ct-edited",
    updatedAt: "2026-01-02T00:00:00Z",
    baseUpdatedAt: "2026-01-01T00:00:00Z",
    syncStatus: "pending",
    conflictCiphertext: null,
  });
  await syncQueue.enqueueOperation(db, "1", "update", "ct-edited");
  (vaultApi.getVaultEntry as jest.Mock).mockResolvedValue({
    id: 1,
    ciphertext: "ct-old",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  });
  (vaultApi.updateVaultEntry as jest.Mock).mockResolvedValue({
    id: 1,
    ciphertext: "ct-edited",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-03T00:00:00Z",
  });
  (vaultApi.listVaultEntries as jest.Mock).mockResolvedValue([
    { id: 1, ciphertext: "ct-edited", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-03T00:00:00Z" },
  ]);

  await sync(db, "tok");

  const entry = await vaultCache.getEntry(db, "1");
  expect(entry).toMatchObject({ syncStatus: "synced", updatedAt: "2026-01-03T00:00:00Z" });
  expect(await syncQueue.getQueuedOperations(db)).toHaveLength(0);
});

test("marks a conflict instead of pushing when the server changed since base_updated_at", async () => {
  await vaultCache.upsertEntry(db, {
    id: "1",
    ciphertext: "ct-mine",
    updatedAt: "2026-01-02T00:00:00Z",
    baseUpdatedAt: "2026-01-01T00:00:00Z",
    syncStatus: "pending",
    conflictCiphertext: null,
  });
  await syncQueue.enqueueOperation(db, "1", "update", "ct-mine");
  (vaultApi.getVaultEntry as jest.Mock).mockResolvedValue({
    id: 1,
    ciphertext: "ct-theirs",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-02T12:00:00Z", // changed since our base_updated_at
  });
  (vaultApi.listVaultEntries as jest.Mock).mockResolvedValue([
    { id: 1, ciphertext: "ct-theirs", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-02T12:00:00Z" },
  ]);

  await sync(db, "tok");

  const entry = await vaultCache.getEntry(db, "1");
  expect(entry?.syncStatus).toBe("conflict");
  expect(entry?.ciphertext).toBe("ct-mine"); // "my version" preserved for the resolution screen
  expect(entry?.conflictCiphertext).toBe("ct-theirs");
  expect(entry?.baseUpdatedAt).toBe("2026-01-02T12:00:00Z"); // advanced to the remote's updated_at
  expect(vaultApi.updateVaultEntry).not.toHaveBeenCalled();
  expect(await syncQueue.getQueuedOperations(db)).toHaveLength(0);
});

test("a resolved conflict (mimicking VaultContext.resolveConflict) successfully pushes on the next sync, not re-conflicting", async () => {
  // Step 1: seed a pending local edit and detect a conflict against it.
  await vaultCache.upsertEntry(db, {
    id: "1",
    ciphertext: "ct-mine",
    updatedAt: "2026-01-02T00:00:00Z",
    baseUpdatedAt: "2026-01-01T00:00:00Z",
    syncStatus: "pending",
    conflictCiphertext: null,
  });
  await syncQueue.enqueueOperation(db, "1", "update", "ct-mine");
  (vaultApi.getVaultEntry as jest.Mock).mockResolvedValueOnce({
    id: 1,
    ciphertext: "ct-theirs",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-02T12:00:00Z",
  });
  (vaultApi.listVaultEntries as jest.Mock).mockResolvedValue([
    { id: 1, ciphertext: "ct-theirs", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-02T12:00:00Z" },
  ]);

  await sync(db, "tok");

  let entry = await vaultCache.getEntry(db, "1");
  expect(entry?.syncStatus).toBe("conflict");

  // Step 2: mimic exactly what VaultContext.resolveConflict("1", "mine") does —
  // markPending with the chosen ciphertext, then re-enqueue an update.
  await vaultCache.markPending(db, "1", { ciphertext: "ct-mine", updatedAt: "2026-01-03T00:00:00Z" });
  await syncQueue.enqueueOperation(db, "1", "update", "ct-mine");

  // Step 3: sync again. The server hasn't changed since we last observed it
  // (still ct-theirs / 2026-01-02T12:00:00Z), so this should now be treated
  // as a normal, successful push — NOT a re-conflict.
  (vaultApi.getVaultEntry as jest.Mock).mockResolvedValueOnce({
    id: 1,
    ciphertext: "ct-theirs",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-02T12:00:00Z",
  });
  (vaultApi.updateVaultEntry as jest.Mock).mockResolvedValueOnce({
    id: 1,
    ciphertext: "ct-mine",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-04T00:00:00Z",
  });
  (vaultApi.listVaultEntries as jest.Mock).mockResolvedValue([
    { id: 1, ciphertext: "ct-mine", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-04T00:00:00Z" },
  ]);

  await sync(db, "tok");

  entry = await vaultCache.getEntry(db, "1");
  expect(entry?.syncStatus).toBe("synced");
  expect(entry?.ciphertext).toBe("ct-mine");
  expect(vaultApi.updateVaultEntry).toHaveBeenCalledWith("tok", "1", "ct-mine");
});

test("a 404 on the update pre-flight (deleted elsewhere) removes the local entry, not a conflict", async () => {
  await vaultCache.upsertEntry(db, {
    id: "1",
    ciphertext: "ct-mine",
    updatedAt: "2026-01-02T00:00:00Z",
    baseUpdatedAt: "2026-01-01T00:00:00Z",
    syncStatus: "pending",
    conflictCiphertext: null,
  });
  await syncQueue.enqueueOperation(db, "1", "update", "ct-mine");
  (vaultApi.getVaultEntry as jest.Mock).mockRejectedValue(new ApiError(404, "Vault entry not found"));
  (vaultApi.listVaultEntries as jest.Mock).mockResolvedValue([]);

  await sync(db, "tok");

  expect(await vaultCache.getEntry(db, "1")).toBeNull();
  expect(await syncQueue.getQueuedOperations(db)).toHaveLength(0);
});

test("flushes a queued delete and removes the local row", async () => {
  await vaultCache.upsertEntry(db, {
    id: "1",
    ciphertext: "ct",
    updatedAt: "2026-01-01T00:00:00Z",
    baseUpdatedAt: "2026-01-01T00:00:00Z",
    syncStatus: "pending",
    conflictCiphertext: null,
  });
  await syncQueue.enqueueOperation(db, "1", "delete", null);
  (vaultApi.deleteVaultEntry as jest.Mock).mockResolvedValue(undefined);
  (vaultApi.listVaultEntries as jest.Mock).mockResolvedValue([]);

  await sync(db, "tok");

  expect(await vaultCache.getEntry(db, "1")).toBeNull();
  expect(vaultApi.deleteVaultEntry).toHaveBeenCalledWith("tok", "1");
});

test("pull phase inserts entries this device has never seen", async () => {
  (vaultApi.listVaultEntries as jest.Mock).mockResolvedValue([
    { id: 7, ciphertext: "ct-remote", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" },
  ]);

  await sync(db, "tok");

  const entry = await vaultCache.getEntry(db, "7");
  expect(entry).toMatchObject({ ciphertext: "ct-remote", syncStatus: "synced" });
});

test("pull phase does not overwrite a locally 'conflict' or 'pending' entry", async () => {
  await vaultCache.upsertEntry(db, {
    id: "1",
    ciphertext: "ct-mine",
    updatedAt: "2026-01-02T00:00:00Z",
    baseUpdatedAt: "2026-01-01T00:00:00Z",
    syncStatus: "conflict",
    conflictCiphertext: "ct-theirs-old",
  });
  (vaultApi.listVaultEntries as jest.Mock).mockResolvedValue([
    { id: 1, ciphertext: "ct-server-newer", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-03T00:00:00Z" },
  ]);

  await sync(db, "tok");

  const entry = await vaultCache.getEntry(db, "1");
  expect(entry?.ciphertext).toBe("ct-mine");
  expect(entry?.syncStatus).toBe("conflict");
});

test("pull phase deletes local entries no longer present remotely", async () => {
  await vaultCache.upsertEntry(db, {
    id: "1",
    ciphertext: "ct",
    updatedAt: "2026-01-01T00:00:00Z",
    baseUpdatedAt: "2026-01-01T00:00:00Z",
    syncStatus: "synced",
    conflictCiphertext: null,
  });
  (vaultApi.listVaultEntries as jest.Mock).mockResolvedValue([]);

  await sync(db, "tok");

  expect(await vaultCache.getEntry(db, "1")).toBeNull();
});

test("sync() never throws when the network is unavailable", async () => {
  await syncQueue.enqueueOperation(db, "1", "delete", null);
  (vaultApi.deleteVaultEntry as jest.Mock).mockRejectedValue(new Error("network down"));
  (vaultApi.listVaultEntries as jest.Mock).mockRejectedValue(new Error("network down"));

  await expect(sync(db, "tok")).resolves.toBeUndefined();
  // The failed op stays queued for the next sync() call.
  expect(await syncQueue.getQueuedOperations(db)).toHaveLength(1);
});

test("does not lose a queued update for an entry created earlier in the same sync() call", async () => {
  // Simulates: user creates an entry offline, then edits it again before
  // the next sync. Both ops queue under the same local temp id.
  await vaultCache.upsertEntry(db, {
    id: "local-abc",
    ciphertext: "ct-v0",
    updatedAt: "2025-12-31T00:00:00Z",
    baseUpdatedAt: "2025-12-31T00:00:00Z",
    syncStatus: "pending",
    conflictCiphertext: null,
  });
  await syncQueue.enqueueOperation(db, "local-abc", "create", "ct-v1");
  await syncQueue.enqueueOperation(db, "local-abc", "update", "ct-v2");

  (vaultApi.createVaultEntry as jest.Mock).mockResolvedValue({
    id: 99,
    ciphertext: "ct-v1",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  });
  // The pre-flight fetch inside handleUpdate must see the SAME
  // updated_at the create just produced (i.e. the real id "99", not the
  // stale temp id) for the update to be treated as conflict-free.
  (vaultApi.getVaultEntry as jest.Mock).mockResolvedValue({
    id: 99,
    ciphertext: "ct-v1",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  });
  (vaultApi.updateVaultEntry as jest.Mock).mockResolvedValue({
    id: 99,
    ciphertext: "ct-v2",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-02T00:00:00Z",
  });
  (vaultApi.listVaultEntries as jest.Mock).mockResolvedValue([
    { id: 99, ciphertext: "ct-v2", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-02T00:00:00Z" },
  ]);

  await sync(db, "tok");

  expect(await vaultCache.getEntry(db, "local-abc")).toBeNull();
  const entry = await vaultCache.getEntry(db, "99");
  expect(entry).toMatchObject({ ciphertext: "ct-v2", syncStatus: "synced", updatedAt: "2026-01-02T00:00:00Z" });
  expect(vaultApi.getVaultEntry).toHaveBeenCalledWith("tok", "99");
  expect(vaultApi.updateVaultEntry).toHaveBeenCalledWith("tok", "99", "ct-v2");
  expect(await syncQueue.getQueuedOperations(db)).toHaveLength(0);
});

test("sync() never throws when a pullRemote database write fails", async () => {
  (vaultApi.listVaultEntries as jest.Mock).mockResolvedValue([
    { id: 5, ciphertext: "ct-x", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" },
  ]);
  const upsertSpy = jest
    .spyOn(vaultCache, "upsertEntry")
    .mockRejectedValueOnce(new Error("disk full"));

  await expect(sync(db, "tok")).resolves.toBeUndefined();

  upsertSpy.mockRestore();
});
