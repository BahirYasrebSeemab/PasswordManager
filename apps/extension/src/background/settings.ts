import type { KeyValueStore } from "./session";

export const AUTO_LOCK_PRESETS = [1, 5, 15, 30, 60] as const;
export const DEFAULT_AUTO_LOCK_MINUTES = 15;
const KEY = "autoLockMinutes";

// The timeout is not secret, so it lives in storage.local (persists across restarts).
export async function getAutoLockMinutes(store: KeyValueStore): Promise<number> {
  const value = (await store.get(KEY))[KEY];
  return typeof value === "number" && (AUTO_LOCK_PRESETS as readonly number[]).includes(value)
    ? value
    : DEFAULT_AUTO_LOCK_MINUTES;
}

export async function setAutoLockMinutes(store: KeyValueStore, minutes: number): Promise<boolean> {
  if (!(AUTO_LOCK_PRESETS as readonly number[]).includes(minutes)) return false;
  await store.set({ [KEY]: minutes });
  return true;
}
