# Auth Feature Design — apps/api

**Date:** 2026-09-04
**Status:** Approved by user, pending implementation plan
**Scope:** `apps/api` only. Defines the API contract that `apps/cli`, `apps/extension`, and `apps/mobile` must all implement client-side; none of those apps are built in this pass.

## Context

The password manager is zero-knowledge: the server must never see the master
password or anything that could derive vault-decryption keys. It supports
multiple independent user accounts (not a single-user personal vault), so
registration is a real, publicly reachable endpoint.

The `users` table already exists (migration `a4c09501d04f`): `id`, `email`
(unique), `hashed_password`, `created_at`. This design requires **no schema
change** — see "Salt strategy" below for why.

## Salt strategy: email-as-salt (Bitwarden pattern)

Rejected alternative: server generates a random salt at registration, stores
it, and exposes a `GET /auth/prelogin?email=...` lookup so returning clients
can fetch it before deriving keys. Rejected because it needs an extra
round-trip on every login and the lookup endpoint leaks account existence
unless mitigated with a fake-salt fallback.

**Chosen approach:** the client derives its keys using the user's own
(lowercased, trimmed) email address as the KDF salt, with a fixed iteration
count baked into every client. No salt to store server-side, no lookup
endpoint, no enumeration surface from salt lookups. Trade-off: changing your
email later requires a re-encryption flow (future feature, out of scope now).

## Client-side key derivation (contract for future clients — not built now)

1. `master_key = PBKDF2-HMAC-SHA256(master_password, salt=lowercase(trim(email)), iterations=600_000, length=32)`
2. From `master_key`, derive two cryptographically distinct values via HKDF
   with different context/info strings:
   - `vault_key` — stays on-device only, encrypts/decrypts vault entries.
   - `auth_key` — sent to the server; this is what `/auth/register` and
     `/auth/login` receive in place of a password.

This domain separation is the core zero-knowledge guarantee: even a fully
compromised server never held anything capable of decrypting a vault.

## Endpoints (`apps/api/app/auth/`)

### `POST /auth/register`
- Body: `{email: str, auth_key: str}`
- `auth_key` is the 32-byte HKDF output, base64-encoded on the wire (44
  characters). Schema validation rejects any string not exactly that
  length — this is what stops a raw password from ever reaching this
  endpoint by mistake.
- Server Argon2-hashes `auth_key` (via `argon2-cffi`, already installed) and
  stores `{email, hashed_password}`.
- Duplicate email → `409 {"detail": "Email already registered"}`. This leaks
  email existence on registration; accepted as an industry-standard
  trade-off (same behavior as Bitwarden, GitHub, etc.) rather than adding
  email-verification flow complexity.
- Success → `201` + `{access_token, token_type}` (auto-login).
- Rate limited: 5 requests/minute per IP (`slowapi`).

### `POST /auth/login`
- Body: `{email: str, auth_key: str}` (`auth_key` same base64 encoding as
  registration)
- Looks up user by normalized email, Argon2-verifies `auth_key` against the
  stored hash.
- **Enumeration protection:** identical generic response for "no such user"
  and "wrong auth_key" — `401 {"detail": "Invalid email or password"}`. When
  the email doesn't exist, the server still runs an Argon2 verify against a
  fixed dummy hash, so response timing doesn't distinguish the two cases.
- Success → `200` + `{access_token, token_type}`.
- Rate limited: 5 requests/minute per IP (`slowapi`).

### `GET /auth/me`
- Requires `Authorization: Bearer <token>`.
- Decodes and validates the JWT, loads the user, returns `{id, email}`.
- Invalid/expired/missing token → `401 {"detail": "Could not validate credentials"}`.
- Introduces the `get_current_user` dependency that every future vault-CRUD
  endpoint will reuse.

## JWT

- Payload: `{sub: <user id>, exp: <now + access_token_expire_minutes>}`.
- Signed HS256 with `settings.jwt_secret_key` (`python-jose`, already
  installed; `access_token_expire_minutes` already in `Settings`, default 30).
- No refresh token in this design. Genuine YAGNI: this is a UX convenience
  (avoiding re-login every 30 min), not a security requirement — a
  short-lived token with no refresh mechanism has a *smaller* attack
  surface (nothing long-lived to steal, no revocation-list table needed).
  Revisit only if frequent re-auth proves annoying in practice.

## Explicitly out of scope (future work, not built now)

- Refresh tokens (see above).
- Account lockout after repeated failed logins (rate limiting covers the
  brute-force case for now).
- `auth_key`/password rotation.
- Email verification on registration.
- Email-change flow (blocked on re-encryption design, since email is the
  KDF salt).

## Testing plan

- `app/auth/security.py` (JWT helpers, separate from the existing
  `app/security.py` password hashing): `create_access_token` payload
  contains `sub`/`exp`; `decode_access_token` round-trips a valid token and
  raises on expired/tampered/malformed tokens.
- `app/auth/schemas.py`: malformed email or wrong-length `auth_key` →
  `422`.
- `app/auth/router.py` integration tests (`TestClient` + test DB session):
  - register succeeds → token returned
  - duplicate email → `409`
  - login with correct `auth_key` → `200` + token
  - login with wrong `auth_key` → generic `401`
  - login with nonexistent email → same generic `401` (proves no
    enumeration difference)
  - `/auth/me` with valid token → `200`
  - `/auth/me` with missing/expired/invalid token → `401`
  - 6th `/auth/login` call within a minute from the same IP → `429`

## New dependency required

- `slowapi` (in-memory rate limiting, no Redis needed — appropriate for a
  single API instance). User will run `uv add slowapi` before
  implementation.
