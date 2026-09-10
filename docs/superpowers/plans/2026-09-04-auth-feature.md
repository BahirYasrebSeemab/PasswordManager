# Auth Feature (register/login/me) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `POST /auth/register`, `POST /auth/login`, and `GET /auth/me` in `apps/api`, implementing the zero-knowledge, email-as-salt auth design already approved by the user.

**Architecture:** FastAPI router in a new `app/auth/` feature module, backed by the existing `User` SQLAlchemy model, Argon2 password hashing (existing `app/security.py`), JWT issuance via `python-jose`, and per-IP rate limiting via `slowapi`. No database schema changes are needed — the existing `users` table already has everything this design requires.

**Tech Stack:** FastAPI, SQLAlchemy 2.0 (2.0-style `select()` queries), Pydantic v2, `python-jose[cryptography]`, `argon2-cffi` (via existing `app/security.py`), `slowapi` (already added by the user via `uv add slowapi`), `pytest` + `httpx`/`TestClient`.

**Spec:** `docs/superpowers/specs/2026-09-04-auth-feature-design.md`

## Global Constraints

- `auth_key` on the wire is always exactly the 32-byte HKDF output, base64-encoded (44 characters). Reject anything else with a Pydantic validation error (FastAPI turns this into `422` automatically).
- Login failures (wrong password OR unknown email) return the identical `401 {"detail": "Invalid email or password"}`. Timing must not distinguish the two cases — always run one Argon2 verify per login attempt, against a real hash or a fixed dummy hash.
- Register on a duplicate email returns `409 {"detail": "Email already registered"}`.
- JWT: HS256, payload `{"sub": <user id as string>, "exp": <now + access_token_expire_minutes>}`, signed with `settings.jwt_secret_key` (already in `app/core/config.py`). No refresh tokens — deliberate YAGNI per spec.
- Rate limit: 5 requests/minute per IP on both `/auth/register` and `/auth/login`, via `slowapi`, in-memory (no Redis).
- No changes to the `User` model or any Alembic migration — the table already matches this design exactly.
- No new dependencies are needed for this plan (`slowapi` is already installed). Do not run `uv add`/`uv remove` for anything.
- Never run `git add`, `git commit`, or `git push`. Every task ends with a review checkpoint: show the diff and a suggested commit message, then stop — the user commits it themselves.
- After each task, explain what was built in plain language (what/how/why/boundaries) per the project's CLAUDE.md — this code is security-critical (auth), so the explanation should go deeper than routine CRUD.
- Running `uv run pytest` is expected and fine for the executor to do directly — it's test execution, not a package install or a schema-mutating command.

---

### Task 1: JWT token helpers

**Files:**
- Create: `apps/api/app/auth/security.py`
- Test: `apps/api/tests/test_auth_security.py`

**Interfaces:**
- Consumes: `app.core.config.get_settings()` → `Settings` with `.jwt_secret_key: str`, `.jwt_algorithm: str`, `.access_token_expire_minutes: int` (all already implemented).
- Produces: `create_access_token(subject: int) -> str`, `decode_access_token(token: str) -> int`, `class InvalidTokenError(Exception)`. Task 4's register endpoint and Task 6's `get_current_user` dependency both import these three names directly from `app.auth.security`.

- [ ] **Step 1: Write the failing tests**

Create `apps/api/tests/test_auth_security.py`:

