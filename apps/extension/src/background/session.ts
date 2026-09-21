import { base64ToBytes, bytesToBase64 } from "../crypto/base64";

// Subset of browser.storage.StorageArea that we use, so tests can inject a fake.
export interface KeyValueStore {
  get(key: string | null): Promise<Record<string, unknown>>; // null = everything
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface Session {
  email: string;
  vaultKey: Uint8Array;
  authKey: Uint8Array;
  accessToken: string;
  lastActivityAt: number;
}

interface StoredSession {
  email: string;
  vaultKey: string;
  authKey: string;
  accessToken: string;
  lastActivityAt: number;
}

const SESSION_KEY = "session";
const MINUTE_MS = 60_000;

function isStoredSession(value: unknown): value is StoredSession {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.email === "string" &&
    typeof v.vaultKey === "string" &&
    typeof v.authKey === "string" &&
    typeof v.accessToken === "string" &&
    typeof v.lastActivityAt === "number"
  );
}

// storage.session only holds JSON, so key bytes are base64-encoded on the way in.
export async function saveSession(store: KeyValueStore, session: Session): Promise<void> {
  const stored: StoredSession = {
    email: session.email,
    vaultKey: bytesToBase64(session.vaultKey),
    authKey: bytesToBase64(session.authKey),
    accessToken: session.accessToken,
    lastActivityAt: session.lastActivityAt,
  };
  await store.set({ [SESSION_KEY]: stored });
}

export async function loadSession(store: KeyValueStore): Promise<Session | null> {
  const stored = (await store.get(SESSION_KEY))[SESSION_KEY];
  if (!isStoredSession(stored)) return null;
  return {
    email: stored.email,
    vaultKey: base64ToBytes(stored.vaultKey),
    authKey: base64ToBytes(stored.authKey),
    accessToken: stored.accessToken,
    lastActivityAt: stored.lastActivityAt,
  };
}

export async function clearSession(store: KeyValueStore): Promise<void> {
  await store.remove(SESSION_KEY);
}

function isIdle(session: Session, now: number, autoLockMinutes: number): boolean {
  return now - session.lastActivityAt > autoLockMinutes * MINUTE_MS;
}

// Check-on-use idle lock: returns the live session (and records the activity),
// or clears it and returns null when it has been idle past the timeout.
export async function getActiveSession(
  store: KeyValueStore,
  now: number,
  autoLockMinutes: number
): Promise<Session | null> {
  const session = await loadSession(store);
  if (!session) return null;
  if (isIdle(session, now, autoLockMinutes)) {
    await clearSession(store);
    return null;
  }
  const touched = { ...session, lastActivityAt: now };
  await saveSession(store, touched);
  return touched;
}

// Alarm backstop: clears an expired session so a key never lingers past the
// timeout. Deliberately does NOT record activity.
export async function expireIfIdle(
  store: KeyValueStore,
  now: number,
  autoLockMinutes: number
): Promise<boolean> {
  const session = await loadSession(store);
  if (!session || !isIdle(session, now, autoLockMinutes)) return false;
  await clearSession(store);
  return true;
}
