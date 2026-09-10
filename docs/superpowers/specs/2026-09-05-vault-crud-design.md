# Vault CRUD Design — apps/api

**Date:** 2026-09-05
**Status:** Approved by user, pending implementation plan
**Scope:** `apps/api` only. Defines the storage contract and API surface for
encrypted vault entries. Client-side encryption/decryption is explicitly
NOT part of this pass — that's future client-app work (`apps/cli`,
`apps/extension`). This pass only defines what the server stores and the
API for storing/retrieving already-encrypted blobs.

## Context

Builds directly on the auth feature (`docs/superpowers/specs/2026-09-04-auth-feature-design.md`):
every route in this feature requires the `get_current_user` dependency
(`app/auth/dependencies.py`), which resolves a valid JWT to a `User` row.

This is the first feature to touch the project's zero-knowledge principle
in practice: per CLAUDE.md, "the backend should never receive or store
plaintext passwords, only ciphertext."

## Entry shape: opaque ciphertext only (no plaintext label)

The server stores one encrypted blob per vault entry — site name, username,
password, and notes are all encrypted together client-side before ever
reaching the server. The server cannot render a list of "your saved sites"
without the client decrypting everything first.

Rejected alternative: storing an unencrypted label/site field alongside
the ciphertext, so a client could show a scrollable list without decrypting
each entry. Rejected because it means the server (and anyone who breaches
it) learns which sites a user has accounts on, even though it never learns
passwords — a real information leak this design chooses not to accept, in
favor of maximum zero-knowledge. A future client can still show useful
list items without server-side plaintext by lazily decrypting and caching
client-side.

## Ciphertext wire/storage format: one combined blob

AES-GCM (or whatever authenticated-encryption scheme a client uses) needs
a nonce/IV alongside the ciphertext to decrypt. Rather than the server
storing nonce and ciphertext as separate columns, the client concatenates
nonce + ciphertext + auth tag into a single string (e.g. base64-encoded)
before sending. The server stores this as one opaque `Text` column and
never parses its internal structure. This keeps the server's schema fully
decoupled from any detail of the client-side encryption scheme — if the
scheme ever changes, only client code changes, never the server schema.

## Data model

New table `vault_entries`, new feature module `app/vault/` (mirrors
`app/auth/`'s structure: `models.py`, `schemas.py`, `router.py`):

```python
class VaultEntry(Base):
    __tablename__ = "vault_entries"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    ciphertext: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
```

- `ciphertext` is `Text` (unbounded), not a capped `String(N)` — a
  client-encrypted blob has no natural length limit and the server has no
  basis for enforcing one, since it can't see what's inside.
- `user_id` is indexed since every query in this feature filters by it.
- `updated_at` auto-refreshes on every write (SQLAlchemy `onupdate`), giving
  "last changed" for free with no application-level bookkeeping.

Requires one new Alembic migration (`create vault_entries table`), no
changes to the existing `users` table.

## Endpoints (`app/vault/router.py`, prefix `/vault`)

Every route requires `get_current_user` — there is no unauthenticated way
to touch vault data.

### `POST /vault`
- Body: `VaultEntryCreate {ciphertext: str}` (non-empty, validated).
- Creates an entry owned by the caller (`user_id = current_user.id`).
- Success → `201` + `VaultEntryResponse`.

### `GET /vault`
- Returns only the caller's own entries, newest first (`ORDER BY created_at DESC`).
- Success → `200` + `list[VaultEntryResponse]`.

### `GET /vault/{id}`
- Returns the entry if it exists **and** belongs to the caller.
- Not found, OR exists but belongs to someone else → identical `404`.
- **Why 404 for both cases, not 403 for "exists but not yours":** mirrors
  the enumeration-avoidance principle already established in the auth
  feature's login endpoint — never let a response confirm "this ID is a
  real vault entry, just not yours." A `403` would leak that information;
  a uniform `404` doesn't.
- Success → `200` + `VaultEntryResponse`.

### `PUT /vault/{id}`
- Body: `VaultEntryUpdate {ciphertext: str}` (same validation as create).
- Full replace — there is no partial update for an opaque encrypted blob;
  the client always re-encrypts and resends the whole thing.
- Same ownership rule as `GET /vault/{id}`: `404` if not the caller's.
- Success → `200` + updated `VaultEntryResponse` (`updated_at` advances).

### `DELETE /vault/{id}`
- Same ownership rule: `404` if not the caller's.
- Success → `204 No Content`.

## Ownership enforcement

Every lookup checks existence and ownership in a single query condition:
`WHERE id = :id AND user_id = :current_user_id`. This is deliberate — a
two-step "look up the row, then check if it belongs to the caller" is
exactly the shape of logic where the second check can accidentally get
skipped in a future edit. One query, one condition, cannot be bypassed by
omitting a step.

## No pagination (for now)

`GET /vault` returns the full list, unpaginated. YAGNI: this is a
personal-scale vault, not a system expected to hold thousands of entries
per user. Revisit if that assumption changes.

## Schemas (`app/vault/schemas.py`)

```python
class VaultEntryCreate(BaseModel):
    ciphertext: str

    @field_validator("ciphertext")
    @classmethod
    def not_empty(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("ciphertext must not be empty")
        return value


class VaultEntryUpdate(VaultEntryCreate):
    pass


class VaultEntryResponse(BaseModel):
    model_config = {"from_attributes": True}
    id: int
    ciphertext: str
    created_at: datetime
    updated_at: datetime
```

`VaultEntryUpdate` inherits `VaultEntryCreate` (same pattern as
`RegisterRequest`/`LoginRequest` sharing `AuthCredentials` in the auth
feature) — same validation, kept as a distinct class in case create/update
ever need to diverge.

## Testing plan

Mirrors the auth feature's approach: the existing `client`/`db_session`
pytest fixtures (real DB, `@pytest.local`-domain cleanup), extended to
also clean up any `vault_entries` rows created by test users.

- Create → `201`, returns an entry with an `id`.
- List → returns only the caller's entries, not another user's (create
  entries as two different users, assert isolation).
- Get one (own) → `200`; get one (someone else's id) → `404`; get one
  (nonexistent id) → `404` (identical response, per the ownership design).
- Update (own) → `200`, `ciphertext` changed, `updated_at` advanced;
  update (someone else's) → `404`.
- Delete (own) → `204`, then a follow-up `GET` on that id → `404`;
  delete (someone else's) → `404`.
- Every route without a valid token → `401` (one smoke test per route,
  not a full re-test of auth itself — that's already covered by the auth
  feature's own tests).
- Empty `ciphertext` on create/update → `422`.

## Explicitly out of scope (future work, not built now)

- Client-side encryption/decryption itself (`apps/cli`, `apps/extension`,
  `apps/mobile` — none of these apps are touched by this pass).
- Pagination (see above).
- Versioning/entry history (YAGNI — not requested).
- Bulk operations (bulk create/delete).
- Search/filtering server-side (impossible without breaking zero-knowledge
  — the server cannot search encrypted content).
