import { createMemoryStore } from "../testing/memoryStore";
import { createPendingStore, PENDING_TTL_MS } from "./pendingSave";

const record = { kind: "save" as const, username: "me", password: "pw", pageUrl: "https://example.com/login" };

test("parks and peeks a record per tab, without consuming it", async () => {
  let now = 1000;
  const pending = createPendingStore(createMemoryStore(), () => now);
  await pending.park(5, record);
  expect(await pending.peek(5)).toEqual({ ...record, createdAt: 1000 });
  expect(await pending.peek(5)).not.toBeNull();
  expect(await pending.peek(6)).toBeNull();
});

test("a record expires after the TTL and is removed", async () => {
  let now = 1000;
  const store = createMemoryStore();
  const pending = createPendingStore(store, () => now);
  await pending.park(5, record);
  now = 1000 + PENDING_TTL_MS + 1;
  expect(await pending.peek(5)).toBeNull();
  expect(store.dump()).toEqual({});
});

test("discard removes one tab's record and clearAll removes every pending record", async () => {
  const store = createMemoryStore();
  await store.set({ session: { keep: true } });
  const pending = createPendingStore(store, () => 0);
  await pending.park(1, record);
  await pending.park(2, record);
  await pending.discard(1);
  expect(await pending.peek(1)).toBeNull();
  expect(await pending.peek(2)).not.toBeNull();
  await pending.clearAll();
  expect(await pending.peek(2)).toBeNull();
  expect(store.dump()).toEqual({ session: { keep: true } });
});

test("a malformed stored record is treated as absent", async () => {
  const store = createMemoryStore();
  await store.set({ "pendingSave:3": { kind: "nope" } });
  expect(await createPendingStore(store, () => 0).peek(3)).toBeNull();
});
