# Mobile Vault CRUD, Offline Sync, Conflict Resolution & Auto-Lock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the mobile app's vault feature — local SQLite offline cache, a two-phase sync engine with optimistic-concurrency conflict detection, auto-lock on backgrounding, and the CRUD screens that use them.

**Architecture:** A `db/` layer (pure TypeScript, dependency-injected SQLite access) stores ciphertext and a queue of pending API operations. A `sync/` layer flushes that queue against the backend and pulls remote changes, detecting conflicts via an `updated_at` pre-flight check. `VaultContext` wires both into React state and exposes decrypted entries to screens; `AuthContext` gains auto-lock and an exposed `accessToken` that the sync layer needs.

**Tech Stack:** Expo SDK ~57, Expo Router ~57, React 19.2.3, React Native 0.86.3, TypeScript ~6, `expo-sqlite` ~57.0.2 (already installed), Jest + jest-expo + `@testing-library/react-native@14`.

**Spec:** `docs/superpowers/specs/2026-09-13-mobile-vault-sync-design.md`

## Global Constraints

- `@testing-library/react-native@14`'s `render()` is **async** — every call must be `await`ed. This bit Plan 1 repeatedly; every `*.test.tsx` file in this plan must awaited-render from the start.
- Package installs are never done by the implementer — `expo-sqlite` is already in `package.json`/`node_modules` (verified), so no new install is needed for this plan. If a task's implementer believes a new package is required, stop and report it rather than installing anything.
- Run tests with `bun x jest`, never bare `bun test` (Bun's own test runner is a different tool that can't handle this project's ESM/Flow-typed dependencies — see Plan 1's notes).
- The backend's vault `id` field is an **integer** (`apps/api/app/vault/schemas.py`), not a UUID. The local cache stores ids as `TEXT` (string form of the server integer, or a `local-...` temp id pre-sync) — every task below reflects this.
- The backend only ever returns **404** for a missing/not-owned vault entry (`apps/api/app/vault/router.py`'s `_get_owned_entry`) — there is no 410 path. Treat 404 as "gone" everywhere below.
- **Verified fact, not a design choice:** real `expo-sqlite` cannot execute under Jest (confirmed by spiking `openDatabaseAsync(':memory:')` in this repo — it throws `TypeError: _ExpoSQLite.default.NativeDatabase is not a constructor`, since Jest has no native runtime to bind to). All `db/` tests instead run against Node's built-in `node:sqlite` (confirmed working under `bun x jest` in this repo, Node v24.19.0), wrapped in the same 4-method async interface (`SQLiteDatabaseLike`) that the production code (backed by real `expo-sqlite` on-device) depends on. This is real SQL execution against a real in-memory SQLite engine in every test — not a hand-rolled fake — via dependency injection at the one seam that differs between test and production.
- `apps/mobile/src/api/client.ts`'s `apiRequest()` currently calls `response.json()` unconditionally, which throws on a 204 No Content response. The vault `DELETE` endpoint returns 204. Task 5 below fixes this — it's a real gap, not spec creep, and nothing before this plan ever exercised a 204 response.
- The spec's file tree shows the vault list under `app/(app)/(tabs)/index.tsx`. There is no `(tabs)` group in this codebase — Plan 1's cleanup removed the scaffold's tabs template, and the app has used a plain `app/(app)/index.tsx` placeholder ever since. Task 9 below replaces that existing file directly; this is a path correction, not a design change.

---

### Task 1: Local DB types, schema, and the Jest SQLite test double

**Files:**
- Create: `apps/mobile/src/db/types.ts`
- Create: `apps/mobile/src/db/schema.ts`
- Create: `apps/mobile/src/db/testUtils.ts`
- Test: `apps/mobile/src/db/schema.test.ts`

**Interfaces:**
- Produces: `SQLiteDatabaseLike` (the DI seam every later `db/`/`sync/` function takes as its first parameter), `SQLiteRunResult`, `SyncStatus`, `VaultCacheEntry`, `PendingOp`, `PendingOperation` (all from `types.ts`); `initDatabase(db: SQLiteDatabaseLike): Promise<void>` (from `schema.ts`); `createTestDatabase(): SQLiteDatabaseLike` (from `testUtils.ts`, used by every later `db/`/`sync/` test file).

- [ ] **Step 1: Write `src/db/types.ts`**

```ts
export interface SQLiteRunResult {
  lastInsertRowId: number;
  changes: number;
}

// The narrow subset of expo-sqlite's SQLiteDatabase class that db/ and
// sync/ depend on. Real expo-sqlite instances (from SQLite.openDatabaseAsync)
// satisfy this structurally. In tests, testUtils.ts provides a different
// concrete implementation backed by node:sqlite, since real expo-sqlite
// cannot execute under Jest (see the plan's Global Constraints).
export interface SQLiteDatabaseLike {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, params?: unknown[]): Promise<SQLiteRunResult>;
  getAllAsync<T>(sql: string, params?: unknown[]): Promise<T[]>;
  getFirstAsync<T>(sql: string, params?: unknown[]): Promise<T | null>;
}

export type SyncStatus = "synced" | "pending" | "conflict";

export interface VaultCacheEntry {
  id: string;
  ciphertext: string;
  updatedAt: string;
  baseUpdatedAt: string;
  syncStatus: SyncStatus;
  conflictCiphertext: string | null;
}

export type PendingOp = "create" | "update" | "delete";

export interface PendingOperation {
  id: number;
  entryId: string;
  op: PendingOp;
  payload: string | null;
  createdAt: string;
}
```

- [ ] **Step 2: Write `src/db/schema.ts`**

```ts
import type { SQLiteDatabaseLike } from "./types";

export const CREATE_VAULT_ENTRIES_CACHE_TABLE = `
CREATE TABLE IF NOT EXISTS vault_entries_cache (
  id TEXT PRIMARY KEY,
  ciphertext TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  base_updated_at TEXT NOT NULL,
  sync_status TEXT NOT NULL,
  conflict_ciphertext TEXT
)`;

export const CREATE_PENDING_OPERATIONS_TABLE = `
CREATE TABLE IF NOT EXISTS pending_operations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id TEXT NOT NULL,
  op TEXT NOT NULL,
  payload TEXT,
  created_at TEXT NOT NULL
)`;

export async function initDatabase(db: SQLiteDatabaseLike): Promise<void> {
  await db.execAsync(CREATE_VAULT_ENTRIES_CACHE_TABLE);
  await db.execAsync(CREATE_PENDING_OPERATIONS_TABLE);
}
```

- [ ] **Step 3: Write `src/db/testUtils.ts`**

```ts
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
      return { lastInsertRowId: Number(result.lastInsertRowid), changes: result.changes };
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
```

- [ ] **Step 4: Write the failing test `src/db/schema.test.ts`**

```ts
import { createTestDatabase } from "./testUtils";
import { initDatabase } from "./schema";

test("initDatabase creates both tables and they accept inserts", async () => {
  const db = createTestDatabase();

  await initDatabase(db);

  await db.runAsync(
    "INSERT INTO vault_entries_cache (id, ciphertext, updated_at, base_updated_at, sync_status, conflict_ciphertext) VALUES (?, ?, ?, ?, ?, ?)",
    ["1", "ct", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z", "synced", null]
  );
  await db.runAsync(
    "INSERT INTO pending_operations (entry_id, op, payload, created_at) VALUES (?, ?, ?, ?)",
    ["1", "create", "ct", "2026-01-01T00:00:00Z"]
  );

  const entries = await db.getAllAsync("SELECT * FROM vault_entries_cache");
  const ops = await db.getAllAsync("SELECT * FROM pending_operations");
  expect(entries).toHaveLength(1);
  expect(ops).toHaveLength(1);
});

test("initDatabase is idempotent (safe to call twice)", async () => {
  const db = createTestDatabase();

  await initDatabase(db);
  await expect(initDatabase(db)).resolves.toBeUndefined();
});
```

- [ ] **Step 5: Run the tests**

Run: `bun x jest src/db/schema.test.ts`
Expected: PASS (2 passed)

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/db/types.ts apps/mobile/src/db/schema.ts apps/mobile/src/db/testUtils.ts apps/mobile/src/db/schema.test.ts
git commit -m "feat(mobile): add local SQLite schema and a real-SQLite Jest test double"
```

---

### Task 2: `vaultCache.ts`

**Files:**
- Create: `apps/mobile/src/db/vaultCache.ts`
- Test: `apps/mobile/src/db/vaultCache.test.ts`

**Interfaces:**
- Consumes: `SQLiteDatabaseLike`, `VaultCacheEntry`, `SyncStatus` (Task 1's `types.ts`), `initDatabase` (Task 1's `schema.ts`), `createTestDatabase` (Task 1's `testUtils.ts`).
- Produces: `generateLocalId(): string`, `upsertEntry(db, entry: VaultCacheEntry): Promise<void>`, `getAllEntries(db): Promise<VaultCacheEntry[]>`, `getEntry(db, id: string): Promise<VaultCacheEntry | null>`, `deleteEntry(db, id: string): Promise<void>`, `replaceEntryId(db, oldId: string, newId: string): Promise<void>`, `markSynced(db, id: string, fields: { ciphertext: string; updatedAt: string }): Promise<void>`, `markPending(db, id: string, fields: { ciphertext: string; updatedAt: string }): Promise<void>`, `markConflict(db, id: string, conflictCiphertext: string): Promise<void>` — all consumed by Task 6 (`sync/syncEngine.ts`) and Task 7 (`VaultContext.tsx`).

- [ ] **Step 1: Write `src/db/vaultCache.ts`**

```ts
import type { SQLiteDatabaseLike, VaultCacheEntry } from "./types";

interface VaultCacheRowRaw {
  id: string;
  ciphertext: string;
  updated_at: string;
  base_updated_at: string;
  sync_status: string;
  conflict_ciphertext: string | null;
}

function mapRow(row: VaultCacheRowRaw): VaultCacheEntry {
  return {
    id: row.id,
    ciphertext: row.ciphertext,
    updatedAt: row.updated_at,
    baseUpdatedAt: row.base_updated_at,
    syncStatus: row.sync_status as VaultCacheEntry["syncStatus"],
    conflictCiphertext: row.conflict_ciphertext,
  };
}

// Local-only temp id for an entry created offline, before the server has
// assigned it a real (integer) id. Never collides with a real id, which is
// always a plain digit string.
export function generateLocalId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `local-${hex}`;
}

export async function upsertEntry(db: SQLiteDatabaseLike, entry: VaultCacheEntry): Promise<void> {
  await db.runAsync(
    `INSERT INTO vault_entries_cache (id, ciphertext, updated_at, base_updated_at, sync_status, conflict_ciphertext)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       ciphertext = excluded.ciphertext,
       updated_at = excluded.updated_at,
       base_updated_at = excluded.base_updated_at,
       sync_status = excluded.sync_status,
       conflict_ciphertext = excluded.conflict_ciphertext`,
    [entry.id, entry.ciphertext, entry.updatedAt, entry.baseUpdatedAt, entry.syncStatus, entry.conflictCiphertext]
  );
}

export async function getAllEntries(db: SQLiteDatabaseLike): Promise<VaultCacheEntry[]> {
  const rows = await db.getAllAsync<VaultCacheRowRaw>(
    "SELECT * FROM vault_entries_cache ORDER BY updated_at DESC"
  );
  return rows.map(mapRow);
}

