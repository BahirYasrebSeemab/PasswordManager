# Mobile Account & Unlock Settings + Import/Export (Plan 3)

## Context

This combines what was originally scoped as two separate follow-ups after Plan 2
(vault CRUD/sync, complete and committed) into one plan, since each individually is
small: (1) account & unlock settings — biometric toggle, a real fix for a device-
compatibility bug in session persistence, configurable auto-lock timeout, and account
deletion (required before iOS App Store submission); (2) import/export of vault
entries in a Chrome/Firefox-compatible CSV shape.

Builds on Plan 1 (`2026-09-11-mobile-app-design.md` — crypto, auth, session
persistence) and Plan 2 (`2026-09-13-mobile-vault-sync-design.md` — vault CRUD,
offline sync, conflict resolution, auto-lock, all already namespacing the local
SQLite cache per user id).

**A real bug found during design, not new scope:** `session.ts`'s `saveSession`/
`loadSession` use `SecureStore`'s `requireAuthentication: true` unconditionally.
That option specifically requires biometric enrollment (`SecureStore.
canUseBiometricAuthentication()` returns `false` whenever biometric isn't set up,
per Expo's own documentation) — on a device without biometric enrolled, persisting
a session already fails today. This plan's fix for that doubles as the "no
biometric" fallback design; no separate PIN-crypto subsystem is needed (see
Decisions below).

## Decisions made during brainstorming

- **No biometric fallback:** fix the bug by skipping session persistence entirely
  when biometric isn't available (hardware absent, or the user has turned the
  in-app biometric preference off). The device simply requires a full master-
  password login each time — this already works today as the ordinary "no stored
  session" path, so it costs zero new crypto.
- **Import format:** Chrome/Firefox-compatible CSV only (`name,url,username,
  password` columns) — covers the two Zen/Firefox-first browsers this project is
  building the extension for next, plus Chrome. No Bitwarden/1Password support.
- **Account deletion re-authentication:** requires re-entering the master password
  (re-derives `auth_key` client-side, verified server-side the same way login is),
  not just a confirm dialog — an irreversible, destroy-everything action deserves
  re-proving the actual credential, not just whatever unlocked the device.
- **Import conflict handling:** none. Duplicate detection has no clean answer and
  risks silently dropping data; importing over existing entries just creates
  duplicates the user can manually clean up. A post-import summary ("N imported")
  keeps this from being silent.
- **Toggling biometric on:** reuses the keys already in memory (`vaultKey`,
  `authKey`, `accessToken`) to persist a session immediately — no re-prompt for the
  master password just to flip a settings toggle.

## Architecture & file structure

```
apps/api/app/auth/
  router.py         # + DELETE /me
  schemas.py         # + AccountDeleteRequest { auth_key: str }

apps/mobile/src/
  context/
    AuthContext.tsx    # + authKey kept in state; + setBiometricPreference()
    session.ts          # + shouldPersistSession(); saveSession only called when it's true
  settings/
    preferences.ts       # plain (non-authenticated) SecureStore: biometric-enabled flag, auto-lock seconds
  api/
    auth.ts          # + deleteAccount(accessToken, email, authKey)
  import-export/
    csvFormat.ts       # Chrome/Firefox-shape CSV row <-> VaultEntryContent, CSV-injection-safe
    exportVault.ts      # entries -> CSV string, writes+cleans up a temp file for the share sheet
    importVault.ts       # CSV string -> VaultEntryContent[], creates via VaultContext.createEntry
apps/mobile/app/(app)/settings/
  index.tsx          # biometric toggle + auto-lock timeout picker
  delete-account.tsx    # master-password re-entry -> deleteAccount -> full local wipe
  import.tsx          # pick a CSV file, preview count, import, show "N imported"
  export.tsx          # trigger export, share the file
```

## Session persistence fix & biometric settings

`session.ts` adds:

