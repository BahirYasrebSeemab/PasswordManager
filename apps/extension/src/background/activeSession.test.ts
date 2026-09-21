import { createMemoryStore } from "../testing/memoryStore";
import { createActiveSessionReader } from "./activeSession";
import { saveSession, type Session } from "./session";

const MINUTE = 60_000;
const NOW = 10_000_000;

function sessionIdleFor(minutes: number): Session {
  return {
    email: "me@example.com",
    vaultKey: new Uint8Array([1, 2, 3]),
    authKey: new Uint8Array([4, 5, 6]),
    accessToken: "token",
    lastActivityAt: NOW - minutes * MINUTE,
  };
}

function setup(minutes = 15) {
  const store = createMemoryStore();
  const pending = { clearAll: vi.fn().mockResolvedValue(undefined) };
  const read = createActiveSessionReader({
    store,
    pending,
    now: () => NOW,
    getAutoLockMinutes: async () => minutes,
  });
  return { store, pending, read };
}

test("a live session is returned and pending saves are left alone", async () => {
  const { store, pending, read } = setup();
  await saveSession(store, sessionIdleFor(1));
  const session = await read();
  expect(session?.email).toBe("me@example.com");
  expect(pending.clearAll).not.toHaveBeenCalled();
});

test("an expired session is cleared, returns null, and clears pending saves", async () => {
  const { store, pending, read } = setup();
  await saveSession(store, sessionIdleFor(20));
  expect(await read()).toBeNull();
  expect(store.dump()).toEqual({});
  expect(pending.clearAll).toHaveBeenCalledTimes(1);
});

test("no session at all returns null and clears pending saves", async () => {
  const { pending, read } = setup();
  expect(await read()).toBeNull();
  expect(pending.clearAll).toHaveBeenCalledTimes(1);
});

test("the configured auto-lock minutes are honoured", async () => {
  const short = setup(1);
  await saveSession(short.store, sessionIdleFor(2));
  expect(await short.read()).toBeNull();

  const long = setup(5);
  await saveSession(long.store, sessionIdleFor(2));
  expect(await long.read()).not.toBeNull();
});
