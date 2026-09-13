import { DatabaseSync } from "node:sqlite";
import type { SQLiteDatabaseLike, SQLiteRunResult } from "./types";

// See the plan's Global Constraints: real expo-sqlite cannot execute under
// Jest. This wraps Node's built-in node:sqlite (a real, in-memory SQLite
// engine) in the same async 4-method interface production code depends on,
// so every db/ and sync/ test runs real SQL, not a hand-rolled fake.
export function createTestDatabase(): SQLiteDatabaseLike {
  const sync = new DatabaseSync(":memory:");
  return {
    execAsync: async (sql: string) => {
      sync.exec(sql);
    },
    runAsync: async (sql: string, params: unknown[] = []): Promise<SQLiteRunResult> => {
      const result = sync.prepare(sql).run(...(params as never[]));
      return { lastInsertRowId: Number(result.lastInsertRowid), changes: Number(result.changes) };
    },
    getAllAsync: async <T,>(sql: string, params: unknown[] = []): Promise<T[]> => {
      return sync.prepare(sql).all(...(params as never[])) as T[];
    },
    getFirstAsync: async <T,>(sql: string, params: unknown[] = []): Promise<T | null> => {
      const row = sync.prepare(sql).get(...(params as never[]));
      return (row as T | undefined) ?? null;
    },
  };
}
