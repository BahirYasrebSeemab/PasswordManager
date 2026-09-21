import { createMemoryStore } from "../testing/memoryStore";
import {
  clearSession,
  expireIfIdle,
  getActiveSession,
  loadSession,
  saveSession,
  type Session,
} from "./session";

const MINUTE = 60_000;
const session: Session = {
  email: "me@example.com",
  vaultKey: new Uint8Array(32).fill(1),
  authKey: new Uint8Array(32).fill(2),
  accessToken: "tok",
  lastActivityAt: 1_000,
};

test("round-trips a session, restoring the key bytes", async () => {
  const store = createMemoryStore();
  await saveSession(store, session);
  const loaded = await loadSession(store);
  expect(loaded).toEqual(session);
  expect(loaded?.vaultKey).toBeInstanceOf(Uint8Array);
});

test("stores keys as base64 strings, never raw bytes", async () => {
  const store = createMemoryStore();
  await saveSession(store, session);
  const stored = store.dump().session as Record<string, unknown>;
  expect(typeof stored.vaultKey).toBe("string");
  expect(typeof stored.authKey).toBe("string");
});

test("loadSession returns null when nothing is stored or the data is malformed", async () => {
  const store = createMemoryStore();
  expect(await loadSession(store)).toBeNull();
  await store.set({ session: { email: 5 } });
  expect(await loadSession(store)).toBeNull();
});

test("clearSession removes the session", async () => {
  const store = createMemoryStore();
  await saveSession(store, session);
  await clearSession(store);
  expect(await loadSession(store)).toBeNull();
});

test("getActiveSession returns the session and refreshes lastActivityAt when within the timeout", async () => {
  const store = createMemoryStore();
  await saveSession(store, session);
  const active = await getActiveSession(store, 1_000 + 10 * MINUTE, 15);
  expect(active?.lastActivityAt).toBe(1_000 + 10 * MINUTE);
  expect((await loadSession(store))?.lastActivityAt).toBe(1_000 + 10 * MINUTE);
});

test("getActiveSession clears and returns null once idle past the timeout", async () => {
  const store = createMemoryStore();
  await saveSession(store, session);
  expect(await getActiveSession(store, 1_000 + 16 * MINUTE, 15)).toBeNull();
  expect(await loadSession(store)).toBeNull();
});

test("getActiveSession returns null when there is no session", async () => {
  expect(await getActiveSession(createMemoryStore(), 5, 15)).toBeNull();
});

test("expireIfIdle clears an expired session without extending a live one", async () => {
  const store = createMemoryStore();
  await saveSession(store, session);
  expect(await expireIfIdle(store, 1_000 + 5 * MINUTE, 15)).toBe(false);
  expect((await loadSession(store))?.lastActivityAt).toBe(1_000);
  expect(await expireIfIdle(store, 1_000 + 16 * MINUTE, 15)).toBe(true);
  expect(await loadSession(store)).toBeNull();
});
