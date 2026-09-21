import { createMemoryStore } from "../testing/memoryStore";
import { DEFAULT_AUTO_LOCK_MINUTES, getAutoLockMinutes, setAutoLockMinutes } from "./settings";

test("defaults to 15 minutes", async () => {
  expect(DEFAULT_AUTO_LOCK_MINUTES).toBe(15);
  expect(await getAutoLockMinutes(createMemoryStore())).toBe(15);
});

test("stores a preset value", async () => {
  const store = createMemoryStore();
  expect(await setAutoLockMinutes(store, 30)).toBe(true);
  expect(await getAutoLockMinutes(store)).toBe(30);
});

test("rejects values that are not presets", async () => {
  const store = createMemoryStore();
  expect(await setAutoLockMinutes(store, 7)).toBe(false);
  expect(await getAutoLockMinutes(store)).toBe(15);
});

test("falls back to the default if the stored value is corrupt", async () => {
  const store = createMemoryStore();
  await store.set({ autoLockMinutes: "abc" });
  expect(await getAutoLockMinutes(store)).toBe(15);
});