```python
from datetime import datetime, timedelta, timezone

import pytest
from jose import jwt

from app.auth.security import InvalidTokenError, create_access_token, decode_access_token
from app.core.config import get_settings


def test_create_access_token_embeds_the_subject_and_an_expiry():
    token = create_access_token(subject=42)

    settings = get_settings()
    payload = jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])

    assert payload["sub"] == "42"
    assert "exp" in payload


def test_decode_access_token_round_trips_a_valid_token():
    token = create_access_token(subject=42)

    user_id = decode_access_token(token)

    assert user_id == 42


def test_decode_access_token_raises_for_a_tampered_token():
    token = create_access_token(subject=42)
    tampered_token = token[:-1] + ("a" if token[-1] != "a" else "b")

    with pytest.raises(InvalidTokenError):
        decode_access_token(tampered_token)


def test_decode_access_token_raises_for_an_expired_token():
    settings = get_settings()
    expired_payload = {"sub": "42", "exp": datetime.now(timezone.utc) - timedelta(minutes=1)}
    expired_token = jwt.encode(expired_payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)

    with pytest.raises(InvalidTokenError):
        decode_access_token(expired_token)


def test_decode_access_token_raises_for_a_malformed_token():
    with pytest.raises(InvalidTokenError):
        decode_access_token("this-is-not-a-jwt")
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && uv run pytest tests/test_auth_security.py -v`
Expected: FAIL/ERROR — `app.auth.security` does not exist yet (`ModuleNotFoundError`).

- [ ] **Step 3: Write the minimal implementation**

Create `apps/api/app/auth/security.py`:

```python
from datetime import datetime, timedelta, timezone

from jose import JWTError, jwt

from app.core.config import get_settings


class InvalidTokenError(Exception):
    pass


def create_access_token(subject: int) -> str:
    settings = get_settings()
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.access_token_expire_minutes)
    payload = {"sub": str(subject), "exp": expire}
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str) -> int:
    settings = get_settings()
    try:
        payload = jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
    except JWTError as exc:
        raise InvalidTokenError("Could not validate credentials") from exc

    subject = payload.get("sub")
    if subject is None:
        raise InvalidTokenError("Could not validate credentials")

    try:
        return int(subject)
    except ValueError as exc:
        raise InvalidTokenError("Could not validate credentials") from exc
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/api && uv run pytest tests/test_auth_security.py -v`
Expected: 5 passed.

- [ ] **Step 5: Review checkpoint**

Show the user the diff (`apps/api/app/auth/security.py` + `apps/api/tests/test_auth_security.py`) and this explanation:

- **What**: JWT issuance/validation helpers, separate from the existing `app/security.py` (which does Argon2 password hashing) — different job, different file, so a bug in one is never confused with a bug in the other.
- **How**: `create_access_token` signs `{sub: <user id>, exp: <expiry>}` with the app's secret key; `decode_access_token` verifies the signature and expiry, then returns just the user id — or raises one single `InvalidTokenError` that callers can catch without needing to know anything about `python-jose`'s own exception types.
- **Why a custom `InvalidTokenError`**: it decouples every future caller (the `/auth/me` dependency, any future protected endpoint) from the JWT library's internals — if `python-jose` is ever swapped out, only this one file changes.
- **Where this stops**: no endpoints, no database access, no password hashing — purely token math.

Suggested commit message: `feat(auth): add JWT create/decode helpers`

Wait for the user to review and commit before continuing to Task 2.

---

### Task 2: Register/login request and response schemas

**Files:**
- Create: `apps/api/app/auth/schemas.py`
- Test: `apps/api/tests/test_auth_schemas.py`

**Interfaces:**
- Consumes: nothing from earlier tasks (pure Pydantic models).
- Produces: `RegisterRequest(email: str, auth_key: str)`, `LoginRequest(email: str, auth_key: str)`, `TokenResponse(access_token: str, token_type: str = "bearer")`, `UserResponse(id: int, email: str)` (with `model_config = {"from_attributes": True}` so it can be built directly from a `User` ORM instance). Task 4/5/6's router imports all four from `app.auth.schemas`.

- [ ] **Step 1: Write the failing tests**

Create `apps/api/tests/test_auth_schemas.py`:

```python
import base64

import pytest
from pydantic import ValidationError

from app.auth.schemas import LoginRequest, RegisterRequest

VALID_AUTH_KEY = base64.b64encode(b"0" * 32).decode()


def test_register_request_accepts_a_valid_auth_key():
    request = RegisterRequest(email="alice@example.com", auth_key=VALID_AUTH_KEY)

    assert request.auth_key == VALID_AUTH_KEY


def test_register_request_normalizes_email_to_lowercase_and_trimmed():
    request = RegisterRequest(email="  Alice@Example.com  ", auth_key=VALID_AUTH_KEY)

    assert request.email == "alice@example.com"


def test_register_request_rejects_an_auth_key_of_the_wrong_length():
    short_key = base64.b64encode(b"0" * 16).decode()

    with pytest.raises(ValidationError):
        RegisterRequest(email="alice@example.com", auth_key=short_key)


def test_register_request_rejects_an_auth_key_that_is_not_valid_base64():
    with pytest.raises(ValidationError):
        RegisterRequest(email="alice@example.com", auth_key="not-valid-base64!!!")


def test_register_request_rejects_an_email_without_an_at_symbol():
    with pytest.raises(ValidationError):
        RegisterRequest(email="not-an-email", auth_key=VALID_AUTH_KEY)


def test_login_request_applies_the_same_validation_as_register_request():
    with pytest.raises(ValidationError):
        LoginRequest(email="not-an-email", auth_key=VALID_AUTH_KEY)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && uv run pytest tests/test_auth_schemas.py -v`
Expected: FAIL/ERROR — `app.auth.schemas` does not exist yet.

- [ ] **Step 3: Write the minimal implementation**

Create `apps/api/app/auth/schemas.py`:

```python
import base64

from pydantic import BaseModel, field_validator

AUTH_KEY_BYTE_LENGTH = 32


class AuthCredentials(BaseModel):
    email: str
    auth_key: str

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        normalized = value.strip().lower()
        if "@" not in normalized or " " in normalized or not (3 <= len(normalized) <= 255):
            raise ValueError("email must be a valid email address")
        return normalized

    @field_validator("auth_key")
    @classmethod
    def validate_auth_key(cls, value: str) -> str:
        try:
            decoded = base64.b64decode(value, validate=True)
        except ValueError as exc:
            raise ValueError("auth_key must be valid base64") from exc
        if len(decoded) != AUTH_KEY_BYTE_LENGTH:
            raise ValueError(f"auth_key must decode to exactly {AUTH_KEY_BYTE_LENGTH} bytes")
        return value


class RegisterRequest(AuthCredentials):
    pass


class LoginRequest(AuthCredentials):
    pass


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    email: str
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/api && uv run pytest tests/test_auth_schemas.py -v`
Expected: 6 passed.

- [ ] **Step 5: Review checkpoint**

Show the user the diff and this explanation:

- **What**: the four request/response shapes the auth endpoints will use.
- **How**: `AuthCredentials` is a shared base holding the validation both register and login need — normalizing email (lowercase + trim, so `Alice@Example.com` and `alice@example.com` are the same account) and enforcing that `auth_key` decodes to exactly 32 raw bytes. `RegisterRequest`/`LoginRequest` are otherwise identical; keeping them as two distinct classes (rather than one shared type) keeps the door open for them to diverge later without a breaking rename.
- **Why validate `auth_key`'s decoded length**: this is the guard the spec calls for — it's what stops a raw master password (or any other wrong-shaped input) from ever reaching the hashing code by mistake. A real client always sends a 32-byte KDF output; anything else is a bug or an attack.
- **Where this stops**: no database, no HTTP — pure input validation.

Suggested commit message: `feat(auth): add request/response schemas`

Wait for the user to review and commit before continuing to Task 3.

---

### Task 3: DB-backed test fixtures

**Files:**
- Create: `apps/api/tests/conftest.py`
- Test: `apps/api/tests/test_fixtures.py`