export async function getEntry(db: SQLiteDatabaseLike, id: string): Promise<VaultCacheEntry | null> {
  const row = await db.getFirstAsync<VaultCacheRowRaw>(
    "SELECT * FROM vault_entries_cache WHERE id = ?",
    [id]
  );
  return row ? mapRow(row) : null;
}

export async function deleteEntry(db: SQLiteDatabaseLike, id: string): Promise<void> {
  await db.runAsync("DELETE FROM vault_entries_cache WHERE id = ?", [id]);
}

export async function replaceEntryId(db: SQLiteDatabaseLike, oldId: string, newId: string): Promise<void> {
  await db.runAsync("UPDATE vault_entries_cache SET id = ? WHERE id = ?", [newId, oldId]);
}

export async function markSynced(
  db: SQLiteDatabaseLike,
  id: string,
  fields: { ciphertext: string; updatedAt: string }
): Promise<void> {
  await db.runAsync(
    `UPDATE vault_entries_cache
     SET ciphertext = ?, updated_at = ?, base_updated_at = ?, sync_status = 'synced', conflict_ciphertext = NULL
     WHERE id = ?`,
    [fields.ciphertext, fields.updatedAt, fields.updatedAt, id]
  );
}

// Records a local, not-yet-pushed edit. Deliberately does NOT touch
// base_updated_at — it must stay at the last server-confirmed value so the
// sync engine's pre-flight conflict check (comparing the server's live
// updated_at to base_updated_at) stays meaningful.
export async function markPending(
  db: SQLiteDatabaseLike,
  id: string,
  fields: { ciphertext: string; updatedAt: string }
): Promise<void> {
  await db.runAsync(
    "UPDATE vault_entries_cache SET ciphertext = ?, updated_at = ?, sync_status = 'pending' WHERE id = ?",
    [fields.ciphertext, fields.updatedAt, id]
  );
}

export async function markConflict(
  db: SQLiteDatabaseLike,
  id: string,
  conflictCiphertext: string
): Promise<void> {
  await db.runAsync(
    "UPDATE vault_entries_cache SET sync_status = 'conflict', conflict_ciphertext = ? WHERE id = ?",
    [conflictCiphertext, id]
  );
}
```

- [ ] **Step 2: Write the failing test `src/db/vaultCache.test.ts`**

```ts
import { createTestDatabase } from "./testUtils";
import { initDatabase } from "./schema";
import * as vaultCache from "./vaultCache";
import type { SQLiteDatabaseLike, VaultCacheEntry } from "./types";

let db: SQLiteDatabaseLike;

beforeEach(async () => {
  db = createTestDatabase();
  await initDatabase(db);
});

function makeEntry(overrides: Partial<VaultCacheEntry> = {}): VaultCacheEntry {
  return {
    id: "1",
    ciphertext: "ct-v1",
    updatedAt: "2026-01-01T00:00:00Z",
    baseUpdatedAt: "2026-01-01T00:00:00Z",
    syncStatus: "synced",
    conflictCiphertext: null,
    ...overrides,
  };
}

test("generateLocalId returns a 'local-' prefixed id that never matches a real numeric id", () => {
  const id = vaultCache.generateLocalId();
  expect(id).toMatch(/^local-[0-9a-f]{32}$/);
});

test("upsertEntry inserts a new row that getEntry can read back", async () => {
  await vaultCache.upsertEntry(db, makeEntry());

  const entry = await vaultCache.getEntry(db, "1");
  expect(entry).toEqual(makeEntry());
});

test("upsertEntry on an existing id updates the row instead of erroring", async () => {
  await vaultCache.upsertEntry(db, makeEntry());
  await vaultCache.upsertEntry(db, makeEntry({ ciphertext: "ct-v2" }));

  const entry = await vaultCache.getEntry(db, "1");
  expect(entry?.ciphertext).toBe("ct-v2");
  expect(await vaultCache.getAllEntries(db)).toHaveLength(1);
});

test("getEntry returns null for a missing id", async () => {
  expect(await vaultCache.getEntry(db, "missing")).toBeNull();
});

test("getAllEntries returns every row", async () => {
  await vaultCache.upsertEntry(db, makeEntry({ id: "1" }));
  await vaultCache.upsertEntry(db, makeEntry({ id: "2" }));

  expect(await vaultCache.getAllEntries(db)).toHaveLength(2);
});

test("deleteEntry removes the row", async () => {
  await vaultCache.upsertEntry(db, makeEntry());
  await vaultCache.deleteEntry(db, "1");

  expect(await vaultCache.getEntry(db, "1")).toBeNull();
});

test("replaceEntryId renames the primary key", async () => {
  await vaultCache.upsertEntry(db, makeEntry({ id: "local-abc" }));
  await vaultCache.replaceEntryId(db, "local-abc", "42");

  expect(await vaultCache.getEntry(db, "local-abc")).toBeNull();
  expect(await vaultCache.getEntry(db, "42")).not.toBeNull();
});

test("markSynced sets ciphertext/updatedAt/baseUpdatedAt and clears conflict state", async () => {
  await vaultCache.upsertEntry(db, makeEntry({ syncStatus: "conflict", conflictCiphertext: "ct-theirs" }));

  await vaultCache.markSynced(db, "1", { ciphertext: "ct-final", updatedAt: "2026-02-01T00:00:00Z" });

  const entry = await vaultCache.getEntry(db, "1");
  expect(entry).toEqual(
    makeEntry({
      ciphertext: "ct-final",
      updatedAt: "2026-02-01T00:00:00Z",
      baseUpdatedAt: "2026-02-01T00:00:00Z",
      syncStatus: "synced",
      conflictCiphertext: null,
    })
  );
});

test("markPending updates ciphertext/updatedAt/status but leaves baseUpdatedAt untouched", async () => {
  await vaultCache.upsertEntry(db, makeEntry());

  await vaultCache.markPending(db, "1", { ciphertext: "ct-edited", updatedAt: "2026-02-01T00:00:00Z" });

  const entry = await vaultCache.getEntry(db, "1");
  expect(entry?.ciphertext).toBe("ct-edited");
  expect(entry?.updatedAt).toBe("2026-02-01T00:00:00Z");
  expect(entry?.baseUpdatedAt).toBe("2026-01-01T00:00:00Z");
  expect(entry?.syncStatus).toBe("pending");
});

test("markConflict sets status to conflict and stores the server's ciphertext", async () => {
  await vaultCache.upsertEntry(db, makeEntry());

  await vaultCache.markConflict(db, "1", "ct-theirs");

  const entry = await vaultCache.getEntry(db, "1");
  expect(entry?.syncStatus).toBe("conflict");
  expect(entry?.conflictCiphertext).toBe("ct-theirs");
});
```

- [ ] **Step 3: Run the tests**

Run: `bun x jest src/db/vaultCache.test.ts`
Expected: PASS (11 passed)

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/db/vaultCache.ts apps/mobile/src/db/vaultCache.test.ts
git commit -m "feat(mobile): add vaultCache read/write functions over the local SQLite cache"
```

---

### Task 3: `syncQueue.ts`

**Files:**
- Create: `apps/mobile/src/db/syncQueue.ts`
- Test: `apps/mobile/src/db/syncQueue.test.ts`

**Interfaces:**
- Consumes: `SQLiteDatabaseLike`, `PendingOp`, `PendingOperation` (Task 1's `types.ts`), `initDatabase`, `createTestDatabase`.
- Produces: `enqueueOperation(db, entryId: string, op: PendingOp, payload: string | null): Promise<void>`, `getQueuedOperations(db): Promise<PendingOperation[]>`, `dequeueOperation(db, id: number): Promise<void>`, `dequeueOperationsForEntry(db, entryId: string): Promise<void>`, `renameOperationsEntryId(db, oldEntryId: string, newEntryId: string): Promise<void>` — all consumed by Task 6 (`sync/syncEngine.ts`) and Task 7 (`VaultContext.tsx`).

- [ ] **Step 1: Write `src/db/syncQueue.ts`**

```ts
import type { PendingOp, PendingOperation, SQLiteDatabaseLike } from "./types";

interface PendingOperationRowRaw {
  id: number;
  entry_id: string;
  op: string;
  payload: string | null;
  created_at: string;
}

function mapRow(row: PendingOperationRowRaw): PendingOperation {
  return {
    id: row.id,
    entryId: row.entry_id,
    op: row.op as PendingOp,
    payload: row.payload,
    createdAt: row.created_at,
  };
}

export async function enqueueOperation(
  db: SQLiteDatabaseLike,
  entryId: string,
  op: PendingOp,
  payload: string | null
): Promise<void> {
  await db.runAsync(
    "INSERT INTO pending_operations (entry_id, op, payload, created_at) VALUES (?, ?, ?, ?)",
    [entryId, op, payload, new Date().toISOString()]
  );
}

export async function getQueuedOperations(db: SQLiteDatabaseLike): Promise<PendingOperation[]> {
  const rows = await db.getAllAsync<PendingOperationRowRaw>(
    "SELECT * FROM pending_operations ORDER BY id ASC"
  );
  return rows.map(mapRow);
}

export async function dequeueOperation(db: SQLiteDatabaseLike, id: number): Promise<void> {
  await db.runAsync("DELETE FROM pending_operations WHERE id = ?", [id]);
}

export async function dequeueOperationsForEntry(db: SQLiteDatabaseLike, entryId: string): Promise<void> {
  await db.runAsync("DELETE FROM pending_operations WHERE entry_id = ?", [entryId]);
}

// Called when a queued 'create' succeeds and the entry's temp id is
// replaced by the server's real id (see vaultCache.replaceEntryId). Any
// OTHER queued ops for the same entry still reference the old temp id at
// this point, since they were enqueued before this flush ran — this brings
// them in line so the sync engine's next iteration targets the right id.
export async function renameOperationsEntryId(
  db: SQLiteDatabaseLike,
  oldEntryId: string,
  newEntryId: string
): Promise<void> {
  await db.runAsync("UPDATE pending_operations SET entry_id = ? WHERE entry_id = ?", [
    newEntryId,
    oldEntryId,
  ]);
}
```

- [ ] **Step 2: Write the failing test `src/db/syncQueue.test.ts`**

```ts
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
```

- [ ] **Step 3: Run the tests**

Run: `bun x jest src/db/syncQueue.test.ts`
Expected: PASS (5 passed)

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/db/syncQueue.ts apps/mobile/src/db/syncQueue.test.ts
git commit -m "feat(mobile): add the pending_operations queue read/write functions"
```

---

### Task 4: Expose `accessToken` from `AuthContext`

**Files:**
- Modify: `apps/mobile/src/context/AuthContext.tsx`
- Modify: `apps/mobile/src/context/AuthContext.test.tsx`

**Interfaces:**
- Produces: `AuthContextValue.accessToken: string | null` — consumed by Task 7 (`VaultContext.tsx`) to authenticate vault API calls.

**Why this is its own task:** `AuthContext` derives an access token internally (via `register`/`login`/`unlockWithStoredSession`) but never stores it in component state — it's only ever passed transiently to `saveSession`/`updateAccessToken`. `VaultContext` needs the current token to call the vault API, and re-reading it from `SecureStore` on every vault action would re-trigger the biometric prompt each time (`session.ts`'s reads all use `requireAuthentication: true`). Tracking it in state, set at the same points `vaultKey` already is, avoids that.

- [ ] **Step 1: Modify `src/context/AuthContext.tsx` — add `accessToken` to the interface and state**

In the `AuthContextValue` interface, add the field:

```ts
interface AuthContextValue {
  status: Status;
  user: User | null;
  vaultKey: Uint8Array | null;
  accessToken: string | null;
  register: (email: string, masterPassword: string) => Promise<void>;
  login: (email: string, masterPassword: string) => Promise<void>;
  unlockWithStoredSession: () => Promise<void>;
  logout: () => Promise<void>;
}
```

Add the state declaration alongside the existing ones:

```ts
const [accessToken, setAccessToken] = useState<string | null>(null);
```

- [ ] **Step 2: Set `accessToken` at every point `vaultKey`/`user` are currently set**

In `unlockWithStoredSession`'s fast path (right after `setVaultKey(stored.vaultKey);`, before the inner try):

```ts
setVaultKey(stored.vaultKey);
```

stays as-is; inside the inner try's success branch, add the token:

```ts
const me = await getMe(stored.accessToken);
setUser(me);
setAccessToken(stored.accessToken);
setStatus("unlocked");
```

In the 401 fallback branch:

```ts
const { access_token } = await apiLogin(stored.email, stored.authKey);
await updateAccessToken(access_token);
const me = await getMe(access_token);
setUser(me);
setAccessToken(access_token);
setStatus("unlocked");
```

In the outer catch (failure path), clear it alongside the others:

```ts
} catch {
  setVaultKey(null);
  setUser(null);
  setAccessToken(null);
  setStatus("locked");
}
```

In `register`:

```ts
const { access_token } = await apiRegister(email, authKey);
await saveSession({ vaultKey: newVaultKey, authKey, accessToken: access_token, email });
const me = await getMe(access_token);
setVaultKey(newVaultKey);
setUser(me);
setAccessToken(access_token);
setStatus("unlocked");
```

In `login`, the same pattern as `register` — add `setAccessToken(access_token);` right before `setStatus("unlocked");`.

In `logout`:

```ts
const logout = useCallback(async () => {
  await clearSession();
  setVaultKey(null);
  setUser(null);
  setAccessToken(null);
  setStatus("locked");
}, []);
```

- [ ] **Step 3: Add `accessToken` to the provider's context value**

```tsx
<AuthContext.Provider
  value={{ status, user, vaultKey, accessToken, register, login, unlockWithStoredSession, logout }}
