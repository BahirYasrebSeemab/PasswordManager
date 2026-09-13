import type { PendingOperation, SQLiteDatabaseLike } from "@/db/types";
import * as vaultCache from "@/db/vaultCache";
import * as syncQueue from "@/db/syncQueue";
import * as vaultApi from "@/api/vault";
import { ApiError } from "@/api/client";

export async function sync(db: SQLiteDatabaseLike, accessToken: string): Promise<void> {
  try {
    await flushQueue(db, accessToken);
    await pullRemote(db, accessToken);
  } catch {
    // Belt-and-suspenders: flushQueue and pullRemote already contain their
    // own failures, but a DB-layer error (SQLite busy/locked, disk I/O) in
    // either could otherwise still escape. sync() must never throw — a
    // partial sync is simply retried on the next call.
  }
}

async function flushQueue(db: SQLiteDatabaseLike, accessToken: string): Promise<void> {
  const ops = await syncQueue.getQueuedOperations(db);
  const skipEntryIds = new Set<string>();

  for (const op of ops) {
    if (skipEntryIds.has(op.entryId)) continue;

    try {
      if (op.op === "create") {
        const newId = await handleCreate(db, accessToken, op);
        // handleCreate already renamed this entry to newId in the database
        // (vaultCache + syncQueue), but the in-memory `ops` array we're
        // iterating was fetched before that rename, so any other
        // not-yet-processed op for this same entry still carries the old
        // temp id. Patch those array entries now so later iterations in
        // this same pass target the right id — otherwise a queued update
        // or delete for a just-created entry would look up the wrong row
        // (a stale getEntry miss, or a stale-id 404) and be silently
        // discarded instead of applied.
        for (let i = 0; i < ops.length; i++) {
          if (ops[i].entryId === op.entryId) {
            ops[i] = { ...ops[i], entryId: newId };
          }
        }
      } else if (op.op === "update") {
        const { conflicted } = await handleUpdate(db, accessToken, op);
        if (conflicted) skipEntryIds.add(op.entryId);
      } else {
        await handleDelete(db, accessToken, op);
      }
    } catch {
      // Network failure or an unexpected server error: leave this op
      // queued (retried on the next sync() call) and skip any later ops
      // for the same entry, so they don't get applied out of order.
      skipEntryIds.add(op.entryId);
    }
  }
}

async function handleCreate(
  db: SQLiteDatabaseLike,
  accessToken: string,
  op: PendingOperation
): Promise<string> {
  const created = await vaultApi.createVaultEntry(accessToken, op.payload as string);
  const realId = String(created.id);

  await vaultCache.replaceEntryId(db, op.entryId, realId);
  await syncQueue.renameOperationsEntryId(db, op.entryId, realId);
  await vaultCache.markSynced(db, realId, { ciphertext: created.ciphertext, updatedAt: created.updated_at });
  await syncQueue.dequeueOperation(db, op.id);
  return realId;
}

async function handleUpdate(
  db: SQLiteDatabaseLike,
  accessToken: string,
  op: PendingOperation
): Promise<{ conflicted: boolean }> {
  const local = await vaultCache.getEntry(db, op.entryId);
  if (!local) {
    // The cache row is already gone (e.g. deleted locally after this
    // update was queued) — nothing left to push.
    await syncQueue.dequeueOperation(db, op.id);
    return { conflicted: false };
  }

  let remote: vaultApi.VaultEntryResponse;
  try {
    remote = await vaultApi.getVaultEntry(accessToken, op.entryId);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      // Deleted on another device — nothing to resolve, just clean up.
      await vaultCache.deleteEntry(db, op.entryId);
      await syncQueue.dequeueOperationsForEntry(db, op.entryId);
      return { conflicted: false };
    }
    throw err;
  }

  if (remote.updated_at !== local.baseUpdatedAt) {
    // Someone else changed it since we last synced — don't overwrite.
    await vaultCache.markConflict(db, op.entryId, remote.ciphertext, remote.updated_at);
    await syncQueue.dequeueOperationsForEntry(db, op.entryId);
    return { conflicted: true };
  }

  const updated = await vaultApi.updateVaultEntry(accessToken, op.entryId, op.payload as string);
  await vaultCache.markSynced(db, op.entryId, { ciphertext: updated.ciphertext, updatedAt: updated.updated_at });
  await syncQueue.dequeueOperation(db, op.id);
  return { conflicted: false };
}

async function handleDelete(
  db: SQLiteDatabaseLike,
  accessToken: string,
  op: PendingOperation
): Promise<void> {
  try {
    await vaultApi.deleteVaultEntry(accessToken, op.entryId);
  } catch (err) {
    if (!(err instanceof ApiError && err.status === 404)) {
      throw err;
    }
    // Already gone server-side — fall through to local cleanup below.
  }
  await vaultCache.deleteEntry(db, op.entryId);
  await syncQueue.dequeueOperation(db, op.id);
}

async function pullRemote(db: SQLiteDatabaseLike, accessToken: string): Promise<void> {
  let remoteEntries: vaultApi.VaultEntryResponse[];
  try {
    remoteEntries = await vaultApi.listVaultEntries(accessToken);
  } catch {
    // Offline or a server error — keep whatever is cached, retry next sync().
    return;
  }

  const localEntries = await vaultCache.getAllEntries(db);
  const localById = new Map(localEntries.map((entry) => [entry.id, entry]));
  const remoteIds = new Set(remoteEntries.map((entry) => String(entry.id)));

  for (const remote of remoteEntries) {
    const id = String(remote.id);
    const local = localById.get(id);

    if (!local) {
      await vaultCache.upsertEntry(db, {
        id,
        ciphertext: remote.ciphertext,
        updatedAt: remote.updated_at,
        baseUpdatedAt: remote.updated_at,
        syncStatus: "synced",
        conflictCiphertext: null,
      });
      continue;
    }

    if (local.syncStatus === "conflict" || local.syncStatus === "pending") {
      // A local edit or an unresolved conflict takes priority — don't
      // clobber it with what the server currently has.
      continue;
    }

    if (remote.updated_at !== local.baseUpdatedAt) {
      await vaultCache.markSynced(db, id, { ciphertext: remote.ciphertext, updatedAt: remote.updated_at });
    }
  }

  for (const local of localEntries) {
    if (!remoteIds.has(local.id) && local.syncStatus !== "pending" && local.syncStatus !== "conflict") {
      // Not a not-yet-created local entry, not an unresolved conflict
      // still waiting for the user to pick a side, and no longer on the
      // server — deleted elsewhere.
      await vaultCache.deleteEntry(db, local.id);
    }
  }
}