**Interfaces:**
- Consumes: `app.db.session.SessionLocal`, `app.db.session.get_db`, `app.main.app`, `app.auth.models.User` (all already implemented).
- Produces: pytest fixtures `db_session` (a live SQLAlchemy `Session` against the real configured Postgres) and `client` (a `TestClient` with `get_db` overridden to use `db_session`, and automatic cleanup of any user rows whose email ends in `@pytest.local`), plus an autouse `reset_rate_limiter` fixture. Every test in Tasks 4–6 depends on `client` (and some on `db_session`) by name — pytest fixtures are injected by parameter name, no import needed in the test files themselves.

This task's fixtures reuse the **real** Postgres database already configured in `.env` — there is no separate test database. Test isolation is achieved by (a) every test-created user having an email ending in the reserved `@pytest.local` domain, and (b) the `client` fixture deleting all such rows after each test runs, whether the test passed or failed. This is a deliberately simpler approach than SQLAlchemy's transaction-rollback-per-test pattern — appropriate for a personal project's scale, at the cost of relying on the cleanup step actually running (which pytest guarantees for fixture teardown code, even on test failure).

- [ ] **Step 1: Write the failing tests**

Create `apps/api/tests/test_fixtures.py`:

```python
from app.auth.models import User


def test_client_fixture_can_reach_the_health_endpoint(client):
    response = client.get("/health")

    assert response.status_code == 200


def test_db_session_fixture_can_query_the_users_table(db_session):
    users = db_session.query(User).filter(User.email == "nobody-should-exist@pytest.local").all()

    assert users == []
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && uv run pytest tests/test_fixtures.py -v`
Expected: ERROR — `fixture 'client' not found` (and `'db_session' not found`).

- [ ] **Step 3: Write the minimal implementation**

Create `apps/api/tests/conftest.py`:

```python
from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.auth.models import User
from app.db.session import SessionLocal, get_db
from app.main import app


@pytest.fixture
def db_session() -> Generator[Session, None, None]:
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def client(db_session: Session) -> Generator[TestClient, None, None]:
    def override_get_db() -> Generator[Session, None, None]:
        yield db_session

    app.dependency_overrides[get_db] = override_get_db

    yield TestClient(app)

    app.dependency_overrides.clear()
    db_session.query(User).filter(User.email.like("%@pytest.local")).delete(synchronize_session=False)
    db_session.commit()


@pytest.fixture(autouse=True)
def reset_rate_limiter() -> None:
    app.state.limiter.reset()
```

Note: `reset_rate_limiter` references `app.state.limiter`, which does not exist until Task 4 sets it up. That's fine — this fixture only executes when a test runs, and no test exists yet that would trigger it in this task. Task 4 must create `app.state.limiter` before any test runs, or this fixture will error for every subsequent test file.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/api && uv run pytest tests/test_fixtures.py -v`
Expected: ERROR still — `app.state.limiter` doesn't exist yet (`AttributeError` inside the autouse `reset_rate_limiter` fixture). This is expected at this point in the plan; Task 4 resolves it. Do not treat this as this task's failure — the two tests' own logic is correct, they're blocked by Task 4's not-yet-done wiring.

