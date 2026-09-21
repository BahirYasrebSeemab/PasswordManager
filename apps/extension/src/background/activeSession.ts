import { getActiveSession, type KeyValueStore, type Session } from "./session";

export interface ActiveSessionDeps {
  store: KeyValueStore;
  pending: { clearAll(): Promise<void> };
  now: () => number;
  getAutoLockMinutes: () => Promise<number>;
}

// Single place the background reads "is the vault unlocked?". getActiveSession
// clears an idle-expired session itself (check-on-use), so when it yields null we
// also drop every parked pending save: a locked vault must hold no plaintext
// credential. This is safe because saves are only ever parked while unlocked.
export function createActiveSessionReader(deps: ActiveSessionDeps): () => Promise<Session | null> {
  return async () => {
    const session = await getActiveSession(deps.store, deps.now(), await deps.getAutoLockMinutes());
    if (!session) await deps.pending.clearAll();
    return session;
  };
}