>
```

- [ ] **Step 4: Write the failing test — add a new test to `src/context/AuthContext.test.tsx`**

Add this test after the existing `"register() derives keys..."` test:

```ts
test("register() exposes the returned access token via accessToken", async () => {
  (session.loadSession as jest.Mock).mockResolvedValue(null);
  (authApi.register as jest.Mock).mockResolvedValue({ access_token: "tok-abc", token_type: "bearer" });
  (authApi.getMe as jest.Mock).mockResolvedValue({ id: 1, email: "test@example.com" });
  (session.saveSession as jest.Mock).mockResolvedValue(undefined);

  let auth: ReturnType<typeof useAuth> | undefined;
  function Capture() {
    auth = useAuth();
    return <Probe />;
  }

  await render(
    <AuthProvider>
      <Capture />
    </AuthProvider>
  );
  await waitFor(() => expect(screen.getByTestId("status").props.children).toBe("locked"));

  await act(async () => {
    await auth!.register("test@example.com", "a strong master password");
  });

  expect(auth!.accessToken).toBe("tok-abc");
});

test("logout() clears accessToken back to null", async () => {
  (session.loadSession as jest.Mock).mockResolvedValue(null);
  (authApi.register as jest.Mock).mockResolvedValue({ access_token: "tok-abc", token_type: "bearer" });
  (authApi.getMe as jest.Mock).mockResolvedValue({ id: 1, email: "test@example.com" });
  (session.saveSession as jest.Mock).mockResolvedValue(undefined);
  (session.clearSession as jest.Mock).mockResolvedValue(undefined);

  let auth: ReturnType<typeof useAuth> | undefined;
  function Capture() {
    auth = useAuth();
    return <Probe />;
  }

  await render(
    <AuthProvider>
      <Capture />
    </AuthProvider>
  );
  await waitFor(() => expect(screen.getByTestId("status").props.children).toBe("locked"));
  await act(async () => {
    await auth!.register("test@example.com", "a strong master password");
  });
  expect(auth!.accessToken).toBe("tok-abc");

  await act(async () => {
    await auth!.logout();
  });

  expect(auth!.accessToken).toBeNull();
});
```

- [ ] **Step 5: Run the tests**

Run: `bun x jest src/context/AuthContext.test.tsx`
Expected: PASS (all tests, including the 2 new ones)

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/context/AuthContext.tsx apps/mobile/src/context/AuthContext.test.tsx
git commit -m "feat(mobile): expose accessToken from AuthContext for the vault sync layer"
```

---

### Task 5: Vault API client + `apiRequest`'s 204 fix

**Files:**
- Modify: `apps/mobile/src/api/client.ts`
- Create: `apps/mobile/src/api/client.test.ts`
- Create: `apps/mobile/src/api/vault.ts`
- Create: `apps/mobile/src/api/vault.test.ts`

**Interfaces:**
- Consumes: `apiRequest`, `ApiError` (Task modifies `client.ts` in place — no new exports beyond the fix).
- Produces: `VaultEntryResponse { id: number; ciphertext: string; created_at: string; updated_at: string }`, `createVaultEntry(accessToken, ciphertext): Promise<VaultEntryResponse>`, `listVaultEntries(accessToken): Promise<VaultEntryResponse[]>`, `getVaultEntry(accessToken, id: string): Promise<VaultEntryResponse>`, `updateVaultEntry(accessToken, id: string, ciphertext): Promise<VaultEntryResponse>`, `deleteVaultEntry(accessToken, id: string): Promise<void>` (all from `vault.ts`) — consumed by Task 6 (`sync/syncEngine.ts`).

- [ ] **Step 1: Write the failing test for the 204 fix — `src/api/client.test.ts`**

```ts
import { apiRequest, ApiError } from "./client";

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  jest.restoreAllMocks();
});

function mockFetchOnce(status: number, body: unknown | undefined) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      if (body === undefined) {
        throw new SyntaxError("Unexpected end of JSON input");
      }
      return body;
    },
  }) as unknown as typeof fetch;
}

test("apiRequest returns the parsed body on a normal 200 response", async () => {
  mockFetchOnce(200, { hello: "world" });

  const result = await apiRequest("/anything");

  expect(result).toEqual({ hello: "world" });
});

test("apiRequest throws ApiError with the parsed detail on a non-2xx JSON response", async () => {
  mockFetchOnce(404, { detail: "not found" });

  await expect(apiRequest("/anything")).rejects.toMatchObject({ status: 404, detail: "not found" });
});

test("apiRequest returns undefined for a 204 No Content response, without calling response.json()", async () => {
  mockFetchOnce(204, undefined);

  await expect(apiRequest("/anything", { method: "DELETE" })).resolves.toBeUndefined();
});

test("apiRequest throws ApiError for a non-ok 204-like empty response", async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 204 }) as unknown as typeof fetch;

  await expect(apiRequest("/anything")).rejects.toBeInstanceOf(ApiError);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun x jest src/api/client.test.ts`
Expected: FAIL — the 204 tests fail because `apiRequest` currently calls `response.json()` unconditionally.

- [ ] **Step 3: Fix `src/api/client.ts`**

Replace the body of `apiRequest` from the `fetch` call onward with:

```ts
export async function apiRequest<T>(
  path: string,
  options: { method?: string; body?: unknown; accessToken?: string } = {}
): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (options.accessToken) {
    headers.Authorization = `Bearer ${options.accessToken}`;
  }

  const response = await fetch(`${BASE_URL}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  // A 204 No Content response (the vault DELETE endpoint's success case)
  // has no body — calling response.json() on it throws. Handle it before
  // attempting to parse anything.
  if (response.status === 204) {
    if (!response.ok) {
      throw new ApiError(response.status, undefined);
    }
    return undefined as T;
  }

  const data = await response.json();

  if (!response.ok) {
    throw new ApiError(response.status, (data as { detail?: unknown }).detail);
  }

  return data as T;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun x jest src/api/client.test.ts`
Expected: PASS (4 passed)

- [ ] **Step 5: Write `src/api/vault.ts`**

```ts
import { apiRequest } from "./client";

export interface VaultEntryResponse {
  id: number;
  ciphertext: string;
  created_at: string;
  updated_at: string;
}

export function createVaultEntry(accessToken: string, ciphertext: string): Promise<VaultEntryResponse> {
  return apiRequest<VaultEntryResponse>("/vault", {
    method: "POST",
    accessToken,
    body: { ciphertext },
  });
}

export function listVaultEntries(accessToken: string): Promise<VaultEntryResponse[]> {
  return apiRequest<VaultEntryResponse[]>("/vault", { accessToken });
}

export function getVaultEntry(accessToken: string, id: string): Promise<VaultEntryResponse> {
  return apiRequest<VaultEntryResponse>(`/vault/${id}`, { accessToken });
}

export function updateVaultEntry(
  accessToken: string,
  id: string,
  ciphertext: string
): Promise<VaultEntryResponse> {
  return apiRequest<VaultEntryResponse>(`/vault/${id}`, {
    method: "PUT",
    accessToken,
    body: { ciphertext },
  });
}

export function deleteVaultEntry(accessToken: string, id: string): Promise<void> {
  return apiRequest<void>(`/vault/${id}`, { method: "DELETE", accessToken });
}
```

- [ ] **Step 6: Write the failing test `src/api/vault.test.ts`**

```ts
import { createVaultEntry, listVaultEntries, getVaultEntry, updateVaultEntry, deleteVaultEntry } from "./vault";
import { ApiError } from "./client";

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  jest.restoreAllMocks();
});

function mockFetchOnce(status: number, body: unknown | undefined) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      if (body === undefined) throw new SyntaxError("no body");
      return body;
    },
  }) as unknown as typeof fetch;
}