Actually — to keep Task 3 genuinely self-contained and independently green (per this plan's own standard), reorder: complete Task 4's `app/core/rate_limit.py` + `app/main.py` changes (just those two files, not the router) as part of *this* task's Step 3 instead, so `app.state.limiter` exists before Task 3's tests run. Concretely, also do this in Step 3:

Create `apps/api/app/core/rate_limit.py`:

```python
from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)
```

Modify `apps/api/app/main.py` (replace the full file):

```python
from fastapi import FastAPI
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from app.core.rate_limit import limiter

app = FastAPI(title="Password Manager API")
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)


@app.get("/health")
def health_check() -> dict[str, str]:
    return {"status": "ok"}
```

Now rerun: `cd apps/api && uv run pytest tests/test_fixtures.py -v`
Expected: 2 passed.

Also rerun the full suite to confirm nothing else broke: `cd apps/api && uv run pytest -v`
Expected: all previously-passing tests (Tasks 1–2, plus `test_main.py`, `test_config.py`, `test_security.py`) still pass.

- [ ] **Step 5: Review checkpoint**

Show the user the diff and this explanation:

- **What**: test infrastructure — a `db_session` fixture (a real database session for tests to use directly) and a `client` fixture (an HTTP test client wired to use that same session instead of opening a new one per request), plus the shared `slowapi` rate limiter now attached to the app.
- **How**: FastAPI's `app.dependency_overrides` lets tests swap out `get_db` for a test-controlled version without touching any endpoint code. Every test-created account uses an email ending in `@pytest.local` — a domain that can never resolve to a real address — so the `client` fixture can safely delete every row matching that pattern after each test, leaving your real dev database clean.
- **Why not use a separate test database or transaction rollback**: SQLAlchemy's standard "wrap each test in a transaction and roll it back" pattern is more robust but requires intricate setup (nested SAVEPOINTs and session event listeners) that's more machinery than this project's scale currently needs. The `@pytest.local` convention is simpler to understand and audit, at the cost of relying on test cleanup code actually running — which pytest guarantees even when a test fails.
- **Where this stops**: no auth endpoints yet — this task only proves the test plumbing itself works, using the existing `/health` route as a smoke test.

Suggested commit message: `test(auth): add DB-backed test fixtures and rate limiter wiring`

Wait for the user to review and commit before continuing to Task 4.

---

### Task 4: Register endpoint

**Files:**
- Create: `apps/api/app/auth/router.py`
- Modify: `apps/api/app/main.py`
- Test: `apps/api/tests/test_auth_router.py`

**Interfaces:**
- Consumes: `app.auth.schemas.RegisterRequest`/`TokenResponse` (Task 2), `app.auth.security.create_access_token` (Task 1), `app.core.rate_limit.limiter` (Task 3), `app.db.session.get_db` (existing), `app.auth.models.User` (existing), `app.security.hash_password` (existing).
- Produces: `router = APIRouter(prefix="/auth", tags=["auth"])` with a `POST /register` route. Task 5 imports this same `router` object and adds routes to it; Task 6 does the same for `/me`.

- [ ] **Step 1: Write the failing tests**

Create `apps/api/tests/test_auth_router.py`:

```python
import base64
import os


def _random_auth_key() -> str:
    return base64.b64encode(os.urandom(32)).decode()


def test_register_creates_a_user_and_returns_a_token(client):
    response = client.post(
        "/auth/register",
        json={"email": "alice@pytest.local", "auth_key": _random_auth_key()},
    )

    assert response.status_code == 201
    body = response.json()
    assert "access_token" in body
    assert body["token_type"] == "bearer"


def test_register_rejects_a_duplicate_email(client):
    auth_key = _random_auth_key()
    client.post("/auth/register", json={"email": "bob@pytest.local", "auth_key": auth_key})

    response = client.post(
        "/auth/register",
        json={"email": "bob@pytest.local", "auth_key": _random_auth_key()},
    )

    assert response.status_code == 409
    assert response.json() == {"detail": "Email already registered"}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && uv run pytest tests/test_auth_router.py -v`
Expected: FAIL — `404 Not Found` for `/auth/register` (route doesn't exist yet), or a collection error if `app.auth.router` doesn't exist.

- [ ] **Step 3: Write the minimal implementation**

Create `apps/api/app/auth/router.py`:

```python
from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.models import User
from app.auth.schemas import RegisterRequest, TokenResponse
from app.auth.security import create_access_token
from app.core.rate_limit import limiter
from app.db.session import get_db
from app.security import hash_password

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
@limiter.limit("5/minute")
def register(request: Request, payload: RegisterRequest, db: Session = Depends(get_db)) -> TokenResponse:
    existing_user = db.scalars(select(User).where(User.email == payload.email)).first()
    if existing_user is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered")

    # The DB's unique index on email (see migration a4c09501d04f) is the real
    # backstop against a race between this check and the insert below; a
    # concurrent duplicate registration would surface as a 500 rather than a
    # clean 409 in that rare case, which is an accepted limitation for now.
    user = User(email=payload.email, hashed_password=hash_password(payload.auth_key))
    db.add(user)
    db.commit()
    db.refresh(user)

    access_token = create_access_token(subject=user.id)
    return TokenResponse(access_token=access_token)
```

Modify `apps/api/app/main.py` (add the router import and `include_router` call):

```python
from fastapi import FastAPI
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from app.auth.router import router as auth_router
from app.core.rate_limit import limiter

app = FastAPI(title="Password Manager API")
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.include_router(auth_router)


@app.get("/health")
def health_check() -> dict[str, str]:
    return {"status": "ok"}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/api && uv run pytest tests/test_auth_router.py -v`
Expected: 2 passed.

Also rerun the full suite: `cd apps/api && uv run pytest -v`
Expected: all tests pass.

- [ ] **Step 5: Review checkpoint**

Show the user the diff and this explanation:

- **What**: the first real HTTP endpoint — `POST /auth/register`. It takes an email and an already-derived `auth_key` (never a plaintext password — see the schema validation from Task 2), stores an Argon2 hash of it, and immediately returns a JWT.
- **How**: FastAPI validates the request body against `RegisterRequest` automatically (a malformed body never reaches this function body at all — it 422s before that). The function checks for an existing user with `select(User).where(...)` (SQLAlchemy 2.0 style), and if none exists, creates one, hashes the `auth_key` with the existing Argon2 helper, and issues a token so the client doesn't need a second round-trip to log in right after registering.
- **Why auto-login on register**: purely a UX choice — the alternative (register, then force a separate login call) adds a step for no security benefit, since the client already has everything needed to log in immediately after a successful register.
- **Why the rate-limit decorator needs a `request: Request` parameter**: `slowapi` inspects the endpoint's own signature to find the caller's IP address — this parameter is required by the library, not something this code chooses to use directly.
- **Where this stops**: no login yet, no `/me`, no vault access — only account creation.

Suggested commit message: `feat(auth): add POST /auth/register endpoint`

Wait for the user to review and commit before continuing to Task 5.

---

### Task 5: Login endpoint

**Files:**
- Modify: `apps/api/app/auth/router.py`
- Modify: `apps/api/tests/test_auth_router.py`

**Interfaces:**
- Consumes: `app.auth.schemas.LoginRequest` (Task 2), `app.security.verify_password` (existing), everything else already imported in `router.py` from Task 4.
- Produces: adds `POST /login` to the existing `router`. Task 6's `/me` doesn't call this directly but relies on tokens this endpoint issues working identically to register's.

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/tests/test_auth_router.py`:

```python
def test_login_succeeds_with_the_correct_auth_key(client):
    auth_key = _random_auth_key()
    client.post("/auth/register", json={"email": "carol@pytest.local", "auth_key": auth_key})

    response = client.post(
        "/auth/login",
        json={"email": "carol@pytest.local", "auth_key": auth_key},
    )

    assert response.status_code == 200
    assert "access_token" in response.json()


def test_login_fails_with_the_wrong_auth_key(client):
    client.post(
        "/auth/register",
        json={"email": "dave@pytest.local", "auth_key": _random_auth_key()},
    )

    response = client.post(
        "/auth/login",
        json={"email": "dave@pytest.local", "auth_key": _random_auth_key()},
    )

    assert response.status_code == 401
    assert response.json() == {"detail": "Invalid email or password"}


def test_login_fails_for_a_nonexistent_email_with_the_same_generic_error(client):
    response = client.post(
        "/auth/login",
        json={"email": "nobody@pytest.local", "auth_key": _random_auth_key()},
    )

    assert response.status_code == 401
    assert response.json() == {"detail": "Invalid email or password"}


def test_login_is_rate_limited_after_five_attempts_per_minute(client):
    for _ in range(5):
        client.post(
            "/auth/login",
            json={"email": "nobody@pytest.local", "auth_key": _random_auth_key()},
        )

    response = client.post(
        "/auth/login",
        json={"email": "nobody@pytest.local", "auth_key": _random_auth_key()},
    )

    assert response.status_code == 429
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && uv run pytest tests/test_auth_router.py -v`
Expected: FAIL — `404 Not Found` for `/auth/login` (route doesn't exist yet).

- [ ] **Step 3: Write the minimal implementation**

Modify `apps/api/app/auth/router.py` — change the schema import line and add the new endpoint at the end of the file:

```python
from app.auth.schemas import LoginRequest, RegisterRequest, TokenResponse
```

```python
from app.security import hash_password, verify_password
```

Then append to the file:

```python
# Argon2 hash of a value nobody could ever supply as auth_key, used only to
# keep response timing constant when the looked-up email doesn't exist —
# see spec "Enumeration protection". Computed once at import time.
_DUMMY_HASH = hash_password("no-such-user-timing-guard")


@router.post("/login", response_model=TokenResponse)
@limiter.limit("5/minute")
def login(request: Request, payload: LoginRequest, db: Session = Depends(get_db)) -> TokenResponse:
    invalid_credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password"
    )

    user = db.scalars(select(User).where(User.email == payload.email)).first()
    stored_hash = user.hashed_password if user is not None else _DUMMY_HASH

    # verify_password always runs, even when user is None, so a nonexistent
    # email takes the same amount of time as a wrong password — this is
    # what closes the timing side-channel described in the spec.
    password_matches = verify_password(payload.auth_key, stored_hash)

    if user is None or not password_matches:
        raise invalid_credentials_exception

    access_token = create_access_token(subject=user.id)
    return TokenResponse(access_token=access_token)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/api && uv run pytest tests/test_auth_router.py -v`
Expected: 6 passed.

Also rerun the full suite: `cd apps/api && uv run pytest -v`
Expected: all tests pass.

- [ ] **Step 5: Review checkpoint**

Show the user the diff and this explanation:

- **What**: `POST /auth/login` — verifies an `auth_key` against the stored Argon2 hash and issues a token on success.
- **How**: looks up the user by normalized email; if found, verifies against their real hash, if not, verifies against a fixed dummy hash instead of skipping verification entirely. Either way, one Argon2 verification always happens, so the response takes roughly the same time whether or not the email exists — this is what prevents an attacker from using response timing to enumerate valid accounts. The actual accept/reject decision (`user is None or not password_matches`) happens only after that verification, so it can't short-circuit the timing protection.
- **Why the error message is identical for both failure cases**: a message that said "no such user" vs "wrong password" would let an attacker enumerate registered emails one guess at a time — this is a well-known auth-endpoint pitfall the spec calls out explicitly.
- **Where this stops**: no session/refresh-token machinery — a successful login just returns a new short-lived JWT, same shape as register's.

Suggested commit message: `feat(auth): add POST /auth/login endpoint with enumeration protection`

Wait for the user to review and commit before continuing to Task 6.

---

### Task 6: `get_current_user` dependency and `GET /auth/me`

**Files:**
- Create: `apps/api/app/auth/dependencies.py`
- Modify: `apps/api/app/auth/router.py`
- Modify: `apps/api/tests/test_auth_router.py`

**Interfaces:**
- Consumes: `app.auth.security.decode_access_token`/`InvalidTokenError` (Task 1), `app.auth.models.User` (existing), `app.db.session.get_db` (existing).
- Produces: `get_current_user(...) -> User`, a FastAPI dependency importable from `app.auth.dependencies` — this is what every future vault-CRUD endpoint will depend on to identify the authenticated caller, not just `/me`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/tests/test_auth_router.py`:

```python
def test_me_returns_the_current_user_for_a_valid_token(client):
    register_response = client.post(
        "/auth/register",
        json={"email": "erin@pytest.local", "auth_key": _random_auth_key()},
    )
    token = register_response.json()["access_token"]

    response = client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})

    assert response.status_code == 200
    assert response.json()["email"] == "erin@pytest.local"


def test_me_rejects_a_request_with_no_token(client):
    response = client.get("/auth/me")

    assert response.status_code == 401


def test_me_rejects_an_invalid_token(client):
    response = client.get("/auth/me", headers={"Authorization": "Bearer not-a-real-token"})

    assert response.status_code == 401
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && uv run pytest tests/test_auth_router.py -v`
Expected: FAIL — `404 Not Found` for `/auth/me` (route doesn't exist yet).

- [ ] **Step 3: Write the minimal implementation**

Create `apps/api/app/auth/dependencies.py`:

```python
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.auth.models import User
from app.auth.security import InvalidTokenError, decode_access_token
from app.db.session import get_db

bearer_scheme = HTTPBearer(auto_error=False)


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )

    if credentials is None:
        raise credentials_exception

    try:
        user_id = decode_access_token(credentials.credentials)
    except InvalidTokenError as exc:
        raise credentials_exception from exc

    user = db.get(User, user_id)
    if user is None:
        raise credentials_exception
    return user
```

Modify `apps/api/app/auth/router.py` — add the import and the new endpoint:

```python
from app.auth.dependencies import get_current_user
from app.auth.schemas import LoginRequest, RegisterRequest, TokenResponse, UserResponse
```

Then append to the file:

```python
@router.get("/me", response_model=UserResponse)
def read_current_user(current_user: User = Depends(get_current_user)) -> User:
    return current_user
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/api && uv run pytest tests/test_auth_router.py -v`
Expected: 9 passed.

Also rerun the full suite: `cd apps/api && uv run pytest -v`
Expected: all tests pass — this is the full auth feature complete.

- [ ] **Step 5: Review checkpoint**

Show the user the diff and this explanation:

- **What**: `GET /auth/me`, plus the `get_current_user` dependency that makes it work — this is the piece every future vault endpoint will reuse to know "who is making this request."
- **How**: `HTTPBearer(auto_error=False)` reads the `Authorization: Bearer <token>` header without FastAPI's default behavior of immediately raising a `403` on a missing header (that default would produce the wrong status code — the spec calls for `401` uniformly). This code checks for a missing header, an invalid/expired token, and a token whose user id no longer exists in the database — all three raise the exact same generic `401`, for the same enumeration-avoidance reason as login.
- **Why this lives in its own `dependencies.py` rather than inside `router.py`**: `router.py` is specifically about auth's own HTTP routes; `get_current_user` is a building block other feature modules (vault CRUD, in a future phase) will import and depend on too. Keeping it separate means those future modules depend on a small, focused file instead of pulling in everything auth's routes need.
- **Where this stops**: this completes the auth feature as scoped in the spec. No vault endpoints, no refresh tokens, no account management (password change, email change) — all explicitly out of scope per the spec.

Suggested commit message: `feat(auth): add GET /auth/me and the get_current_user dependency`

Wait for the user to review and commit. This completes the plan.

---

## Self-Review Notes

- **Spec coverage**: all three endpoints, the email-as-salt design (no salt column/migration), enumeration protection (identical 401 + constant-time dummy-hash verify) on login, the 409 on duplicate register, JWT shape/signing, rate limiting on both register and login, and the full testing plan's scenarios are each covered by a task above. Client-side KDF (PBKDF2/HKDF) is explicitly out of scope for this plan (documented as a contract only, per spec) — no task builds it, correctly matching the spec's stated scope boundary.
- **Placeholder scan**: no TBD/TODO markers; every step has literal, complete code.
- **Type consistency**: `create_access_token(subject: int) -> str` / `decode_access_token(token: str) -> int` (Task 1) are used with those exact signatures in Task 4's register, Task 5's login, and Task 6's dependency. `router` created in Task 4 is the same object extended in Tasks 5 and 6. `RegisterRequest`/`LoginRequest`/`TokenResponse`/`UserResponse` names and fields (Task 2) match every usage in Tasks 4–6 exactly.
