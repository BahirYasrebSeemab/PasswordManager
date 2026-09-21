import type { KeyValueStore } from "../background/session";

export function createMemoryStore(): KeyValueStore & { dump(): Record<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    async get(key) {
      if (key === null) return structuredClone(Object.fromEntries(data));
      return data.has(key) ? { [key]: structuredClone(data.get(key)) } : {};
    },
    async set(items) {
      for (const [key, value] of Object.entries(items)) data.set(key, structuredClone(value));
    },
    async remove(key) {
      data.delete(key);
    },
    dump() {
      return Object.fromEntries(data);
    },
  };
}