const ENTRY = { id: 1, ciphertext: "ct", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" };

test("createVaultEntry POSTs to /vault with the bearer token and ciphertext body", async () => {
  mockFetchOnce(201, ENTRY);

  const result = await createVaultEntry("tok", "ct");

  expect(result).toEqual(ENTRY);
  const [url, options] = (global.fetch as jest.Mock).mock.calls[0];
  expect(url).toContain("/vault");
  expect(options.method).toBe("POST");
  expect(options.headers.Authorization).toBe("Bearer tok");
  expect(JSON.parse(options.body)).toEqual({ ciphertext: "ct" });
});

test("listVaultEntries GETs /vault and returns the array", async () => {
  mockFetchOnce(200, [ENTRY]);

  const result = await listVaultEntries("tok");

  expect(result).toEqual([ENTRY]);
});

test("getVaultEntry GETs /vault/{id}", async () => {
  mockFetchOnce(200, ENTRY);

  const result = await getVaultEntry("tok", "1");

  expect(result).toEqual(ENTRY);
  const [url] = (global.fetch as jest.Mock).mock.calls[0];
  expect(url).toContain("/vault/1");
});

test("getVaultEntry throws ApiError with status 404 when the entry doesn't exist", async () => {
  mockFetchOnce(404, { detail: "Vault entry not found" });

  await expect(getVaultEntry("tok", "999")).rejects.toMatchObject({ status: 404 });
});

test("updateVaultEntry PUTs /vault/{id} with the new ciphertext", async () => {
  mockFetchOnce(200, ENTRY);

  await updateVaultEntry("tok", "1", "ct-new");

  const [url, options] = (global.fetch as jest.Mock).mock.calls[0];
  expect(url).toContain("/vault/1");
  expect(options.method).toBe("PUT");
  expect(JSON.parse(options.body)).toEqual({ ciphertext: "ct-new" });
});

test("deleteVaultEntry DELETEs /vault/{id} and resolves to undefined on 204", async () => {
  mockFetchOnce(204, undefined);

  await expect(deleteVaultEntry("tok", "1")).resolves.toBeUndefined();
  const [url, options] = (global.fetch as jest.Mock).mock.calls[0];
  expect(url).toContain("/vault/1");
  expect(options.method).toBe("DELETE");
});

test("deleteVaultEntry throws ApiError instance on failure", async () => {
  mockFetchOnce(404, { detail: "Vault entry not found" });

  await expect(deleteVaultEntry("tok", "999")).rejects.toBeInstanceOf(ApiError);
});
```

- [ ] **Step 7: Run the tests**

Run: `bun x jest src/api/vault.test.ts src/api/client.test.ts`
Expected: PASS (all)

- [ ] **Step 8: Commit**

```bash
git add apps/mobile/src/api/client.ts apps/mobile/src/api/client.test.ts apps/mobile/src/api/vault.ts apps/mobile/src/api/vault.test.ts
git commit -m "fix(mobile): handle 204 responses in apiRequest; add the typed vault API client"
```

---

### Task 6: `sync/syncEngine.ts`

**Files:**
- Create: `apps/mobile/src/sync/syncEngine.ts`
- Test: `apps/mobile/src/sync/syncEngine.test.ts`

**Interfaces:**
- Consumes: everything from Task 1-3 (`db/types.ts`, `db/schema.ts`, `db/vaultCache.ts`, `db/syncQueue.ts`, `db/testUtils.ts`) and Task 5 (`api/vault.ts`'s functions and `VaultEntryResponse`, `api/client.ts`'s `ApiError`).
- Produces: `sync(db: SQLiteDatabaseLike, accessToken: string): Promise<void>` — consumed by Task 7 (`VaultContext.tsx`). Never throws.

- [ ] **Step 1: Write `src/sync/syncEngine.ts`**

```ts
import type { PendingOperation, SQLiteDatabaseLike } from "@/db/types";
import * as vaultCache from "@/db/vaultCache";
import * as syncQueue from "@/db/syncQueue";
import * as vaultApi from "@/api/vault";
import { ApiError } from "@/api/client";

export async function sync(db: SQLiteDatabaseLike, accessToken: string): Promise<void> {
  await flushQueue(db, accessToken);
  await pullRemote(db, accessToken);
}

async function flushQueue(db: SQLiteDatabaseLike, accessToken: string): Promise<void> {
  const ops = await syncQueue.getQueuedOperations(db);
  const skipEntryIds = new Set<string>();

  for (const op of ops) {
    if (skipEntryIds.has(op.entryId)) continue;

    try {
      if (op.op === "create") {
        await handleCreate(db, accessToken, op);
      } else if (op.op === "update") {
        const { conflicted } = await handleUpdate(db, accessToken, op);
        if (conflicted) skipEntryIds.add(op.entryId);
      } else {
        await handleDelete(db, accessToken, op);
      }
    } catch {
      // Network failure or an unexpected server error: leave this op
      // queued (retried on the next sync() call) and skip any later ops
      // for the same entry, so they don't get applied out of order.
      skipEntryIds.add(op.entryId);
    }
  }
}

async function handleCreate(
  db: SQLiteDatabaseLike,
  accessToken: string,
  op: PendingOperation
): Promise<void> {
  const created = await vaultApi.createVaultEntry(accessToken, op.payload as string);
  const realId = String(created.id);

  await vaultCache.replaceEntryId(db, op.entryId, realId);
  await syncQueue.renameOperationsEntryId(db, op.entryId, realId);
  await vaultCache.markSynced(db, realId, { ciphertext: created.ciphertext, updatedAt: created.updated_at });
  await syncQueue.dequeueOperation(db, op.id);
}

async function handleUpdate(
  db: SQLiteDatabaseLike,
  accessToken: string,
  op: PendingOperation
): Promise<{ conflicted: boolean }> {
  const local = await vaultCache.getEntry(db, op.entryId);
  if (!local) {
    // The cache row is already gone (e.g. deleted locally after this
    // update was queued) — nothing left to push.
    await syncQueue.dequeueOperation(db, op.id);
    return { conflicted: false };
  }

  let remote: vaultApi.VaultEntryResponse;
  try {
    remote = await vaultApi.getVaultEntry(accessToken, op.entryId);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      // Deleted on another device — nothing to resolve, just clean up.
      await vaultCache.deleteEntry(db, op.entryId);
      await syncQueue.dequeueOperationsForEntry(db, op.entryId);
      return { conflicted: false };
    }
    throw err;
  }

  if (remote.updated_at !== local.baseUpdatedAt) {
    // Someone else changed it since we last synced — don't overwrite.
    await vaultCache.markConflict(db, op.entryId, remote.ciphertext);
    await syncQueue.dequeueOperationsForEntry(db, op.entryId);
    return { conflicted: true };
  }

  const updated = await vaultApi.updateVaultEntry(accessToken, op.entryId, op.payload as string);
  await vaultCache.markSynced(db, op.entryId, { ciphertext: updated.ciphertext, updatedAt: updated.updated_at });
  await syncQueue.dequeueOperation(db, op.id);
  return { conflicted: false };
}

async function handleDelete(
  db: SQLiteDatabaseLike,
  accessToken: string,
  op: PendingOperation
): Promise<void> {
  try {
    await vaultApi.deleteVaultEntry(accessToken, op.entryId);
  } catch (err) {
    if (!(err instanceof ApiError && err.status === 404)) {
      throw err;
    }
    // Already gone server-side — fall through to local cleanup below.
  }
  await vaultCache.deleteEntry(db, op.entryId);
  await syncQueue.dequeueOperation(db, op.id);
}

async function pullRemote(db: SQLiteDatabaseLike, accessToken: string): Promise<void> {
  let remoteEntries: vaultApi.VaultEntryResponse[];
  try {
    remoteEntries = await vaultApi.listVaultEntries(accessToken);
  } catch {
    // Offline or a server error — keep whatever is cached, retry next sync().
    return;
  }

  const localEntries = await vaultCache.getAllEntries(db);
  const localById = new Map(localEntries.map((entry) => [entry.id, entry]));
  const remoteIds = new Set(remoteEntries.map((entry) => String(entry.id)));

  for (const remote of remoteEntries) {
    const id = String(remote.id);
    const local = localById.get(id);

    if (!local) {
      await vaultCache.upsertEntry(db, {
        id,
        ciphertext: remote.ciphertext,
        updatedAt: remote.updated_at,
        baseUpdatedAt: remote.updated_at,
        syncStatus: "synced",
        conflictCiphertext: null,
      });
      continue;
    }

    if (local.syncStatus === "conflict" || local.syncStatus === "pending") {
      // A local edit or an unresolved conflict takes priority — don't
      // clobber it with what the server currently has.
      continue;
    }

    if (remote.updated_at !== local.baseUpdatedAt) {
      await vaultCache.markSynced(db, id, { ciphertext: remote.ciphertext, updatedAt: remote.updated_at });
    }
  }

  for (const local of localEntries) {
    if (!remoteIds.has(local.id) && local.syncStatus !== "pending") {
      // Not a not-yet-created local entry, and no longer on the server —
      // deleted elsewhere.
      await vaultCache.deleteEntry(db, local.id);
    }
  }
}
```

- [ ] **Step 2: Write the failing test `src/sync/syncEngine.test.ts`**

```ts
import { createTestDatabase } from "@/db/testUtils";
import { initDatabase } from "@/db/schema";
import * as vaultCache from "@/db/vaultCache";
import * as syncQueue from "@/db/syncQueue";
import { sync } from "./syncEngine";
import type { SQLiteDatabaseLike } from "@/db/types";

jest.mock("@/api/vault");
import * as vaultApi from "@/api/vault";
import { ApiError } from "@/api/client";

let db: SQLiteDatabaseLike;

beforeEach(async () => {
  db = createTestDatabase();
  await initDatabase(db);
  jest.clearAllMocks();
});

test("flushes a queued create: replaces the temp id, marks synced, dequeues", async () => {
  await vaultCache.upsertEntry(db, {
    id: "local-abc",
    ciphertext: "ct-new",
    updatedAt: "2026-01-01T00:00:00Z",
    baseUpdatedAt: "2026-01-01T00:00:00Z",
    syncStatus: "pending",
    conflictCiphertext: null,
  });
  await syncQueue.enqueueOperation(db, "local-abc", "create", "ct-new");
  (vaultApi.createVaultEntry as jest.Mock).mockResolvedValue({
    id: 42,
    ciphertext: "ct-new",
    created_at: "2026-01-02T00:00:00Z",
    updated_at: "2026-01-02T00:00:00Z",
  });
  (vaultApi.listVaultEntries as jest.Mock).mockResolvedValue([
    { id: 42, ciphertext: "ct-new", created_at: "2026-01-02T00:00:00Z", updated_at: "2026-01-02T00:00:00Z" },
  ]);

  await sync(db, "tok");

  expect(await vaultCache.getEntry(db, "local-abc")).toBeNull();
  const entry = await vaultCache.getEntry(db, "42");
  expect(entry).toMatchObject({ syncStatus: "synced", updatedAt: "2026-01-02T00:00:00Z" });
  expect(await syncQueue.getQueuedOperations(db)).toHaveLength(0);
});

