import type { PendingOp, PendingOperation, SQLiteDatabaseLike } from "./types";

interface PendingOperationRowRaw {
  id: number;
  entry_id: string;
  op: string;
  payload: string | null;
  created_at: string;
}

function mapRow(row: PendingOperationRowRaw): PendingOperation {
  return {
    id: row.id,
    entryId: row.entry_id,
    op: row.op as PendingOp,
    payload: row.payload,
    createdAt: row.created_at,
  };
}

export async function enqueueOperation(
  db: SQLiteDatabaseLike,
  entryId: string,
  op: PendingOp,
  payload: string | null
): Promise<void> {
  await db.runAsync(
    "INSERT INTO pending_operations (entry_id, op, payload, created_at) VALUES (?, ?, ?, ?)",
    [entryId, op, payload, new Date().toISOString()]
  );
}

export async function getQueuedOperations(db: SQLiteDatabaseLike): Promise<PendingOperation[]> {
  const rows = await db.getAllAsync<PendingOperationRowRaw>(
    "SELECT * FROM pending_operations ORDER BY id ASC"
  );
  return rows.map(mapRow);
}

export async function dequeueOperation(db: SQLiteDatabaseLike, id: number): Promise<void> {
  await db.runAsync("DELETE FROM pending_operations WHERE id = ?", [id]);
}

export async function dequeueOperationsForEntry(db: SQLiteDatabaseLike, entryId: string): Promise<void> {
  await db.runAsync("DELETE FROM pending_operations WHERE entry_id = ?", [entryId]);
}

// Called when a queued 'create' succeeds and the entry's temp id is
// replaced by the server's real id (see vaultCache.replaceEntryId). Any
// OTHER queued ops for the same entry still reference the old temp id at
// this point, since they were enqueued before this flush ran — this brings
// them in line so the sync engine's next iteration targets the right id.
export async function renameOperationsEntryId(
  db: SQLiteDatabaseLike,
  oldEntryId: string,
  newEntryId: string
): Promise<void> {
  await db.runAsync("UPDATE pending_operations SET entry_id = ? WHERE entry_id = ?", [
    newEntryId,
    oldEntryId,
  ]);
}
