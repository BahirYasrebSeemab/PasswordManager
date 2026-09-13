# Mobile Vault CRUD, Offline Sync, Conflict Resolution & Auto-Lock (Plan 2)

## Context

Plan 1 (`docs/superpowers/specs/2026-09-11-mobile-app-design.md`) delivered the
mobile app's foundation: crypto layer (`deriveKeys`, `encryptEntry`/`decryptEntry`),
typed API client, SecureStore-backed session persistence, `AuthContext`
(`status`/`user`/`vaultKey`/`login`/`register`/`logout`/`unlockWithStoredSession`),
the "Vault" design system, and biometric-gated navigation. It is complete, reviewed,
and verified working end-to-end. Nothing in Plan 1 puts real vault data on screen yet.

This plan builds the vault feature itself: local offline cache, CRUD screens, a sync
engine talking to the already-shipped, tested, rate-limited backend endpoints
(`POST/GET/GET-one/PUT/DELETE /vault`, per-user-owned, 404-for-both on
not-found-vs-not-yours — see `2026-09-05-vault-crud-design.md`), and two pieces of
design that Plan 1's spec explicitly deferred:

1. **Conflict resolution.** The original spec punted to "last-write-wins by
   operation order." That's no longer acceptable: the next project after this one is
   the Chrome/Zen browser extension, which means multiple clients will soon edit the
   same vault concurrently. This plan designs real conflict detection and a
   user-facing resolution flow instead.
2. **Auto-lock on backgrounding.** Plan 1 had nothing sensitive on screen, so this
   wasn't needed yet. Once real vault entries render, the app must clear `vaultKey`
   from memory after being backgrounded past a grace period.

## Architecture & file structure

```
src/
  db/
    schema.ts        # creates vault_entries_cache + pending_operations tables (SQLite)
    vaultCache.ts     # reads/writes against vault_entries_cache
    syncQueue.ts      # enqueue/dequeue against pending_operations
  sync/
    syncEngine.ts     # flushes the queue against the API, pulls remote changes, detects conflicts
  context/
    VaultContext.tsx  # exposes decrypted entries + create/update/delete + sync status; the only thing screens touch
app/(app)/
  (tabs)/index.tsx        # vault list — replaces Plan 1's placeholder tab
  entry/new.tsx            # create entry
  entry/[id].tsx           # view/edit one entry
  entry/[id]/conflict.tsx   # shown when that entry has a detected conflict
```

`db/` and `sync/` are plain TypeScript with no React dependency, so they're testable
standalone. `VaultContext` is the single seam between that layer and the UI — screens
never import `db/` or `sync/` directly. `AuthContext` gains the auto-lock behavior
(see below), since it already owns `vaultKey`'s lifecycle and the routing that happens
on `status === 'locked'`.

## Local data model

**`vault_entries_cache`** (extends the original spec's table with what conflict
detection needs):

| column | type | purpose |
|---|---|---|
| `id` | TEXT (server UUID, or a local temp id pre-sync) | primary key |
| `ciphertext` | TEXT | opaque encrypted entry, as returned by the API — never decrypted at rest |
| `updated_at` | TEXT (ISO timestamp) | the value as last confirmed from the server |
| `base_updated_at` | TEXT (ISO timestamp) | the server's `updated_at` at the moment this device last pulled/pushed the entry — the baseline for conflict detection |
| `sync_status` | TEXT: `'synced' \| 'pending' \| 'conflict'` | drives UI badges and whether the sync engine touches this row |
| `conflict_ciphertext` | TEXT, nullable | the server's competing version, stashed here when a conflict is detected, so the resolution screen can show both without re-fetching |

`base_updated_at` is kept separate from `updated_at` because `updated_at` gets
overwritten as soon as a pull happens; without a distinct baseline the engine can't
tell "the server changed since I last saw it" from "the server has the value I
already know about." `base_updated_at` only moves when this device confirms it's in
sync with the server.

**`pending_operations`**