test("flushes a queued update when the server is unchanged since our base_updated_at", async () => {
  await vaultCache.upsertEntry(db, {
    id: "1",
    ciphertext: "ct-edited",
    updatedAt: "2026-01-02T00:00:00Z",
    baseUpdatedAt: "2026-01-01T00:00:00Z",
    syncStatus: "pending",
    conflictCiphertext: null,
  });
  await syncQueue.enqueueOperation(db, "1", "update", "ct-edited");
  (vaultApi.getVaultEntry as jest.Mock).mockResolvedValue({
    id: 1,
    ciphertext: "ct-old",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  });
  (vaultApi.updateVaultEntry as jest.Mock).mockResolvedValue({
    id: 1,
    ciphertext: "ct-edited",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-03T00:00:00Z",
  });
  (vaultApi.listVaultEntries as jest.Mock).mockResolvedValue([
    { id: 1, ciphertext: "ct-edited", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-03T00:00:00Z" },
  ]);

  await sync(db, "tok");

  const entry = await vaultCache.getEntry(db, "1");
  expect(entry).toMatchObject({ syncStatus: "synced", updatedAt: "2026-01-03T00:00:00Z" });
  expect(await syncQueue.getQueuedOperations(db)).toHaveLength(0);
});

test("marks a conflict instead of pushing when the server changed since base_updated_at", async () => {
  await vaultCache.upsertEntry(db, {
    id: "1",
    ciphertext: "ct-mine",
    updatedAt: "2026-01-02T00:00:00Z",
    baseUpdatedAt: "2026-01-01T00:00:00Z",
    syncStatus: "pending",
    conflictCiphertext: null,
  });
  await syncQueue.enqueueOperation(db, "1", "update", "ct-mine");
  (vaultApi.getVaultEntry as jest.Mock).mockResolvedValue({
    id: 1,
    ciphertext: "ct-theirs",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-02T12:00:00Z", // changed since our base_updated_at
  });
  (vaultApi.listVaultEntries as jest.Mock).mockResolvedValue([
    { id: 1, ciphertext: "ct-theirs", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-02T12:00:00Z" },
  ]);

  await sync(db, "tok");

  const entry = await vaultCache.getEntry(db, "1");
  expect(entry?.syncStatus).toBe("conflict");
  expect(entry?.ciphertext).toBe("ct-mine"); // "my version" preserved for the resolution screen
  expect(entry?.conflictCiphertext).toBe("ct-theirs");
  expect(vaultApi.updateVaultEntry).not.toHaveBeenCalled();
  expect(await syncQueue.getQueuedOperations(db)).toHaveLength(0);
});

test("a 404 on the update pre-flight (deleted elsewhere) removes the local entry, not a conflict", async () => {
  await vaultCache.upsertEntry(db, {
    id: "1",
    ciphertext: "ct-mine",
    updatedAt: "2026-01-02T00:00:00Z",
    baseUpdatedAt: "2026-01-01T00:00:00Z",
    syncStatus: "pending",
    conflictCiphertext: null,
  });
  await syncQueue.enqueueOperation(db, "1", "update", "ct-mine");
  (vaultApi.getVaultEntry as jest.Mock).mockRejectedValue(new ApiError(404, "Vault entry not found"));
  (vaultApi.listVaultEntries as jest.Mock).mockResolvedValue([]);

  await sync(db, "tok");

  expect(await vaultCache.getEntry(db, "1")).toBeNull();
  expect(await syncQueue.getQueuedOperations(db)).toHaveLength(0);
});

test("flushes a queued delete and removes the local row", async () => {
  await vaultCache.upsertEntry(db, {
    id: "1",
    ciphertext: "ct",
    updatedAt: "2026-01-01T00:00:00Z",
    baseUpdatedAt: "2026-01-01T00:00:00Z",
    syncStatus: "pending",
    conflictCiphertext: null,
  });
  await syncQueue.enqueueOperation(db, "1", "delete", null);
  (vaultApi.deleteVaultEntry as jest.Mock).mockResolvedValue(undefined);
  (vaultApi.listVaultEntries as jest.Mock).mockResolvedValue([]);

  await sync(db, "tok");

  expect(await vaultCache.getEntry(db, "1")).toBeNull();
  expect(vaultApi.deleteVaultEntry).toHaveBeenCalledWith("tok", "1");
});

test("pull phase inserts entries this device has never seen", async () => {
  (vaultApi.listVaultEntries as jest.Mock).mockResolvedValue([
    { id: 7, ciphertext: "ct-remote", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" },
  ]);

  await sync(db, "tok");

  const entry = await vaultCache.getEntry(db, "7");
  expect(entry).toMatchObject({ ciphertext: "ct-remote", syncStatus: "synced" });
});

test("pull phase does not overwrite a locally 'conflict' or 'pending' entry", async () => {
  await vaultCache.upsertEntry(db, {
    id: "1",
    ciphertext: "ct-mine",
    updatedAt: "2026-01-02T00:00:00Z",
    baseUpdatedAt: "2026-01-01T00:00:00Z",
    syncStatus: "conflict",
    conflictCiphertext: "ct-theirs-old",
  });
  (vaultApi.listVaultEntries as jest.Mock).mockResolvedValue([
    { id: 1, ciphertext: "ct-server-newer", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-03T00:00:00Z" },
  ]);

  await sync(db, "tok");

  const entry = await vaultCache.getEntry(db, "1");
  expect(entry?.ciphertext).toBe("ct-mine");
  expect(entry?.syncStatus).toBe("conflict");
});

test("pull phase deletes local entries no longer present remotely", async () => {
  await vaultCache.upsertEntry(db, {
    id: "1",
    ciphertext: "ct",
    updatedAt: "2026-01-01T00:00:00Z",
    baseUpdatedAt: "2026-01-01T00:00:00Z",
    syncStatus: "synced",
    conflictCiphertext: null,
  });
  (vaultApi.listVaultEntries as jest.Mock).mockResolvedValue([]);

  await sync(db, "tok");

  expect(await vaultCache.getEntry(db, "1")).toBeNull();
});

test("sync() never throws when the network is unavailable", async () => {
  await syncQueue.enqueueOperation(db, "1", "delete", null);
  (vaultApi.deleteVaultEntry as jest.Mock).mockRejectedValue(new Error("network down"));
  (vaultApi.listVaultEntries as jest.Mock).mockRejectedValue(new Error("network down"));

  await expect(sync(db, "tok")).resolves.toBeUndefined();
  // The failed op stays queued for the next sync() call.
  expect(await syncQueue.getQueuedOperations(db)).toHaveLength(1);
});
```

- [ ] **Step 3: Run the tests**

Run: `bun x jest src/sync/syncEngine.test.ts`
Expected: PASS (9 passed)

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/sync/syncEngine.ts apps/mobile/src/sync/syncEngine.test.ts
git commit -m "feat(mobile): add the sync engine (queue flush + conflict detection + remote pull)"
```

---

### Task 7: `VaultContext.tsx`

**Files:**
- Create: `apps/mobile/src/context/vaultEntry.ts`
- Create: `apps/mobile/src/context/VaultContext.tsx`
- Test: `apps/mobile/src/context/VaultContext.test.tsx`
- Modify: `apps/mobile/app/_layout.tsx`

**Interfaces:**
- Consumes: `useAuth` (Task 4's `AuthContext.tsx`, for `vaultKey`/`accessToken`/`status`), `db/schema.ts`'s `initDatabase`, `db/vaultCache.ts`, `db/syncQueue.ts`, `sync/syncEngine.ts`'s `sync`, `crypto/cipher.ts`'s `encryptEntry`/`decryptEntry` (Plan 1, unchanged).
- Produces: `VaultEntryContent { title: string; username?: string; password: string; url?: string; notes?: string }` (from `vaultEntry.ts`); `VaultProvider`, `useVault(): { entries: DecryptedEntry[]; isSyncing: boolean; refresh(): Promise<void>; createEntry(content): Promise<void>; updateEntry(id, content): Promise<void>; deleteEntry(id): Promise<void>; getConflict(id): {mine, theirs} | null; resolveConflict(id, keep): Promise<void> }` (from `VaultContext.tsx`) — consumed by Tasks 9-12 (screens).

- [ ] **Step 1: Write `src/context/vaultEntry.ts`**

```ts
export interface VaultEntryContent {
  title: string;
  username?: string;
  password: string;
  url?: string;
  notes?: string;
}
```

- [ ] **Step 2: Write `src/context/VaultContext.tsx`**

```tsx
import { createContext, useContext, useCallback, useEffect, useState, ReactNode } from "react";
import * as SQLite from "expo-sqlite";
import type { SQLiteDatabaseLike, VaultCacheEntry } from "@/db/types";
import { initDatabase } from "@/db/schema";
import * as vaultCache from "@/db/vaultCache";
import * as syncQueueDb from "@/db/syncQueue";
import { sync as runSync } from "@/sync/syncEngine";
import { encryptEntry, decryptEntry } from "@/crypto/cipher";
import { useAuth } from "./AuthContext";
import type { VaultEntryContent } from "./vaultEntry";

export type { VaultEntryContent } from "./vaultEntry";

export interface DecryptedEntry {
  id: string;
  content: VaultEntryContent;
  syncStatus: VaultCacheEntry["syncStatus"];
}

interface VaultContextValue {
  entries: DecryptedEntry[];
  isSyncing: boolean;
  refresh: () => Promise<void>;
  createEntry: (content: VaultEntryContent) => Promise<void>;
  updateEntry: (id: string, content: VaultEntryContent) => Promise<void>;
  deleteEntry: (id: string) => Promise<void>;
  getConflict: (id: string) => { mine: VaultEntryContent; theirs: VaultEntryContent } | null;
  resolveConflict: (id: string, keep: "mine" | "theirs") => Promise<void>;
}

const VaultContext = createContext<VaultContextValue | undefined>(undefined);

export function VaultProvider({ children }: { children: ReactNode }) {
  const { vaultKey, accessToken, status } = useAuth();
  const [db, setDb] = useState<SQLiteDatabaseLike | null>(null);
  const [rawEntries, setRawEntries] = useState<VaultCacheEntry[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const nativeDb = await SQLite.openDatabaseAsync("vault.db");
      await initDatabase(nativeDb);
      if (!cancelled) setDb(nativeDb);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const reload = useCallback(async (activeDb: SQLiteDatabaseLike) => {
    setRawEntries(await vaultCache.getAllEntries(activeDb));
  }, []);

  const refresh = useCallback(async () => {
    if (!db || !accessToken) return;
    setIsSyncing(true);
    try {
      await runSync(db, accessToken);
      await reload(db);
    } finally {
      setIsSyncing(false);
    }
  }, [db, accessToken, reload]);

  useEffect(() => {
    if (db && status === "unlocked" && accessToken) {
      reload(db);
      refresh();
    }
  }, [db, status, accessToken, reload, refresh]);

  const createEntry = useCallback(
    async (content: VaultEntryContent) => {
      if (!db || !vaultKey) throw new Error("Vault is not ready");
      const id = vaultCache.generateLocalId();
      const ciphertext = encryptEntry(vaultKey, JSON.stringify(content));
      const now = new Date().toISOString();
      await vaultCache.upsertEntry(db, {
        id,
        ciphertext,
        updatedAt: now,
        baseUpdatedAt: now,
        syncStatus: "pending",
        conflictCiphertext: null,
      });
      await syncQueueDb.enqueueOperation(db, id, "create", ciphertext);
      await reload(db);
      refresh(); // fire-and-forget: optimistic UI already reflects the new entry
    },
    [db, vaultKey, reload, refresh]
  );

  const updateEntry = useCallback(
    async (id: string, content: VaultEntryContent) => {
      if (!db || !vaultKey) throw new Error("Vault is not ready");
      const ciphertext = encryptEntry(vaultKey, JSON.stringify(content));
      const now = new Date().toISOString();
      await vaultCache.markPending(db, id, { ciphertext, updatedAt: now });
      await syncQueueDb.enqueueOperation(db, id, "update", ciphertext);
      await reload(db);
      refresh();
    },
    [db, vaultKey, reload, refresh]
  );

  const deleteEntry = useCallback(
    async (id: string) => {
      if (!db) throw new Error("Vault is not ready");
      await vaultCache.deleteEntry(db, id);
      await syncQueueDb.enqueueOperation(db, id, "delete", null);
      await reload(db);
      refresh();
    },
    [db, reload, refresh]
  );

  const getConflict = useCallback(
    (id: string): { mine: VaultEntryContent; theirs: VaultEntryContent } | null => {
      const row = rawEntries.find((entry) => entry.id === id);
      if (!row || row.syncStatus !== "conflict" || !row.conflictCiphertext || !vaultKey) return null;
      return {
        mine: JSON.parse(decryptEntry(vaultKey, row.ciphertext)) as VaultEntryContent,
        theirs: JSON.parse(decryptEntry(vaultKey, row.conflictCiphertext)) as VaultEntryContent,
      };
    },
    [rawEntries, vaultKey]
  );

  const resolveConflict = useCallback(
    async (id: string, keep: "mine" | "theirs") => {
      if (!db || !vaultKey) return;
      const row = rawEntries.find((entry) => entry.id === id);
      if (!row || !row.conflictCiphertext) return;
      const ciphertext = keep === "mine" ? row.ciphertext : row.conflictCiphertext;
      const now = new Date().toISOString();
      await vaultCache.markPending(db, id, { ciphertext, updatedAt: now });
      await syncQueueDb.enqueueOperation(db, id, "update", ciphertext);
      await reload(db);
      refresh();
    },
    [db, vaultKey, rawEntries, reload, refresh]
  );

  const entries: DecryptedEntry[] = vaultKey
    ? rawEntries.map((entry) => ({
        id: entry.id,
        content: JSON.parse(decryptEntry(vaultKey, entry.ciphertext)) as VaultEntryContent,
        syncStatus: entry.syncStatus,
      }))
    : [];

  return (
    <VaultContext.Provider
      value={{ entries, isSyncing, refresh, createEntry, updateEntry, deleteEntry, getConflict, resolveConflict }}
    >
      {children}
    </VaultContext.Provider>
  );
}

export function useVault(): VaultContextValue {
  const context = useContext(VaultContext);
  if (!context) {
    throw new Error("useVault must be used within a VaultProvider");
  }
  return context;
}
```

- [ ] **Step 3: Wire `VaultProvider` into the root layout — modify `app/_layout.tsx`**

```tsx
import "react-native-get-random-values";
import "../global.css";

import { Stack } from "expo-router";
import { AuthProvider } from "@/context/AuthContext";
import { VaultProvider } from "@/context/VaultContext";

export default function RootLayout() {
  return (
    <AuthProvider>
      <VaultProvider>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(auth)" />
          <Stack.Screen name="(app)" />
        </Stack>
      </VaultProvider>
    </AuthProvider>
  );
}
```

- [ ] **Step 4: Write the failing test `src/context/VaultContext.test.tsx`**

```tsx
import { render, screen, waitFor, act } from "@testing-library/react-native";
import { Text } from "react-native";
import { VaultProvider, useVault } from "./VaultContext";
import { useAuth } from "./AuthContext";
import { encryptEntry } from "@/crypto/cipher";

jest.mock("./AuthContext");
jest.mock("expo-sqlite");
jest.mock("@/sync/syncEngine");

import * as SQLite from "expo-sqlite";
import { sync as mockSync } from "@/sync/syncEngine";
import { createTestDatabase } from "@/db/testUtils";

const VAULT_KEY = new Uint8Array(32).fill(3);

function Probe() {
  const { entries, isSyncing } = useVault();
  return (
    <>
      <Text testID="count">{entries.length}</Text>
      <Text testID="syncing">{String(isSyncing)}</Text>
    </>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  (useAuth as jest.Mock).mockReturnValue({
    vaultKey: VAULT_KEY,
    accessToken: "tok",
    status: "unlocked",
  });
  // expo-sqlite can't run under Jest (see plan Global Constraints); back
  // VaultProvider's openDatabaseAsync with the same real-SQLite test double
  // db/ and sync/ tests use.
  (SQLite.openDatabaseAsync as jest.Mock).mockImplementation(async () => createTestDatabase());
  (mockSync as jest.Mock).mockResolvedValue(undefined);
});

test("loads and decrypts cached entries on mount, and calls sync()", async () => {
  let auth: ReturnType<typeof useVault> | undefined;
  function Capture() {
    auth = useVault();
    return <Probe />;
  }

  await render(
    <VaultProvider>
      <Capture />
    </VaultProvider>
  );

  await waitFor(() => expect(mockSync).toHaveBeenCalled());
  expect(auth).toBeDefined();
});

test("createEntry encrypts the content, adds it to entries, and triggers a sync", async () => {
  let vault: ReturnType<typeof useVault> | undefined;
  function Capture() {
    vault = useVault();
    return <Probe />;
  }

  await render(
    <VaultProvider>
      <Capture />
    </VaultProvider>
  );
  await waitFor(() => expect(vault).toBeDefined());

  await act(async () => {
    await vault!.createEntry({ title: "GitHub", password: "hunter2" });
  });

  expect(vault!.entries).toHaveLength(1);
  expect(vault!.entries[0].content).toEqual({ title: "GitHub", password: "hunter2" });
  expect(vault!.entries[0].syncStatus).toBe("pending");
});

test("getConflict returns decrypted mine/theirs, resolveConflict('mine') clears it back to pending", async () => {
  let vault: ReturnType<typeof useVault> | undefined;
  function Capture() {
    vault = useVault();
    return <Probe />;
  }
  const db = createTestDatabase();
  (SQLite.openDatabaseAsync as jest.Mock).mockImplementation(async () => db);

  const mineCiphertext = encryptEntry(VAULT_KEY, JSON.stringify({ title: "Mine", password: "a" }));
  const theirsCiphertext = encryptEntry(VAULT_KEY, JSON.stringify({ title: "Theirs", password: "b" }));

  const { initDatabase } = await import("@/db/schema");
  const vaultCache = await import("@/db/vaultCache");
  await initDatabase(db);
  await vaultCache.upsertEntry(db, {
    id: "1",
    ciphertext: mineCiphertext,
    updatedAt: "2026-01-01T00:00:00Z",
    baseUpdatedAt: "2026-01-01T00:00:00Z",
    syncStatus: "conflict",
    conflictCiphertext: theirsCiphertext,
  });

  await render(
    <VaultProvider>
      <Capture />
    </VaultProvider>
  );
  await waitFor(() => expect(vault!.entries.some((e) => e.id === "1")).toBe(true));

  const conflict = vault!.getConflict("1");
  expect(conflict).toEqual({
    mine: { title: "Mine", password: "a" },
    theirs: { title: "Theirs", password: "b" },
  });

  await act(async () => {
    await vault!.resolveConflict("1", "mine");
  });

  const resolved = vault!.entries.find((e) => e.id === "1");
  expect(resolved?.syncStatus).toBe("pending");
  expect(resolved?.content).toEqual({ title: "Mine", password: "a" });
});
```

- [ ] **Step 5: Run the tests**

Run: `bun x jest src/context/VaultContext.test.tsx`
Expected: PASS (3 passed)

- [ ] **Step 6: Run the full suite to confirm nothing else broke**

Run: `bun x jest`
Expected: all suites pass

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/src/context/vaultEntry.ts apps/mobile/src/context/VaultContext.tsx apps/mobile/src/context/VaultContext.test.tsx apps/mobile/app/_layout.tsx
git commit -m "feat(mobile): add VaultContext wiring the local cache and sync engine into React state"
```

---

### Task 8: Auto-lock on backgrounding

**Files:**
- Modify: `apps/mobile/src/context/AuthContext.tsx`
- Modify: `apps/mobile/src/context/AuthContext.test.tsx`

**Interfaces:**
- Consumes: React Native's `AppState`.
- Produces: no new exported interface — `status`/`vaultKey`/`user`/`accessToken` now also transition to `locked`/`null` automatically after ≥30s backgrounded. Nothing outside `AuthContext.tsx` needs to change — the existing `app/(app)/_layout.tsx` redirect on `status === "locked"` (Plan 1) already handles routing.

- [ ] **Step 1: Modify `src/context/AuthContext.tsx` — add the AppState listener**

Add to the top imports:

```ts
import { createContext, useContext, useEffect, useState, useCallback, useRef, ReactNode } from "react";
import { AppState, AppStateStatus } from "react-native";
```

Add the constant near the top of the file, after the `Status` type:

```ts
const AUTO_LOCK_GRACE_MS = 30_000;
```

Inside `AuthProvider`, after the existing `vaultKey` state declaration, add:

```ts
const backgroundedAtRef = useRef<number | null>(null);
```

Add a new effect after the existing `unlockWithStoredSession` effect:

```ts
useEffect(() => {
  function handleAppStateChange(nextState: AppStateStatus) {
    if (nextState === "background" || nextState === "inactive") {
      if (backgroundedAtRef.current === null) {
        backgroundedAtRef.current = Date.now();
      }
      return;
    }

    if (nextState === "active" && backgroundedAtRef.current !== null) {
      const elapsed = Date.now() - backgroundedAtRef.current;
      backgroundedAtRef.current = null;

      // Checked on FOREGROUND RETURN, not via a timer started while
      // backgrounded: iOS/Android both aggressively suspend JS execution
      // for backgrounded apps, so a setTimeout scheduled while backgrounded
      // isn't guaranteed to fire. Comparing elapsed wall-clock time here is
      // reliable regardless of how long the OS suspended the app.
      if (elapsed >= AUTO_LOCK_GRACE_MS) {
        setVaultKey(null);
        setUser(null);
        setAccessToken(null);
        setStatus("locked");
      }
    }
  }

  const subscription = AppState.addEventListener("change", handleAppStateChange);
  return () => subscription.remove();
}, []);
```

- [ ] **Step 2: Write the failing tests — add to `src/context/AuthContext.test.tsx`**

Add this import at the top, alongside the existing ones:

```ts
import { AppState } from "react-native";
```

Add this mock near the top, alongside the existing `jest.mock` calls (it must come before any import that transitively pulls in `react-native`, same as the other `jest.mock` calls in this file):

```ts
jest.mock("react-native", () => {
  const actual = jest.requireActual("react-native");
  return {
    ...actual,
    AppState: { addEventListener: jest.fn(() => ({ remove: jest.fn() })) },
  };
});
```

Add these two tests at the end of the file:

```ts
test("auto-lock: backgrounding for >= 30s and returning to active clears vaultKey and locks", async () => {
  (session.loadSession as jest.Mock).mockResolvedValue(null);
  (authApi.register as jest.Mock).mockResolvedValue({ access_token: "tok", token_type: "bearer" });
  (authApi.getMe as jest.Mock).mockResolvedValue({ id: 1, email: "test@example.com" });
  (session.saveSession as jest.Mock).mockResolvedValue(undefined);

  let capturedListener: ((state: string) => void) | undefined;
  (AppState.addEventListener as jest.Mock).mockImplementation((_event, listener) => {
    capturedListener = listener;
    return { remove: jest.fn() };
  });

  let auth: ReturnType<typeof useAuth> | undefined;
  function Capture() {
    auth = useAuth();
    return <Probe />;
  }

  await render(
    <AuthProvider>
      <Capture />
    </AuthProvider>
  );
  await waitFor(() => expect(screen.getByTestId("status").props.children).toBe("locked"));
  await act(async () => {
    await auth!.register("test@example.com", "a strong master password");
  });
  await waitFor(() => expect(screen.getByTestId("status").props.children).toBe("unlocked"));

  jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
  const now = Date.now();
  jest.setSystemTime(now);
  act(() => {
    capturedListener!("background");
  });
  jest.setSystemTime(now + 31_000);
  act(() => {
    capturedListener!("active");
  });
  jest.useRealTimers();

  expect(screen.getByTestId("status").props.children).toBe("locked");
  expect(auth!.vaultKey).toBeNull();
  expect(auth!.accessToken).toBeNull();
});

test("auto-lock: backgrounding for < 30s and returning to active stays unlocked", async () => {
  (session.loadSession as jest.Mock).mockResolvedValue(null);
  (authApi.register as jest.Mock).mockResolvedValue({ access_token: "tok", token_type: "bearer" });
  (authApi.getMe as jest.Mock).mockResolvedValue({ id: 1, email: "test@example.com" });
  (session.saveSession as jest.Mock).mockResolvedValue(undefined);

  let capturedListener: ((state: string) => void) | undefined;
  (AppState.addEventListener as jest.Mock).mockImplementation((_event, listener) => {
    capturedListener = listener;
    return { remove: jest.fn() };
  });

  let auth: ReturnType<typeof useAuth> | undefined;
  function Capture() {
    auth = useAuth();
    return <Probe />;
  }

  await render(
    <AuthProvider>
      <Capture />
    </AuthProvider>
  );
  await waitFor(() => expect(screen.getByTestId("status").props.children).toBe("locked"));
  await act(async () => {
    await auth!.register("test@example.com", "a strong master password");
  });
  await waitFor(() => expect(screen.getByTestId("status").props.children).toBe("unlocked"));

  jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
  const now = Date.now();
  jest.setSystemTime(now);
  act(() => {
    capturedListener!("background");
  });
  jest.setSystemTime(now + 5_000);
  act(() => {
    capturedListener!("active");
  });
  jest.useRealTimers();

  expect(screen.getByTestId("status").props.children).toBe("unlocked");
  expect(auth!.vaultKey).not.toBeNull();
});
```

- [ ] **Step 3: Run the tests**

Run: `bun x jest src/context/AuthContext.test.tsx`
Expected: PASS (all tests, including the 2 new ones)

- [ ] **Step 4: Run the full suite**

Run: `bun x jest`
Expected: all suites pass

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/context/AuthContext.tsx apps/mobile/src/context/AuthContext.test.tsx
git commit -m "feat(mobile): auto-lock the vault after 30s backgrounded"
```

---

### Task 9: Vault list screen

**Files:**
- Modify: `apps/mobile/app/(app)/index.tsx`
- Test: `apps/mobile/src/routing/__tests__/vault-list.test.tsx`

**Interfaces:**
- Consumes: `useAuth` (`logout`), `useVault` (`entries`, `isSyncing`, `refresh`) — Tasks 4 and 7.

**Note on file placement:** this test lives under `src/routing/__tests__/` rather than colocated with the screen, following Plan 1's established fix for Expo Router's route-scanning — any `.test.tsx` file placed under `app/` risks being misclassified as a real route by Expo Router's file-based router.

- [ ] **Step 1: Replace `app/(app)/index.tsx`**

```tsx
import { FlatList, Pressable, View } from "react-native";
import { Link, useRouter } from "expo-router";
import { useAuth } from "@/context/AuthContext";
import { useVault } from "@/context/VaultContext";
import { Button } from "@/components/button";
import { ThemedText } from "@/components/themed-text";
import { colors, spacing } from "@/theme";

const STATUS_LABEL: Record<string, string> = {
  synced: "",
  pending: "Syncing…",
  conflict: "Conflict — tap to resolve",
};

export default function VaultListScreen() {
  const { logout } = useAuth();
  const { entries, isSyncing, refresh } = useVault();
  const router = useRouter();

  return (
    <View style={{ flex: 1, backgroundColor: colors.systemBackground, padding: spacing.lg, gap: spacing.md }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <ThemedText variant="largeTitle">Vault</ThemedText>
        <Button title="Log out" variant="secondary" size="sm" onPress={logout} />
      </View>
      <FlatList
        data={entries}
        keyExtractor={(item) => item.id}
        refreshing={isSyncing}
        onRefresh={refresh}
        ListEmptyComponent={<ThemedText variant="subhead">No entries yet.</ThemedText>}
        renderItem={({ item }) => (
          <Pressable
            testID={`entry-${item.id}`}
            onPress={() =>
              item.syncStatus === "conflict"
                ? router.push(`/entry/${item.id}/conflict`)
                : router.push(`/entry/${item.id}`)
            }
            style={{ paddingVertical: spacing.sm, borderBottomWidth: 1, borderColor: colors.separator }}
          >
            <ThemedText variant="headline">{item.content.title}</ThemedText>
            {item.content.username ? <ThemedText variant="subhead">{item.content.username}</ThemedText> : null}
            {STATUS_LABEL[item.syncStatus] ? (
              <ThemedText variant="caption">{STATUS_LABEL[item.syncStatus]}</ThemedText>
            ) : null}
          </Pressable>
        )}
      />
      <Link href="/entry/new" asChild>
        <Button title="Add entry" />
      </Link>
    </View>
  );
}
```

- [ ] **Step 2: Write the failing test `src/routing/__tests__/vault-list.test.tsx`**

```tsx
import { render, screen } from "@testing-library/react-native";
import { useAuth } from "@/context/AuthContext";
import { useVault } from "@/context/VaultContext";

jest.mock("@/context/AuthContext");
jest.mock("@/context/VaultContext");
jest.mock("expo-router", () => ({
  Link: ({ children }: { children: React.ReactNode }) => children,
  useRouter: () => ({ push: jest.fn() }),
}));

function getVaultListScreen() {
  return require("../../../app/(app)/index").default;
}

beforeEach(() => {
  jest.clearAllMocks();
  (useAuth as jest.Mock).mockReturnValue({ logout: jest.fn() });
});

test("renders each entry's title and username", async () => {
  (useVault as jest.Mock).mockReturnValue({
    entries: [
      { id: "1", content: { title: "GitHub", username: "me@example.com", password: "x" }, syncStatus: "synced" },
    ],
    isSyncing: false,
    refresh: jest.fn(),
  });
  const VaultListScreen = getVaultListScreen();

  await render(<VaultListScreen />);

  expect(screen.getByText("GitHub")).toBeTruthy();
  expect(screen.getByText("me@example.com")).toBeTruthy();
});

test("shows the empty state when there are no entries", async () => {
  (useVault as jest.Mock).mockReturnValue({ entries: [], isSyncing: false, refresh: jest.fn() });
  const VaultListScreen = getVaultListScreen();

  await render(<VaultListScreen />);

  expect(screen.getByText("No entries yet.")).toBeTruthy();
});

test("shows a conflict label on a conflicted entry", async () => {
  (useVault as jest.Mock).mockReturnValue({
    entries: [{ id: "1", content: { title: "GitHub", password: "x" }, syncStatus: "conflict" }],
    isSyncing: false,
    refresh: jest.fn(),
  });
  const VaultListScreen = getVaultListScreen();

  await render(<VaultListScreen />);

  expect(screen.getByText("Conflict — tap to resolve")).toBeTruthy();
});
```

- [ ] **Step 3: Run the tests**

Run: `bun x jest src/routing/__tests__/vault-list.test.tsx`
Expected: PASS (3 passed)

- [ ] **Step 4: Commit**

```bash
git add "apps/mobile/app/(app)/index.tsx" apps/mobile/src/routing/__tests__/vault-list.test.tsx
git commit -m "feat(mobile): replace the vault placeholder screen with the real entry list"
```

---

### Task 10: Shared entry form + create screen

**Files:**
- Create: `apps/mobile/src/components/entry-form.tsx`
- Create: `apps/mobile/src/components/entry-form.test.tsx`
- Create: `apps/mobile/app/(app)/entry/new.tsx`

**Interfaces:**
- Consumes: `VaultEntryContent` (Task 7's `context/vaultEntry.ts`), `Button`, `ThemedText`, theme tokens (Plan 1, unchanged).
- Produces: `EntryForm({ initialValue?, submitLabel, onSubmit }: { initialValue?: VaultEntryContent; submitLabel: string; onSubmit: (content: VaultEntryContent) => Promise<void> })` — consumed by this task's `entry/new.tsx` and Task 11's `entry/[id].tsx`.

- [ ] **Step 1: Write `src/components/entry-form.tsx`**

```tsx
import { useState } from "react";
import { View, TextInput } from "react-native";
import { Button } from "./button";
import { ThemedText } from "./themed-text";
import { colors, spacing } from "@/theme";
import type { VaultEntryContent } from "@/context/vaultEntry";

const FIELD_STYLE = {
  color: colors.label,
  borderBottomWidth: 1,
  borderColor: colors.separator,
  paddingVertical: spacing.sm,
};

export function EntryForm({
  initialValue,
  submitLabel,
  onSubmit,
}: {
  initialValue?: VaultEntryContent;
  submitLabel: string;
  onSubmit: (content: VaultEntryContent) => Promise<void>;
}) {
  const [title, setTitle] = useState(initialValue?.title ?? "");
  const [username, setUsername] = useState(initialValue?.username ?? "");
  const [password, setPassword] = useState(initialValue?.password ?? "");
  const [url, setUrl] = useState(initialValue?.url ?? "");
  const [notes, setNotes] = useState(initialValue?.notes ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    setError(null);
    if (!title.trim() || !password) {
      setError("Title and password are required.");
      return;
    }
    setLoading(true);
    try {
      await onSubmit({
        title: title.trim(),
        username: username.trim() || undefined,
        password,
        url: url.trim() || undefined,
        notes: notes.trim() || undefined,
      });
    } catch {
      setError("Couldn't save. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={{ gap: spacing.md }}>
      <TextInput
        testID="input-title"
        placeholder="Title"
        placeholderTextColor={colors.secondaryLabel}
        value={title}
        onChangeText={setTitle}
        style={FIELD_STYLE}
      />
      <TextInput
        testID="input-username"
        placeholder="Username"
        placeholderTextColor={colors.secondaryLabel}
        value={username}
        onChangeText={setUsername}
        autoCapitalize="none"
        style={FIELD_STYLE}
      />
      <TextInput
        testID="input-password"
        placeholder="Password"
        placeholderTextColor={colors.secondaryLabel}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        style={FIELD_STYLE}
      />
      <TextInput
        testID="input-url"
        placeholder="URL"
        placeholderTextColor={colors.secondaryLabel}
        value={url}
        onChangeText={setUrl}
        autoCapitalize="none"
        style={FIELD_STYLE}
      />
      <TextInput
        testID="input-notes"
        placeholder="Notes"
        placeholderTextColor={colors.secondaryLabel}
        value={notes}
        onChangeText={setNotes}
        multiline
        style={FIELD_STYLE}
      />
      {error ? (
        <ThemedText variant="subhead" style={{ color: "#E5484D" }}>
          {error}
        </ThemedText>
      ) : null}
      <Button title={submitLabel} onPress={handleSubmit} loading={loading} />
    </View>
  );
}
```

- [ ] **Step 2: Write the failing test `src/components/entry-form.test.tsx`**

```tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react-native";
import { EntryForm } from "./entry-form";

test("shows a validation error and does not call onSubmit when title/password are empty", async () => {
  const onSubmit = jest.fn();
  await render(<EntryForm submitLabel="Save" onSubmit={onSubmit} />);

  fireEvent.press(screen.getByText("Save"));

  await waitFor(() => expect(screen.getByText("Title and password are required.")).toBeTruthy());
  expect(onSubmit).not.toHaveBeenCalled();
});

test("calls onSubmit with the trimmed field values, omitting empty optional fields", async () => {
  const onSubmit = jest.fn().mockResolvedValue(undefined);
  await render(<EntryForm submitLabel="Save" onSubmit={onSubmit} />);

  fireEvent.changeText(screen.getByTestId("input-title"), "  GitHub  ");
  fireEvent.changeText(screen.getByTestId("input-password"), "hunter2");
  fireEvent.press(screen.getByText("Save"));

  await waitFor(() =>
    expect(onSubmit).toHaveBeenCalledWith({
      title: "GitHub",
      username: undefined,
      password: "hunter2",
      url: undefined,
      notes: undefined,
    })
  );
});

test("pre-fills fields from initialValue", async () => {
  await render(
    <EntryForm
      initialValue={{ title: "GitHub", username: "me", password: "hunter2" }}
      submitLabel="Save changes"
      onSubmit={jest.fn()}
    />
  );

  expect(screen.getByDisplayValue("GitHub")).toBeTruthy();
  expect(screen.getByDisplayValue("me")).toBeTruthy();
});
```

- [ ] **Step 3: Run the tests**

Run: `bun x jest src/components/entry-form.test.tsx`
Expected: PASS (3 passed)

- [ ] **Step 4: Write `app/(app)/entry/new.tsx`**

```tsx
import { useRouter } from "expo-router";
import { View } from "react-native";
import { useVault } from "@/context/VaultContext";
import { EntryForm } from "@/components/entry-form";
import { ThemedText } from "@/components/themed-text";
import { colors, spacing } from "@/theme";

export default function NewEntryScreen() {
  const { createEntry } = useVault();
  const router = useRouter();

  return (
    <View style={{ flex: 1, backgroundColor: colors.systemBackground, padding: spacing.lg, gap: spacing.md }}>
      <ThemedText variant="largeTitle">New entry</ThemedText>
      <EntryForm
        submitLabel="Save"
        onSubmit={async (content) => {
          await createEntry(content);
          router.back();
        }}
      />
    </View>
  );
}
```

- [ ] **Step 5: Manual check — no automated test needed for this thin screen**

`entry/new.tsx` only wires `EntryForm` (already tested in Step 2-3) to `useVault().createEntry` (already tested in Task 7). Run the full suite to confirm the new file at least type-checks and doesn't break anything:

Run: `bun x tsc --noEmit && bun x jest`
Expected: no type errors, all suites pass

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/components/entry-form.tsx apps/mobile/src/components/entry-form.test.tsx "apps/mobile/app/(app)/entry/new.tsx"
git commit -m "feat(mobile): add the shared entry form and the create-entry screen"
```

---

### Task 11: Entry detail/edit screen

**Files:**
- Create: `apps/mobile/app/(app)/entry/[id].tsx`
- Test: `apps/mobile/src/routing/__tests__/entry-detail.test.tsx`

**Interfaces:**
- Consumes: `useVault` (`entries`, `updateEntry`, `deleteEntry` — Task 7), `EntryForm` (Task 10), `expo-router`'s `useLocalSearchParams`/`useRouter`.

- [ ] **Step 1: Write `app/(app)/entry/[id].tsx`**

```tsx
import { useLocalSearchParams, useRouter } from "expo-router";
import { View } from "react-native";
import { useVault } from "@/context/VaultContext";
import { EntryForm } from "@/components/entry-form";
import { Button } from "@/components/button";
import { ThemedText } from "@/components/themed-text";
import { colors, spacing } from "@/theme";

export default function EntryDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { entries, updateEntry, deleteEntry } = useVault();
  const router = useRouter();
  const entry = entries.find((e) => e.id === id);

  if (!entry) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.systemBackground, justifyContent: "center", padding: spacing.lg }}>
        <ThemedText variant="body">Entry not found.</ThemedText>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.systemBackground, padding: spacing.lg, gap: spacing.md }}>
      <ThemedText variant="largeTitle">{entry.content.title}</ThemedText>
      <EntryForm
        initialValue={entry.content}
        submitLabel="Save changes"
        onSubmit={async (content) => {
          await updateEntry(entry.id, content);
          router.back();
        }}
      />
      <Button
        title="Delete"
        variant="secondary"
        onPress={async () => {
          await deleteEntry(entry.id);
          router.back();
        }}
      />
    </View>
  );
}
```

- [ ] **Step 2: Write the failing test `src/routing/__tests__/entry-detail.test.tsx`**

```tsx
import { render, screen } from "@testing-library/react-native";
import { useVault } from "@/context/VaultContext";

