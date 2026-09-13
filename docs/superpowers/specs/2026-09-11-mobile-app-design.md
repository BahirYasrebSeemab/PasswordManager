# Mobile App (apps/mobile) Design

**Date:** 2026-09-11
**Status:** Approved by user, pending implementation plan
**Scope:** `apps/mobile` only — a React Native/Expo app (EAS build/submit),
consuming the existing `apps/api` backend (auth: register/login/me; vault:
full CRUD, both rate-limited). No changes to `apps/api`, `apps/cli`, or
`apps/extension`. Per CLAUDE.md's strict-modularity rule, `apps/mobile` talks
to the backend only over its HTTP API contract — no shared code with any
other app in the monorepo.

## Context

This is the first client application to actually implement the auth
feature's client-side key derivation. `docs/superpowers/specs/2026-09-04-auth-feature-design.md`
established the scheme (PBKDF2-HMAC-SHA256 master key, HKDF-derived
`vault_key`/`auth_key` with domain separation) and built the server side of
it, but no client ever implemented the derivation — the auth feature's own
tests exercise the server with pre-computed `auth_key` values, not real
client-side derivation code. This spec is where that derivation gets a
concrete, canonical implementation for the first time. **Every literal value
pinned below (HKDF info strings, byte lengths, encodings) is binding for any
future client** — the CLI and browser extension must reproduce them exactly,
or their users won't be able to log into accounts created on mobile, and
vice versa.

## Client-side key derivation (canonical, first implementation)

```
master_key = PBKDF2-HMAC-SHA256(
    password = master_password,
    salt     = lowercase(trim(email)),
    iterations = 600_000,
    dkLen    = 32,
)

prk = HKDF-Extract-SHA256(salt = <32 zero bytes>, ikm = master_key)

vault_key = HKDF-Expand-SHA256(prk, info = "password-manager/vault_key/v1", length = 32)
auth_key  = HKDF-Expand-SHA256(prk, info = "password-manager/auth_key/v1",  length = 32)
```