```ts
export async function shouldPersistSession(): Promise<boolean> {
  const hasBiometric = await SecureStore.canUseBiometricAuthentication();
  const userWantsIt = await preferences.getBiometricEnabled(); // defaults to true
  return hasBiometric && userWantsIt;
}
```

`AuthContext`'s `register`/`login` call this before deciding whether to call
`saveSession(...)` at all. If `false`, they skip persisting entirely — no
`SecureStore` write happens, so `requireAuthentication: true` never gets a chance
to fail. Next launch, `unlockWithStoredSession` finds nothing (the existing
"no stored session" path), routes to `"locked"`, and the user logs in normally.

`AuthContext` also keeps `authKey` in state (mirroring how `accessToken` was added
in Plan 2), so the settings screen can persist a session on demand without asking
for the master password again.

**`app/(app)/settings/index.tsx`:**
- Shows biometric availability (`canUseBiometricAuthentication()`) and the current
  toggle state (`preferences.getBiometricEnabled()`). If hardware isn't available,
  the toggle is disabled with a one-line explanation, not hidden.
- Toggling **on**: `preferences.setBiometricEnabled(true)`, then immediately
  `saveSession(...)` using the in-memory `vaultKey`/`authKey`/`accessToken`/`email`.
- Toggling **off**: `preferences.setBiometricEnabled(false)`, then `clearSession()`
  to remove anything already persisted.
- The auto-lock timeout picker lives on the same screen.

## Configurable auto-lock timeout

Plan 2 shipped a hardcoded `AUTO_LOCK_GRACE_MS = 30_000`. This plan replaces it
with a stored preference:

- `preferences.ts` adds `getAutoLockSeconds()` / `setAutoLockSeconds(seconds:
  number)`, default `30`.
- A fixed preset picker on the settings screen — **Immediately**, **30 seconds**,
  **1 minute**, **5 minutes** — not free text.
- `AuthContext`'s `AppState` handler reads `preferences.getAutoLockSeconds()` at
  the moment it computes elapsed time, rather than a constant — a change takes
  effect on the very next lock check, no extra plumbing needed.

## Account deletion

**Backend (`apps/api/app/auth/router.py`):**

```python
@router.delete("/me", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("5/minute")
def delete_account(
    request: Request,
    payload: AccountDeleteRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    if not verify_auth_key(payload.auth_key, current_user.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Incorrect password")
    db.query(VaultEntry).filter(VaultEntry.user_id == current_user.id).delete()
    db.delete(current_user)
    db.commit()
```

Requires both a valid access token (`get_current_user`) and a freshly-supplied
`auth_key` that matches — the same bar `/auth/login` already uses, via the same
`verify_auth_key` helper (no new verification logic). Rate-limited like the other
auth endpoints. `auth_key` is exactly what the client already sends on every
login; this endpoint never sees or needs the plaintext master password. Vault
entries are deleted explicitly before the user row — no FK cascade is configured
on `vault_entries.user_id` today, and adding one needs a migration; explicit
deletion in the handler needs no schema change.

**Mobile (`app/(app)/settings/delete-account.tsx`):**

1. Master-password field + a destructive-styled "Delete my account" button behind
   an `Alert.alert` confirmation (same pattern Plan 2 used for entry deletion).
2. On confirm: re-derive `authKey` via `deriveKeys(user.email, password)` — the
   same function used at login.
3. Call `deleteAccount(accessToken, email, authKey)` → `DELETE /auth/me`.
4. On success: `clearSession()`, delete the local per-user SQLite file
   (`vault-${user.id}.db`), reset `AuthContext`/`VaultContext` state, route to the
   login screen. Functionally "logout plus destroy the local cache."
5. Wrong password → 401 → inline error, nothing is deleted.

## Import / Export (CSV)

**`csvFormat.ts`:** Chrome and Firefox both accept `name,url,username,password`
columns for import (Firefox's own export includes extra columns, but its import
accepts this simpler shape too, so targeting it covers both browsers this project
is prioritizing).