| column | type | purpose |
|---|---|---|
| `id` | INTEGER, autoincrement | queue order |
| `entry_id` | TEXT | which cache row this op applies to |
| `op` | TEXT: `'create' \| 'update' \| 'delete'` | |
| `payload` | TEXT, nullable | ciphertext for create/update; null for delete |
| `created_at` | TEXT | for ordering/debugging |

## Sync engine flow

`syncEngine.sync()` runs on app foreground, after any local mutation, and on a manual
pull-to-refresh. Two phases, always in this order.

**Phase 1 — flush the outbound queue** (oldest `pending_operations` row first):

- **create**: `POST /vault` with the queued ciphertext. On success, replace the local
  temp id with the server's real id, set `updated_at`/`base_updated_at` from the
  response, mark `sync_status: 'synced'`, dequeue.
- **update**: pre-flight `GET /vault/{id}` first. Compare the response's `updated_at`
  to this row's `base_updated_at`:
  - **match** — the server hasn't changed since this device last saw it. Safe to
    `PUT /vault/{id}`. On success, update `updated_at`/`base_updated_at`, mark
    `'synced'`, dequeue.
  - **mismatch** — someone else changed it since. Do not push. Stash the server's
    ciphertext into `conflict_ciphertext`, set `sync_status: 'conflict'`, dequeue the
    operation (the queued edit is preserved as the cache row's current `ciphertext` —
    that's "my version" for the resolution screen). Stop processing further queued
    ops for this `entry_id` until the user resolves it.
  - **410/404** — entry was deleted elsewhere. Drop the local queued op, remove the
    cache row, surface a toast (not a conflict screen — nothing to resolve).
- **delete**: `DELETE /vault/{id}` directly, no pre-flight — deleting an
  already-changed entry isn't a meaningful conflict (their edit is gone either way).
  A 404 response is treated as already-deleted and dequeued silently.

**Phase 2 — pull remote changes:** after the queue is flushed, `GET /vault` (full
list) and merge: any entry with a newer `updated_at` than the local cache's
`base_updated_at`, and not currently `sync_status: 'conflict'` or `'pending'`, gets
overwritten locally with `base_updated_at` advanced. Entries this device has never
seen get inserted. Entries no longer in the server's list get removed locally.

Deliberate simplification: only one conflict is surfaced at a time per entry — no
running history of conflicting edits. If the user leaves a conflict unresolved and
the entry is edited elsewhere again, the newest server version simply replaces
`conflict_ciphertext` on the next sync. This fits a single-user-multi-device app; it
is not designed for true multi-user concurrent editing.

`syncEngine.sync()` never throws to the UI. Network failures leave queued ops in
place (retried on the next sync trigger); the list screen shows a small
non-blocking "sync failed, will retry" indicator rather than an error screen —
offline-first means failure-to-sync is an expected steady state, not an exceptional
one.

## Auto-lock on backgrounding

Lives in `AuthContext` (it already owns `vaultKey`), using React Native's
`AppState` API.

- On transition `active → background` (or `inactive`, iOS's brief intermediate state
  during app-switcher/control-center), record `backgroundedAt = Date.now()` in a
  `useRef` (write-then-read-once bookkeeping — not state, shouldn't trigger a
  re-render). Nothing else happens yet; no timer is started.
- On transition `background → active`, compare `Date.now() - backgroundedAt` against
  `AUTO_LOCK_GRACE_MS = 30_000`:
  - **under 30s** — do nothing, stay unlocked, clear `backgroundedAt`.
  - **30s or more** — clear `vaultKey` from memory, set `status: 'locked'`. Existing
    routing (`app/(app)/_layout.tsx`'s redirect-to-login on `status === 'locked'`,
    built in Plan 1) handles the rest. `unlockWithStoredSession()` then runs the
    normal biometric-gated re-entry.

Checking elapsed wall-clock time on foreground return, rather than starting a
30-second timer when backgrounding, is deliberate: iOS and Android both aggressively
suspend JS execution for backgrounded apps, so a `setTimeout` scheduled while
backgrounded is not guaranteed to fire at all, let alone on time. A timestamp
comparison on return is reliable regardless of how long or how thoroughly the OS
suspended the app in between.

Out of scope for this plan (deliberately, to stay bounded): no lock triggered by the
device's own screen-lock while the app stays foregrounded (the OS already gates app
content behind the device lock screen), no configurable timeout yet
(`AUTO_LOCK_GRACE_MS` is a hardcoded constant — Plan 3's account/unlock settings
screen is where this becomes user-configurable), no lock on idle-while-foregrounded.

