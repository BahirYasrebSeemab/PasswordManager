# Password Manager

A zero-knowledge password manager built from scratch as a multi-client monorepo: a FastAPI backend, a React Native/Expo mobile app, and (in progress) a browser extension and CLI. The server never sees a plaintext password, a master password, or a vault entry — only opaque ciphertext and a login credential that's mathematically derived from, but can't be reversed into, the master password.

## Why zero-knowledge

Most "password managers" trust the server with more than they need to. Here, every credential a client ever sends the API is either:

- **`auth_key`** — used only to authenticate, derived from the master password in a way that reveals nothing about it, or
- **`ciphertext`** — a vault entry, already AES-256-GCM encrypted on-device before it ever leaves the client.

If the backend or its database were fully compromised, an attacker would get encrypted blobs and password-hash-of-a-derived-key material — never a usable password, and never the vault encryption key.

## Architecture

```
apps/
  api/         FastAPI backend — source of truth for accounts and encrypted vault entries
  mobile/      Expo/React Native app — iOS, Android, and web from one codebase
  extension/   Zen/Firefox browser extension (Manifest V3): login, vault, autofill, save prompt
  cli/         Typer-based CLI client (not yet started)
infra/
  terraform/   AWS infrastructure as code (not yet started)
```

Every `apps/*` directory is independent — none of them import from another. They only agree on one thing: the API contract, and the client-side crypto scheme described below, which every client must implement identically to interoperate with the same account.

## The crypto scheme

All of this happens **client-side**, before anything touches the network:

```
master_key = PBKDF2-HMAC-SHA256(master_password, salt = lowercase(trim(email)), iterations = 600,000, length = 32)
prk        = HKDF-Extract-SHA256(salt = 32 zero bytes, ikm = master_key)
vault_key  = HKDF-Expand(prk, info = "password-manager/vault_key/v1", 32)   // encrypts/decrypts vault entries
auth_key   = HKDF-Expand(prk, info = "password-manager/auth_key/v1", 32)   // sent to the server to authenticate
```

- The master password itself **never leaves the device**, in any form.
- `vault_key` never leaves the device either — it's used locally to AES-256-GCM encrypt/decrypt entries. The server only ever stores/returns the resulting ciphertext.
- `auth_key` is what gets sent to `/auth/register` and `/auth/login` — the server Argon2-hashes it, same as any other password-based login, but it's not the master password and can't be turned back into one or into `vault_key`.
- Because `vault_key` and `auth_key` are derived independently from the same root (`prk`), a server breach that exposes the hashed `auth_key` still can't derive `vault_key` and decrypt anyone's vault.

Every client (mobile, and later the extension/CLI) implements this exact derivation so the same account works everywhere — the mobile app's `src/crypto/deriveKeys.ts` is the reference implementation.

## Apps

### `apps/api` — Backend

FastAPI + PostgreSQL, source of truth for accounts and vault entries. Never touches plaintext.