```ts
interface CsvRow { name: string; url: string; username: string; password: string }

function csvRowToEntry(row: CsvRow): VaultEntryContent {
  return { title: row.name || row.url, username: row.username || undefined, password: row.password, url: row.url || undefined };
}

function entryToCsvRow(content: VaultEntryContent): CsvRow {
  return { name: content.title, url: content.url ?? "", username: content.username ?? "", password: content.password };
}

// CSV formula injection guard: a cell value starting with =, +, -, or @ can be
// interpreted as a spreadsheet formula if the exported file is later opened in
// Excel/Sheets. Prefix such values with a leading apostrophe before writing.
function escapeCsvCell(value: string): string {
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}
```

No `notes` column — Chrome/Firefox's own format doesn't have one, so a
round-tripped entry loses notes on export→reimport-elsewhere; accepted given the
scope decision to target just this shape.

**Export (`exportVault.ts` + `app/(app)/settings/export.tsx`):**

1. Decrypt every entry (already in memory via `useVault().entries`), map through
   `entryToCsvRow` + `escapeCsvCell`, join into a CSV string.
2. `expo-sharing`'s `shareAsync` needs a file URI, not raw text, so write the CSV
   to a temp file (`expo-file-system`'s cache directory) first.
3. Hand that file to the share sheet.
4. **Delete the temp file immediately after the share sheet resolves.** Without
   this, a plaintext password dump would sit in the app's local storage
   indefinitely — a new on-device exposure this plan introduces and must close,
   not an inherited one.

`expo-sharing` and `expo-file-system` aren't installed yet — exact `bun add`
commands go in the implementation plan.

**Import (`importVault.ts` + `app/(app)/settings/import.tsx`):**

1. `expo-document-picker` (also not installed yet) opens the file picker.
2. Read the CSV text, parse rows, map each through `csvRowToEntry`.
3. Call `VaultContext.createEntry(...)` once per row — the normal offline-first
   create path, so each entry is properly client-side encrypted and queued exactly
   like a manually-created entry. No bulk-insert bypass.
4. Show a summary screen: "N imported."

**Known limitation, not a defect:** importing many entries quickly can exceed the
backend's 30 writes/minute rate limit on `POST /vault`. Not dangerous — Plan 2's
sync engine already retries failed queued ops on the next sync — but a large
import may take a few minutes to fully land server-side rather than completing
instantly.

## Testing approach

- **`session.ts`'s `shouldPersistSession()`** — unit tested against all four
  combinations of hardware-availability × preference.
- **`preferences.ts`** — thin `SecureStore` reads/writes, tested the same way as
  the existing `session.test.ts` (mock `expo-secure-store`, assert calls/defaults).
- **`AuthContext`'s biometric-toggle handling** — extends `AuthContext.test.tsx`
  with the established `Probe`/`Capture` pattern: toggling on calls `saveSession`,
  toggling off calls `clearSession`.
- **Account deletion backend endpoint** — mirrors the existing `/auth/login` test
  style: correct `auth_key` + valid token → 204, user/entries gone from the DB;
  wrong `auth_key` → 401, nothing deleted; no token → 401.
- **Account deletion mobile flow** — screen-level smoke test (wrong password shows
  an error; correct password calls `deleteAccount` then clears state), consistent
  with Plan 2's entry-delete confirmation test.
- **`csvFormat.ts`, `exportVault.ts`, `importVault.ts`** — pure-function unit
  tests: round-trip `VaultEntryContent[]` through `entryToCsvRow`/`csvRowToEntry`;
  confirm `escapeCsvCell` prefixes a value starting with `=`; confirm
  `importVault` calls `createEntry` once per parsed row.
- **Settings/import/export screens** — light smoke tests, same bar as Plan 2's
  screens.

## Out of scope for this plan

- PIN-based unlock (superseded by the simpler no-biometric-fallback decision above).
- Bitwarden/1Password import formats.
- Import conflict/duplicate detection.
- Vault-entry sharing between accounts (deferred earlier, stays deferred).