- `master_password` and `email` are UTF-8 encoded before hashing; email is
  lowercased and trimmed first, matching the server's own email
  normalization (`app/auth/schemas.py`'s `normalize_email`), so client and
  server agree on the salt without any round-trip.
- HKDF-Extract's salt is fixed at 32 zero bytes (not per-user) — `master_key`
  is already high-entropy PBKDF2 output, so a random extract-salt buys
  nothing; a fixed one keeps the derivation fully deterministic from
  `(email, master_password)` alone, which is required since nothing else is
  available to derive from before the user has ever logged in anywhere.
- The `info` strings are versioned (`/v1`) so a future change to either
  derivation (e.g. a KDF migration) can introduce `/v2` without silently
  colliding with existing accounts' derived keys.
- `auth_key` is base64-encoded before being sent to the server, matching
  `AUTH_KEY_BYTE_LENGTH = 32` / 44-character wire format already enforced by
  `app/auth/schemas.py`.
- Library: `@noble/hashes` provides `pbkdf2`, `hkdf` (both SHA-256 based)
  with no native dependencies — see Section "Crypto library choice" below
  for why this was chosen over native-binding alternatives.

**Where each key lives:**
- `master_key` — computed, used immediately to derive the two keys below,
  then discarded. Never persisted, never held longer than one JS
  synchronous scope.
- `vault_key` — persisted in Expo SecureStore (`requireAuthentication: true`),
  loaded into memory (React Context) after each successful unlock. Used to
  encrypt/decrypt every vault entry.
- `auth_key` — persisted in Expo SecureStore (`requireAuthentication: true`),
  alongside `vault_key`. Used to silently re-authenticate (`POST
  /auth/login`) and obtain a fresh `access_token` without re-prompting for
  the master password. See "Auth & unlock flow" for the reasoning and the
  accepted risk tradeoff.
- `access_token` — persisted in SecureStore (`requireAuthentication: true`),
  refreshed silently on unlock and on any `401` from the API.

## Crypto library choice

`@noble/hashes` (PBKDF2, HKDF) + `@noble/ciphers` (AES-GCM, for entry
encryption). Chosen over `react-native-quick-crypto` and `libsodium`
because:
- Pure TypeScript, zero native dependencies — no linking, works in Expo Go
  during development, no divergent behavior between iOS/Android since
  there's no platform-specific native code path.
- Widely audited (Trail of Bits), used in production by major
  cryptocurrency wallets — a bar of scrutiny appropriate for a password
  manager.
- The scheme is fixed as PBKDF2 (not Argon2/scrypt) by the already-shipped
  server design, so libsodium's Argon2 strengths aren't usable here without
  breaking cross-client compatibility.

Accepted cost: 600,000 PBKDF2 iterations in pure JS takes a few seconds on
older devices. This only runs on first login/registration or a biometric
fallback (see below) — not on every app open — so a "deriving your key…"
loading state is sufficient mitigation. Revisit only if this proves a real
problem in practice.

**Random number generation:** `@noble/*` requires a real CSPRNG
(`crypto.getRandomValues`), which React Native does not provide by default.
`react-native-get-random-values` must be imported once, at the very top of
the app's entry point, before any `@noble/*` import — this is a hard
requirement, not a suggestion; skipping it silently degrades to a weak
fallback in some environments.

## Auth & unlock flow

**Register / login (first time on this device):** user enters email +
master password. Client derives `master_key` → `vault_key`/`auth_key` per
the scheme above. `POST /auth/register` or `POST /auth/login` with
`{email, auth_key}` → `access_token`. On success, `vault_key`, `auth_key`,
and `access_token` are all written to SecureStore with
`requireAuthentication: true`, and the OS prompts to enroll Face
ID/fingerprint protection for that keychain entry if not already enrolled.

**Reopening the app (the common case):** SecureStore read is attempted for
`vault_key`/`auth_key`/`access_token`; `requireAuthentication: true` makes
iOS/Android trigger the biometric prompt automatically as part of that read
— the OS enforces the gate, not app code. On success: `vault_key` decrypts
cached entries immediately: `auth_key` is used to silently call `POST
/auth/login` in the background and replace `access_token`, so the user never
sees a re-login screen even though the previous token (30-minute lifetime)
has likely expired. On biometric failure/cancel/unavailable: fall back to
the master password screen, re-derive both keys, proceed as a fresh login.

**Why `auth_key` is persisted, not just `vault_key` (accepted tradeoff,
confirmed with the user):** the server issues no refresh token — the only
way to obtain a new `access_token` is a full `/auth/login` call with
`auth_key`, and the master password is deliberately never stored. Without
persisting `auth_key`, the app would need to re-prompt for the master
password every ~30 minutes of use, defeating the point of biometric unlock.
Persisting it alongside `vault_key`, behind the identical hardware-backed
protection, means: a device compromise severe enough to defeat
SecureStore's biometric gate (jailbreak/root + keychain extraction) now
grants indefinite account impersonation via the API, not just decryption of
already-cached data — a real, understood increase in blast radius, bounded
to that already-severe compromise scenario. Matches the pattern used by
mainstream password managers (Bitwarden, 1Password).

**Logout:** clears `vault_key`, `auth_key`, `access_token` from SecureStore
and from memory (React Context reset).

## Vault CRUD & offline sync

On unlock, `GET /vault` is fetched and each entry's ciphertext + metadata
(`id`, `created_at`, `updated_at`) is cached locally (SQLite,
`expo-sqlite`). **Only ciphertext is ever cached — never plaintext.**
Viewing an entry decrypts it (AES-GCM via `@noble/ciphers`, using
`vault_key`) into memory for that screen only; nothing decrypted is ever
written back to disk.

- **Create:** encrypt the full entry client-side (fresh random nonce each
  time — required for AES-GCM safety), `POST /vault`. Online: on success,
  insert the server-returned row into the local cache. Offline: insert a
  locally-tagged pending row (`sync_status = 'pending_create'`), queue the
  operation.
- **Update:** same encrypt-the-whole-entry pattern (mirrors the API's
  full-replace-only `PUT /vault/{id}`), `sync_status = 'pending_update'` if
  offline.
- **Delete:** `DELETE /vault/{id}`; offline, mark `sync_status =
  'pending_delete'` (tombstone, hidden from the list) rather than removing
  the row immediately, so the queued delete can still find it.
- **Sync queue:** a `pending_operations` table, flushed in order on
  reconnect (network-state listener) or app foreground. Given this is a
  single-user personal vault, not a multi-device concurrent-editing product,
  conflict resolution is last-write-wins by operation order — no CRDT/merge
  logic. Revisit only if real multi-device conflicts become a problem;
  building for that now would be speculative (YAGNI).

## Local data model (SQLite)

```
vault_entries_cache
  id            INTEGER   -- server id once synced; negative local temp id until then
  ciphertext    TEXT
  created_at    TEXT      -- ISO 8601
  updated_at    TEXT
  sync_status   TEXT      -- 'synced' | 'pending_create' | 'pending_update' | 'pending_delete'

pending_operations
  id            INTEGER PRIMARY KEY AUTOINCREMENT
  op_type       TEXT      -- 'create' | 'update' | 'delete'
  entry_id      INTEGER   -- references vault_entries_cache.id
  payload       TEXT      -- JSON: the ciphertext to send, for create/update
```

Both tables are local-only structural cache — no design-time equivalent of a
migration system is needed at this scope; `expo-sqlite`'s own schema-version
pragma handles future column additions if/when they're needed.

## Design system

Per the `expo-design-system` skill's model: no existing token system in this
brand-new app, so one is created at `src/theme/` (colors, spacing,
typography, radius, shadows, motion — one file per class, re-exported from
`src/theme/index.ts`). For a NativeWind project, tokens are additionally
exposed as CSS variables in `global.css` per that skill's Tailwind-specific
guidance, so both token-object imports and `className` utilities read from
the same source of truth.

**Visual direction — "Vault": dark-first, warm accent, restrained.**
Rejected the genre-default blue/purple (1Password, Bitwarden) as
undifferentiated. Palette: near-black obsidian surfaces, a warm brass/amber
accent (`useBrandColors()` light/dark pair) used sparingly — primary
actions, the unlock button, active states — never smeared across the whole
UI. Light mode: warm off-white background, same amber accent, so the app
doesn't read as a different product depending on system theme. Entry
metadata (timestamps, sync status) renders in a monospace accent against
the otherwise system-font UI, a small technical texture reinforcing "this is
a security tool" without a full hacker-terminal aesthetic.

Component primitives (`Button`, `Card`, `EmptyState`, etc.) live in
`src/components/`, built per the skill's contract (variants/sizes/states,
`style` prop merged last, composition over prop-explosion). Screen-local
compositions stay colocated under `screens/<name>/` until a second screen
needs them — no speculative extraction.

