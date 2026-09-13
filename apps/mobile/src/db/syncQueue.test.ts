import { createTestDatabase } from "./testUtils";
import { initDatabase } from "./schema";
import * as syncQueue from "./syncQueue";
import type { SQLiteDatabaseLike } from "./types";

let db: SQLiteDatabaseLike;

beforeEach(async () => {
  db = createTestDatabase();
  await initDatabase(db);
});

test("enqueueOperation followed by getQueuedOperations returns it with an assigned id", async () => {
  await syncQueue.enqueueOperation(db, "1", "create", "ct");

  const ops = await syncQueue.getQueuedOperations(db);
  expect(ops).toHaveLength(1);
  expect(ops[0]).toMatchObject({ entryId: "1", op: "create", payload: "ct" });
  expect(typeof ops[0].id).toBe("number");
});

test("getQueuedOperations returns operations in insertion order", async () => {
  await syncQueue.enqueueOperation(db, "1", "create", "ct1");
  await syncQueue.enqueueOperation(db, "2", "create", "ct2");
  await syncQueue.enqueueOperation(db, "1", "update", "ct1-edited");

  const ops = await syncQueue.getQueuedOperations(db);
  expect(ops.map((op) => [op.entryId, op.op])).toEqual([
    ["1", "create"],
    ["2", "create"],
    ["1", "update"],
  ]);
});

test("dequeueOperation removes only the given operation", async () => {
  await syncQueue.enqueueOperation(db, "1", "create", "ct1");
  await syncQueue.enqueueOperation(db, "2", "create", "ct2");
  const [first] = await syncQueue.getQueuedOperations(db);

  await syncQueue.dequeueOperation(db, first.id);

  const remaining = await syncQueue.getQueuedOperations(db);
  expect(remaining).toHaveLength(1);
  expect(remaining[0].entryId).toBe("2");
});

test("dequeueOperationsForEntry removes every queued op for that entry, leaving others", async () => {
  await syncQueue.enqueueOperation(db, "1", "create", "ct1");
  await syncQueue.enqueueOperation(db, "1", "update", "ct1-edited");
  await syncQueue.enqueueOperation(db, "2", "create", "ct2");

  await syncQueue.dequeueOperationsForEntry(db, "1");

  const remaining = await syncQueue.getQueuedOperations(db);
  expect(remaining).toHaveLength(1);
  expect(remaining[0].entryId).toBe("2");
});

test("renameOperationsEntryId updates entry_id on every matching queued op", async () => {
  await syncQueue.enqueueOperation(db, "local-abc", "create", "ct1");
  await syncQueue.enqueueOperation(db, "local-abc", "update", "ct1-edited");
  await syncQueue.enqueueOperation(db, "2", "create", "ct2");

  await syncQueue.renameOperationsEntryId(db, "local-abc", "42");

  const ops = await syncQueue.getQueuedOperations(db);
  expect(ops.map((op) => op.entryId)).toEqual(["42", "42", "2"]);
});