**Endpoints:**

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/auth/register` | Create an account (`email` + `auth_key`) |
| `POST` | `/auth/login` | Exchange `auth_key` for a JWT access token |
| `GET` | `/auth/me` | Current user info |
| `DELETE` | `/auth/me` | Delete the account and every vault entry it owns (re-verifies `auth_key`) |
| `POST` | `/vault` | Create a vault entry (ciphertext only) |
| `GET` | `/vault` | List the current user's vault entries |
| `GET` | `/vault/{id}` | Fetch one entry (404 for both "not found" and "not yours") |
| `PUT` | `/vault/{id}` | Update an entry's ciphertext |
| `DELETE` | `/vault/{id}` | Delete an entry |

**Security properties:** Argon2 hashing of `auth_key`, JWT access tokens (HS256, explicit algorithm allow-list — closes `alg: none` and algorithm-confusion attacks), rate limiting on every endpoint (5/min on auth, 30/min on vault writes, 60/min on vault reads), login-enumeration protection (constant-time response whether or not an email exists), ASCII-only emails (keeps the PBKDF2 salt unambiguous across clients).

**Stack:** FastAPI, SQLAlchemy 2.0, Alembic, Pydantic v2, Argon2, `python-jose`, `slowapi`, PostgreSQL.

### `apps/mobile` — Mobile app (iOS / Android / Web)

Expo Router app covering the full vault lifecycle:

- **Auth & unlock:** register/login, biometric unlock with a proper OS-capability check (falls back to full master-password login on devices without biometric hardware, rather than the silent failure mode a naive implementation would hit), configurable auto-lock on backgrounding.
- **Vault:** create/edit/delete entries, all encrypted client-side before touching local storage or the network.
- **Offline-first sync:** entries are cached locally (SQLite) and queued for sync, so the app works fully offline and reconciles when back online.
- **Conflict resolution:** if the same entry is edited on two devices between syncs, the app detects it via optimistic concurrency (comparing the server's `updated_at` against the last-known baseline) and lets the user pick which version to keep — never silently overwrites either.
- **Account & settings:** biometric toggle, auto-lock timeout, account deletion.
- **Import/export:** CSV in the Chrome/Firefox export shape, with CSV-formula-injection escaping on export.

**Stack:** Expo SDK 57, Expo Router, React 19, React Native 0.86, TypeScript, NativeWind/Tailwind, `expo-sqlite`, `expo-secure-store`, `@noble/hashes` + `@noble/ciphers` (pure-JS, audited, zero native crypto dependencies — the same crypto module works identically on-device and in tests). Tests via Jest + `jest-expo` + `@testing-library/react-native`.

```
apps/mobile/src/
  crypto/       Key derivation, AES-GCM encrypt/decrypt
  api/          Typed HTTP client for the backend
  context/      AuthContext (session/unlock), VaultContext (entries/sync)
  db/           Local SQLite cache + pending-operations sync queue
  sync/         The offline-sync engine (flush queue, pull remote, detect conflicts)
  import-export/  CSV format, export, import
  settings/     Local user preferences (biometric, auto-lock)
  components/, theme/  UI
apps/mobile/app/   Expo Router screens
```

### `apps/extension` — Browser extension

Implemented for Zen/Firefox: login, vault browsing/editing, click-to-fill autofill, a
save/update prompt, and idle auto-lock. Reuses the mobile app's crypto scheme and the same
API. Chrome build planned. See `apps/extension/README.md`.

### `apps/cli` — CLI (not started)

Planned once the extension is far enough along, if it turns out to be a small addition on top of the same crypto/API layer.

### `infra/terraform` — Infrastructure (not started)

AWS deployment, to be added when the app is ready to go live.

## Project status

| App | Status |
|---|---|
| `apps/api` | Auth + vault CRUD complete, rate-limited, tested |
| `apps/mobile` | Auth/unlock, vault CRUD, offline sync + conflict resolution, settings, account deletion, import/export — complete |
| `apps/extension` | Zen/Firefox build complete (login, vault, autofill, save prompt); Chrome not started |
| `apps/cli` | Not started |
| `infra/terraform` | Not started |

## Getting started

**Backend:**
```bash
cd apps/api
uv sync
# Postgres running (see docker-compose.yml), then:
uv run alembic upgrade head
uv run uvicorn app.main:app --reload
```

**Mobile:**
```bash
cd apps/mobile
cp .env.example .env   # point EXPO_PUBLIC_API_URL at your running backend
bun install
bun start
```

**Browser extension** (Zen/Firefox):
```bash
cd apps/extension
cp .env.example .env   # point VITE_API_URL at your running backend
bun install
bun run build
```
Then open `about:debugging#/runtime/this-firefox` → "Load Temporary Add-on..." → select
`apps/extension/dist/manifest.json`. See `apps/extension/README.md` for the full manual
test checklist.

Each app has its own test suite (`uv run pytest` for the backend, `bun x jest` for mobile,
`bun test` for the extension) and its own `CLAUDE.md`/`AGENTS.md` with app-specific
conventions.

## Design docs

Every feature was designed before it was built — full specs and implementation plans live in `docs/superpowers/specs/` and `docs/superpowers/plans/`, including the rationale behind the crypto scheme, the offline-sync/conflict-resolution design, and the account-settings/import-export design.

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md) — in particular, the ground rules around the
zero-knowledge architecture and cross-client crypto consistency before touching anything
security-sensitive.

## Reporting a security issue

Please don't open a public issue for a vulnerability — see [`SECURITY.md`](SECURITY.md)
for how to report one privately.

## License

MIT — see [`LICENSE`](LICENSE).