jest.mock("@/context/VaultContext");
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ id: "1" }),
  useRouter: () => ({ back: jest.fn() }),
}));

function getEntryDetailScreen() {
  return require("../../../app/(app)/entry/[id]").default;
}

beforeEach(() => {
  jest.clearAllMocks();
});

test("renders the entry's title and a pre-filled form when found", async () => {
  (useVault as jest.Mock).mockReturnValue({
    entries: [{ id: "1", content: { title: "GitHub", username: "me", password: "hunter2" }, syncStatus: "synced" }],
    updateEntry: jest.fn(),
    deleteEntry: jest.fn(),
  });
  const EntryDetailScreen = getEntryDetailScreen();

  await render(<EntryDetailScreen />);

  expect(screen.getByText("GitHub")).toBeTruthy();
  expect(screen.getByDisplayValue("me")).toBeTruthy();
});

test("shows 'Entry not found.' when no entry matches the id", async () => {
  (useVault as jest.Mock).mockReturnValue({ entries: [], updateEntry: jest.fn(), deleteEntry: jest.fn() });
  const EntryDetailScreen = getEntryDetailScreen();

  await render(<EntryDetailScreen />);

  expect(screen.getByText("Entry not found.")).toBeTruthy();
});
```

- [ ] **Step 3: Run the tests**

Run: `bun x jest src/routing/__tests__/entry-detail.test.tsx`
Expected: PASS (2 passed)

- [ ] **Step 4: Commit**

```bash
git add "apps/mobile/app/(app)/entry/[id].tsx" apps/mobile/src/routing/__tests__/entry-detail.test.tsx
git commit -m "feat(mobile): add the entry view/edit/delete screen"
```

---

### Task 12: Conflict resolution screen

**Files:**
- Create: `apps/mobile/app/(app)/entry/[id]/conflict.tsx`
- Test: `apps/mobile/src/routing/__tests__/entry-conflict.test.tsx`

**Interfaces:**
- Consumes: `useVault` (`getConflict`, `resolveConflict` — Task 7), `expo-router`'s `useLocalSearchParams`/`useRouter`.

**Note on file placement:** `app/(app)/entry/[id]/conflict.tsx` is itself a real route (this is intentional — see the spec), so unlike the layout files in Plan 1, this file stays under `app/`. Only its `.test.tsx` companion is kept elsewhere (`src/routing/__tests__/`), for the same route-scanning reason as Tasks 9 and 11.

- [ ] **Step 1: Write `app/(app)/entry/[id]/conflict.tsx`**

```tsx
import { useLocalSearchParams, useRouter } from "expo-router";
import { View } from "react-native";
import { useVault } from "@/context/VaultContext";
import { Button } from "@/components/button";
import { ThemedText } from "@/components/themed-text";
import { colors, spacing } from "@/theme";
import type { VaultEntryContent } from "@/context/vaultEntry";