## Entry content shape & screens

Plaintext shape passed to `encryptEntry` before anything leaves the device — this is
new; Plan 1 built the cipher functions but nothing called them yet:

```ts
interface VaultEntryContent {
  title: string;
  username?: string;
  password: string;
  url?: string;
  notes?: string;
}
```

Kept intentionally minimal, matching the original spec's scope. TOTP/custom fields
are a later nice-to-have, not part of this plan.

- **`(tabs)/index.tsx`** — vault list. Each row shows `title`/`username` (decrypted
  in-memory via `vaultKey`, never persisted as plaintext) and a small status dot for
  `sync_status`. Tapping a conflict row goes to the conflict screen instead of the
  normal editor.
- **`entry/new.tsx`** — form for the shape above; on submit, encrypts, inserts a
  `vault_entries_cache` row with `sync_status: 'pending'` and a local temp id, queues
  a `create` op, triggers `syncEngine.sync()` in the background (optimistic UI — the
  row shows immediately, "pending" until confirmed).
- **`entry/[id].tsx`** — view/edit. Same form, pre-filled from the decrypted cache
  row; edits queue an `update` op the same optimistic way.
- **`entry/[id]/conflict.tsx`** — decrypts and shows both `ciphertext` ("yours") and
  `conflict_ciphertext` ("theirs") side by side field-by-field, with "Keep mine" /
  "Keep theirs" buttons. Whichever is chosen becomes the row's `ciphertext`,
  `sync_status` resets to `'pending'`, and a fresh `update` op is queued so the
  choice gets pushed on the next sync. No silent auto-merge of individual fields —
  merging by field risks producing a password that matches neither version.

## Testing approach

Same split as Plan 1, extended to the new layers:

- **`db/` and `sync/`** — pure TypeScript, tested directly with `bun x jest` against
  a real (in-memory/temp) SQLite database, not mocked — conflict detection is exactly
  the kind of logic that's easy to get subtly wrong, so real execution beats mocking.
  Key cases: create/update/delete flush correctly; update pre-flight match vs.
  mismatch vs. 410/404; pull-phase merge skips `'conflict'`/`'pending'` rows; rows
  deleted remotely get removed locally.
- **`VaultContext`** — same pattern as Plan 1's `AuthContext.test.tsx`:
  `@testing-library/react-native`'s `render()` (must be `await`ed — the async-render
  bug class discovered and fixed throughout Plan 1), mocking `db/`/`sync/` at the
  module boundary, asserting exposed state (`entries`, `syncStatus`) and that
  create/update/delete call through correctly.
- **Auto-lock in `AuthContext`** — simulate `AppState` transitions via its
  test/mock listener; assert `vaultKey`/`status` before and after crossing/not
  crossing the 30s grace period, using fake timers for the elapsed-time check rather
  than real waits.
- **Screens** — light smoke tests only (renders, shows expected testIDs per state),
  consistent with how Plan 1 tested `login.tsx`/`register.tsx`.
- **No E2E** — consistent with Plan 1; this project's testing has stayed at
  unit/integration level throughout.

## Out of scope for this plan

- Vault-entry sharing between accounts — explicitly deferred to future plans.
- TOTP / custom fields on entries.
- Configurable auto-lock timeout (Plan 3).
- True multi-user concurrent-edit merging (this design assumes one user, multiple
  of their own devices).