## Project structure

```
apps/mobile/
  app/                      # Expo Router — file = route
    _layout.tsx              # root layout: AuthContext + VaultContext providers
    (auth)/
      login.tsx
      register.tsx
    (app)/                   # only reachable once unlocked
      _layout.tsx             # biometric-gate check
      (tabs)/
        index.tsx              # vault list
        settings.tsx
      entry/[id].tsx
      entry/new.tsx
  src/
    theme/                   # design tokens (see Design System)
    components/              # shared primitives (Button, Card, EmptyState, ThemedText)
    crypto/                  # PBKDF2/HKDF derivation, AES-GCM encrypt/decrypt
    api/                     # typed HTTP client (register, login, vault CRUD)
    context/                 # AuthContext, VaultContext (React Context, per user preference)
    db/                      # SQLite cache + pending_operations queue
```

## Testing approach

Jest + React Native Testing Library, mirroring `apps/api`'s TDD discipline
(RED before GREEN, one behavior per test). Crypto derivation gets dedicated
test vectors (fixed email/password pairs with hand-verified expected
`master_key`/`vault_key`/`auth_key` bytes) since a silent derivation bug
would be a correctness-critical, hard-to-detect failure mode — a wrong key
doesn't crash, it just silently produces garbage plaintext or a server
`401`. API client and sync-queue logic get integration-style tests against
a mocked `fetch`. UI components get interaction tests (press, disabled
state, loading state) per the design system's component contract.

## Explicitly out of scope for this pass

- Password/master-password change flow.
- Account deletion.
- Sharing vault entries between accounts.
- A biometric-settings/preferences screen (biometric behavior is fixed as
  described above for v1).
- Multi-device conflict resolution beyond last-write-wins.
- App Store/Play Store submission polish (icons, screenshots, listing
  metadata) — covered later by EAS submit tooling, not this design.