function EntrySummary({ label, content }: { label: string; content: VaultEntryContent }) {
  return (
    <View style={{ gap: spacing.xs, padding: spacing.md, borderWidth: 1, borderColor: colors.separator, borderRadius: 8 }}>
      <ThemedText variant="headline">{label}</ThemedText>
      <ThemedText variant="body">Title: {content.title}</ThemedText>
      {content.username ? <ThemedText variant="body">Username: {content.username}</ThemedText> : null}
      <ThemedText variant="body">Password: {content.password}</ThemedText>
      {content.url ? <ThemedText variant="body">URL: {content.url}</ThemedText> : null}
      {content.notes ? <ThemedText variant="body">Notes: {content.notes}</ThemedText> : null}
    </View>
  );
}

export default function ConflictScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { getConflict, resolveConflict } = useVault();
  const router = useRouter();
  const conflict = getConflict(id);

  if (!conflict) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.systemBackground, justifyContent: "center", padding: spacing.lg }}>
        <ThemedText variant="body">No conflict to resolve.</ThemedText>
      </View>
    );
  }

  async function handleResolve(keep: "mine" | "theirs") {
    await resolveConflict(id, keep);
    router.back();
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.systemBackground, padding: spacing.lg, gap: spacing.md }}>
      <ThemedText variant="largeTitle">Resolve conflict</ThemedText>
      <ThemedText variant="subhead">
        This entry was changed on another device too. Choose which version to keep.
      </ThemedText>
      <EntrySummary label="Yours" content={conflict.mine} />
      <EntrySummary label="Theirs" content={conflict.theirs} />
      <Button title="Keep mine" onPress={() => handleResolve("mine")} />
      <Button title="Keep theirs" variant="secondary" onPress={() => handleResolve("theirs")} />
    </View>
  );
}
```

- [ ] **Step 2: Write the failing test `src/routing/__tests__/entry-conflict.test.tsx`**

```tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react-native";
import { useVault } from "@/context/VaultContext";

jest.mock("@/context/VaultContext");
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ id: "1" }),
  useRouter: () => ({ back: jest.fn() }),
}));

function getConflictScreen() {
  return require("../../../app/(app)/entry/[id]/conflict").default;
}

beforeEach(() => {
  jest.clearAllMocks();
});

test("shows both versions side by side when there is a conflict", async () => {
  (useVault as jest.Mock).mockReturnValue({
    getConflict: () => ({
      mine: { title: "GitHub", password: "mine-pw" },
      theirs: { title: "GitHub Work", password: "theirs-pw" },
    }),
    resolveConflict: jest.fn(),
  });
  const ConflictScreen = getConflictScreen();

  await render(<ConflictScreen />);

  expect(screen.getByText("Title: GitHub")).toBeTruthy();
  expect(screen.getByText("Title: GitHub Work")).toBeTruthy();
});

test("shows 'No conflict to resolve.' when getConflict returns null", async () => {
  (useVault as jest.Mock).mockReturnValue({ getConflict: () => null, resolveConflict: jest.fn() });
  const ConflictScreen = getConflictScreen();

  await render(<ConflictScreen />);

  expect(screen.getByText("No conflict to resolve.")).toBeTruthy();
});

test("'Keep mine' calls resolveConflict with the entry id and 'mine'", async () => {
  const resolveConflict = jest.fn().mockResolvedValue(undefined);
  (useVault as jest.Mock).mockReturnValue({
    getConflict: () => ({ mine: { title: "A", password: "1" }, theirs: { title: "B", password: "2" } }),
    resolveConflict,
  });
  const ConflictScreen = getConflictScreen();

  await render(<ConflictScreen />);
  fireEvent.press(screen.getByText("Keep mine"));

  await waitFor(() => expect(resolveConflict).toHaveBeenCalledWith("1", "mine"));
});
```

- [ ] **Step 3: Run the tests**

Run: `bun x jest src/routing/__tests__/entry-conflict.test.tsx`
Expected: PASS (3 passed)

- [ ] **Step 4: Run the full suite and typecheck one last time**

Run: `bun x tsc --noEmit && bun x jest`
Expected: no type errors, all suites pass

- [ ] **Step 5: Commit**

```bash
git add "apps/mobile/app/(app)/entry/[id]/conflict.tsx" apps/mobile/src/routing/__tests__/entry-conflict.test.tsx
git commit -m "feat(mobile): add the conflict resolution screen"
```
