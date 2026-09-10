# Auth Feature — Learning Notes

A running, plain-language log of what was built for the auth feature (register/login/me), why, and how the pieces fit together — written as we go so you have a durable reference beyond chat scrollback. Pairs with the spec (`docs/superpowers/specs/2026-09-04-auth-feature-design.md`) and the plan (`docs/superpowers/plans/2026-09-04-auth-feature.md`).

---

## Task 1: JWT token helpers (`app/auth/security.py`)

**Commit:** `1d38bdf feat(auth): add JWT create/decode helpers`

**What**: two functions — `create_access_token(subject: int) -> str` and `decode_access_token(token: str) -> int` — plus a custom `InvalidTokenError` exception. This is the piece that turns "this is user #42, they just logged in" into a signed token the client can hold onto, and later turns that token back into "this is user #42" on subsequent requests.

**How**: `create_access_token` builds a payload `{"sub": "42", "exp": <expiry time>}` and signs it with the app's secret key (`settings.jwt_secret_key`) using the HS256 algorithm — HS256 means the same secret key both signs and verifies the token (as opposed to public/private key signing). `sub` (short for "subject") is the JWT-standard claim name for "who this token is about" — it's stored as a string because that's the JWT spec's convention, even though we convert it back to an `int` on the way out. `exp` is a standard expiry timestamp; any JWT library automatically rejects a token past this time.

`decode_access_token` does the reverse: verifies the signature (proving the token wasn't tampered with or forged), checks it hasn't expired, and pulls out the user id. If anything about the token is wrong — bad signature, expired, malformed — the underlying `python-jose` library would normally raise its own `JWTError`. We catch that and re-raise as our own `InvalidTokenError` instead.

**Why a custom exception type instead of just letting `JWTError` propagate**: it decouples every future caller from the JWT library specifically. The `/auth/me` endpoint (Task 6) just needs to know "did this token check out or not" — it shouldn't need to import `python-jose` or know its exception hierarchy. If the JWT library were ever swapped out later, only this one file would need to change; nothing downstream would notice.

**Why HS256 and not something fancier**: it's the simplest correct choice for a single backend service that both issues and verifies its own tokens. Public/private key signing (RS256) matters when a *different* service needs to verify tokens without being able to *issue* them — not our situation here.

**Security note**: `jwt.decode(..., algorithms=[settings.jwt_algorithm])` explicitly pins which algorithm is acceptable. This matters because of a real, historical class of JWT attacks ("algorithm confusion") where a token is forged by claiming a different, weaker algorithm than the server expects. Always telling the library exactly which algorithm(s) you accept closes that off.

**Where this stops**: no endpoints, no database, no password hashing — purely token math. It doesn't know what a "user" is beyond an integer id.

**Review notes**: approved clean, no real issues. Two trivial things deferred (not fixed, since they're genuinely minor): the string `"Could not validate credentials"` appears three times rather than as a constant, and there's no test for what happens if a validly-signed token is missing its `exp` claim entirely (edge case, not in the original required test list — worth remembering if this code ever gets extended).

---

## Task 2: Request/response schemas (`app/auth/schemas.py`)

**Commit:** not yet — you'll commit this along with the rest as you review.

**What**: the four data shapes the auth endpoints speak in — `RegisterRequest`, `LoginRequest` (both: `email`, `auth_key`), `TokenResponse` (`access_token`, `token_type`), and `UserResponse` (`id`, `email`). These are Pydantic models — Python classes that validate incoming data automatically. FastAPI uses them to check every request body before your endpoint code ever sees it.

**How**: `RegisterRequest` and `LoginRequest` both inherit from a shared base, `AuthCredentials`, which holds two validators:
- **Email normalization** — lowercases and trims whitespace, so `Alice@Example.com` and `alice@example.com ` both become `alice@example.com`. This matters a lot here specifically, because (per the design) the email *is* the salt used to derive encryption keys client-side — if the server stored two different casings as two different accounts, or matched inconsistently, key derivation would break.
- **`auth_key` shape validation** — decodes the incoming string as base64 and checks it's exactly 32 bytes once decoded. This is the guard that stops a raw password (or garbage) from ever reaching the password-hashing code: a real client always sends a 32-byte key-derivation output, never anything else.

`RegisterRequest` and `LoginRequest` are kept as two separate classes even though they currently have identical fields — a deliberate choice so they can diverge later (e.g. if login ever needs a "remember me" flag) without a breaking rename.

`UserResponse` has `model_config = {"from_attributes": True}` — this tells Pydantic "you're allowed to build this model directly from a Python object's attributes, not just from a dict." That matters because Task 6 will return a `User` database object directly from the `/auth/me` endpoint, and FastAPI uses `UserResponse` to convert it to JSON automatically.

**Why validate `auth_key`'s decoded length specifically (not just "is this a string")**: a raw password typically wouldn't decode to exactly 32 bytes of base64, so this check acts as a structural guard against the most likely mistake (a client accidentally sending a plaintext password) even without knowing anything about passwords specifically.

**Where this stops**: no database, no HTTP handling — pure input validation. It doesn't know how `auth_key` gets hashed or stored; that's Task 4/5's job.

**Review notes**: approved clean. One thing flagged and consciously left as-is: no test directly builds a `UserResponse` from an object (proving `from_attributes` actually works) — the config was verified by reading the code, not by a passing test. Low risk since it's a one-line, well-documented Pydantic setting, but worth knowing this exists as a coverage gap if `UserResponse` ever misbehaves later.

---

## Task 3: Test fixtures + rate limiter setup (`tests/conftest.py`, `app/core/rate_limit.py`, `app/main.py`)

**Commit:** not yet — you'll commit this along with the rest as you review.

**What**: two things bundled together because one needs the other to work — (1) reusable pytest fixtures (`db_session`, `client`) that every future auth test will use, and (2) the app-wide rate limiter, wired into `app/main.py`, so `/auth/register` and `/auth/login` (Tasks 4-5) can be capped at 5 requests/minute per IP.

**How — the fixtures**: `db_session` opens a real database session against your actual Postgres (the same one Docker is running) — there's no separate "test database." `client` wraps that in an HTTP test client and uses FastAPI's `dependency_overrides` mechanism: normally, an endpoint asks for a database session via the `get_db` dependency, and FastAPI creates a fresh one per request; the `client` fixture swaps that out for the test's own `db_session` instead, so a test can inspect or set up data using the exact same session the HTTP request will see.

**Why this doesn't need a separate test database**: every test-created account uses an email ending in `@pytest.local` — a domain that can never be a real address. After each test, the `client` fixture deletes every row matching that pattern. So your real dev database gets used directly, but nothing test-related is left behind. (The more "textbook correct" approach — wrapping each test in a database transaction and rolling it back — was deliberately not used here; it needs fairly advanced SQLAlchemy machinery for comparatively little benefit at this project's current scale. Worth knowing that tradeoff exists if this ever needs to change.)

**How — the rate limiter**: `app/core/rate_limit.py` holds one `Limiter` object (from the `slowapi` library), keyed by request IP. It's a separate one-line module specifically so both `app/main.py` (which needs to register it with the app) and `app/auth/router.py` (which will decorate individual endpoints with it in Tasks 4-5) can import the *same* limiter instance without either file depending on the other.

`app/main.py` now does two new things: `app.state.limiter = limiter` (attaches it to the app so slowapi's internals can find it) and registers a handler that turns a rate-limit violation into a proper `429 Too Many Requests` response instead of a raw exception.

**Why tests need their own rate-limiter reset**: `slowapi`'s rate-limit counters are stored in memory and persist for the lifetime of the running process — including across different tests in the same `pytest` run. Without resetting between tests, an earlier test's login attempts would count toward a *later* test's limit, causing confusing, order-dependent failures. The `reset_rate_limiter` fixture (marked `autouse=True`, meaning it runs automatically for every single test with no test needing to ask for it by name) clears the counter before each test starts.

**Where this stops**: no actual auth endpoints exist yet to rate-limit — this task only builds the plumbing. `/health` (the only real route so far) is untouched by all of this except gaining the rate-limiter machinery sitting alongside it, unused until Task 4.

**Review notes**: approved clean, with a real-environment verification pass (the reviewer actually ran Python against this project's dependencies to confirm `slowapi`'s rate limiter really does default to in-memory storage and that `.reset()` really works — not just reading the code and assuming). A few things noted for awareness rather than fixed: the `@pytest.local` cleanup only happens through the `client` fixture, so a hypothetical future test using `db_session` alone wouldn't get auto-cleaned (Tasks 4-6 all use `client`, so this doesn't bite yet); and the test client doesn't use Python's `with` statement, which would matter if this app ever grows startup/shutdown logic (it has none yet).

---

## Task 4: Register endpoint (`app/auth/router.py`, `app/main.py`)

**Commit:** not yet — you'll commit this along with the rest as you review.

**What**: the first real HTTP endpoint, `POST /auth/register`. A client sends `{email, auth_key}`; the server creates an account and immediately hands back a login token, so there's no separate "now log in" step right after registering.

**How**: the function first checks whether the email is already taken, using `select(User).where(User.email == payload.email)` — this is the modern (SQLAlchemy 2.0) way of writing "find rows matching this condition," as opposed to the older `.query()`-style API. If no existing user is found, it creates one: `hashed_password=hash_password(payload.auth_key)` — note this calls the *original* `app/security.py` (Argon2 hashing, from Phase 1), not Task 1's `app/auth/security.py` (JWT tokens) — two different files named similarly on purpose, doing two different jobs. After saving the new user, it calls `create_access_token(subject=user.id)` (Task 1's function) to issue a token immediately.

**Why check-then-insert instead of just trying to insert and catching a database error**: it's more readable and produces a clean `409` response directly. There's a small theoretical gap here — if two requests for the *same* email arrive at the exact same instant, both could pass the "does this exist" check before either has inserted, and the second insert would then fail at the database level (which enforces uniqueness as a hard constraint, regardless of what the application code does). This is a known, accepted trade-off: astronomically rare for a personal-scale project, and the database's unique constraint is what actually prevents any real data corruption — worst case, a simultaneous duplicate registration gets an ugly error instead of a clean `409`, not a duplicate account.

**Why the endpoint function takes a `request: Request` parameter it never uses directly**: this is required by `slowapi`, the rate-limiting library from Task 3. The `@limiter.limit("5/minute")` decorator inspects the function's own parameters to find the caller's IP address — it's boilerplate the library demands, not a design choice made here.

**Where this stops**: only registration exists so far — no login, no `/me`, no way to prove a token actually works end-to-end yet (that's Tasks 5 and 6).

**Review notes**: approved clean. The reviewer specifically verified that `auth_key` never gets logged, stored raw, or returned anywhere except as the input to the one hashing call — the zero-knowledge boundary holds. Also confirmed (by checking the actual function signatures elsewhere in the codebase, not just trusting the code) that this file correctly calls `hash_password`, `create_access_token`, and `TokenResponse` exactly as those were defined in earlier tasks.

---

## Task 5: Login endpoint (`app/auth/router.py`)

**Commit:** not yet — you'll commit this along with the rest as you review.

**What**: `POST /auth/login` — takes `{email, auth_key}`, checks it against the stored hash, returns a fresh token on success.

**How — this is the most security-sensitive piece of the whole feature, worth understanding in detail**: the code looks up the user by email, then picks which hash to check against:

```python
user = db.scalars(select(User).where(User.email == payload.email)).first()
stored_hash = user.hashed_password if user is not None else _DUMMY_HASH
password_matches = verify_password(payload.auth_key, stored_hash)

if user is None or not password_matches:
    raise invalid_credentials_exception
```

Notice `verify_password(...)` runs on its own line, every single time, before any `if`. This is deliberate and is the entire point of the design. Here's why it matters: Argon2 password verification is *intentionally* slow (that's what makes it resistant to brute-forcing). If the code instead read `if user is None or not verify_password(...)`, Python's `or` would **short-circuit** — the moment `user is None` evaluates `True`, it never bothers calling `verify_password` at all, because the answer is already known to be "reject." That version would *work* (same responses, same status codes) but would run dramatically faster when the email doesn't exist versus when it exists but the password is wrong. An attacker measuring response time — timing dozens of login attempts precisely — could use that speed difference to figure out which email addresses have accounts, one guess at a time, without ever seeing an error message that says so directly.

By always running `verify_password` — against a real hash if the user exists, or a fixed fake one (`_DUMMY_HASH`, defined once when the file loads, not recomputed per request) if they don't — every login attempt takes roughly the same amount of time no matter what. The accept/reject decision happens *after*, once the timing-sensitive work is already done.

**Why the two failure cases (wrong password vs. no such account) return the exact same error**: both raise the identical pre-built `invalid_credentials_exception` object — same status code, same JSON body, word for word. If the messages differed ("no such user" vs. "wrong password"), an attacker could enumerate valid email addresses just by reading the error text, no timing analysis needed at all. This and the timing protection above are two separate defenses against the same underlying problem: never let an attacker learn "does this email have an account" from anything about the response.

**Where this stops**: login now works end-to-end, but there's still no way to *prove* a returned token actually authenticates anything — that's Task 6 (`/auth/me`).

**Review notes**: approved. This task got the most careful review of the six — I specifically asked the reviewer to trace the control flow line-by-line rather than trust that passing tests meant the logic was right, because a buggy short-circuit version would still pass every functional test (same status codes, same error bodies) while silently having zero timing protection. The reviewer confirmed the code is correct. One thing worth knowing: the tests themselves genuinely *can't* catch a future regression back to the buggy short-circuit form — that bug is invisible to status-code assertions. If this function is ever edited again, that control-flow shape (`verify_password` called unconditionally, before any `if`) needs to be preserved by a careful human/reviewer read, not just "the tests still pass."

---

## Task 6: `get_current_user` dependency + `GET /auth/me` (`app/auth/dependencies.py`, `app/auth/router.py`) — final task

**Commit:** not yet — you'll commit this along with the rest as you review.

**What**: the last piece of this feature — `GET /auth/me`, and the `get_current_user` building block behind it. This endpoint takes a token (via the standard `Authorization: Bearer <token>` header) and returns `{id, email}` for whoever that token belongs to. It's a small endpoint, but it's the thing that proves the entire auth chain actually works end-to-end: issue a token at register/login, then use that same token to prove who you are on a later request.

**How**: `get_current_user` reads the `Authorization` header via FastAPI's built-in `HTTPBearer` security scheme, calls Task 1's `decode_access_token` to verify and unwrap it, then loads the matching `User` row from the database. Three things can go wrong — no header at all, a bad/expired/tampered token, or a token that's technically valid but whose user id no longer exists (e.g. account deleted) — and all three raise the *exact same* pre-built exception object, giving an identical `401 {"detail": "Could not validate credentials"}` every time, for the same reason login's errors are identical: never let a response's shape hint at *which* thing was wrong.

**A real FastAPI gotcha this code has to work around**: FastAPI's `HTTPBearer` class, by default, automatically rejects a request with **no** `Authorization` header at all — but it does so with a `403 Forbidden`, not `401`, and it does this *before* any of this file's own code even runs. Left at its default, a header-less request would get a different status code than an invalid-token request, quietly breaking the "identical response for every failure" requirement. The fix is `HTTPBearer(auto_error=False)`, which turns off that automatic behavior and lets this code check for the missing case itself, alongside the other two, so all three genuinely produce the same response.

**Why `get_current_user` lives in its own file instead of inside `router.py`**: this dependency isn't really about auth's own HTTP routes — it's the general-purpose "who is calling this?" check that every future protected endpoint will need (e.g. "list my vault entries" obviously needs to know whose vault). Keeping it separate means a future vault module can import just this one small, focused file instead of pulling in everything `router.py` needs for register/login.

**Where this stops**: this completes the entire auth feature exactly as scoped — no refresh tokens, no vault endpoints, no account management (password change, email change, deletion). Those are all real future features, deliberately left out for now.

**Review notes**: approved. The reviewer specifically checked the `auto_error=False` gotcha by reading the exact line, not by trusting the implementer's summary, and confirmed all three failure paths raise the literal same exception instance (not three separately-written exceptions that could quietly drift apart over time). One thing worth flagging plainly: the implementer's own report claimed test coverage for two edge cases (an expired token, and a token for a since-deleted user) that don't actually exist as tests in this diff — only the three tests the brief actually asked for were written. The underlying *code* for both those cases is correct (the reviewer verified it independently by reading the logic), but it's a good reminder that a subagent's self-report isn't automatically accurate — this is exactly why the review step exists as a separate, skeptical check rather than trusting each implementer's word.

---

## Final whole-branch review + fix wave

**Commit:** not yet — you'll commit this along with the rest as you review.

After all 6 tasks were individually done, a broader review looked at the *whole* feature at once — the kind of thing that only shows up when you can see every file's final state together, not one task's diff at a time. It found no severe (Critical) problems, but four things worth real attention. Three got fixed immediately; one is a note for you.

**Fixed — validation errors were echoing secrets back.** When a request fails Pydantic validation (e.g. a malformed `auth_key`), FastAPI's default behavior includes the *actual rejected value* in the error response, under a field called `"input"`. That's normally harmless — but here, if a client ever had a bug and accidentally sent a real master password instead of a properly-derived key, that password would come straight back in the HTTP response body: visible in browser developer tools, error-reporting tools, or any logging system that captures response bodies. `app/main.py` now has a small handler that intercepts every validation error across the whole app and strips out the value before it's sent back, while keeping the helpful part ("auth_key must be valid base64") intact.

**Fixed — `/auth/me` was one keyword argument away from leaking password hashes.** The endpoint returned a raw database `User` object, and the *only* thing stopping the Argon2 password hash from appearing in the JSON response was a `response_model=UserResponse` setting on the route decorator. If that setting were ever accidentally removed — or a future, similar endpoint simply forgot to add it — the hash would leak. The fix makes the code build the safe response explicitly (`UserResponse.model_validate(current_user)`) instead of relying only on that one setting. This is "defense in depth": two independent things now both have to fail for the leak to happen, not just one.

**Fixed — email lowercasing wasn't precisely defined enough for a multi-language future.** This project's design uses your email address as the "salt" that derives your vault's encryption key (see Task 2's notes above). The plan said to "lowercase" the email, but lowercasing isn't identical in every programming language for non-English characters — Python, JavaScript, Java, and Swift can disagree on certain accented or special characters. If a future client app (the CLI, the browser extension) ever normalized an email slightly differently than the app that created the account, it would derive a *different, wrong* encryption key — and since there's no way to "retry" a wrong key, that would mean permanently losing access to that vault. The fix restricts email addresses to plain ASCII characters for now, which makes "lowercase" unambiguous everywhere. This does mean addresses with accented characters aren't supported yet — a deliberate, currently-accepted limitation, not an oversight.

**Not fixed — a real deployment gotcha for when this goes live on AWS.** The rate limiter (5 login attempts/minute, meant to slow down password-guessing) identifies "who is making this request" by IP address. That works fine running locally, but once this API sits behind AWS's load balancer (which this project's CLAUDE.md says is the plan), every request will *appear* to come from the load balancer's own IP address, not the real visitor's. That would mean the 5-per-minute limit gets shared across every user of the entire app combined, instead of being personal to each attacker — which both breaks the app for real users during busy periods and gives an actual attacker no meaningful rate limit at all. This isn't something to fix in this code — it's a one-line flag (`--proxy-headers --forwarded-allow-ips=...`) you'll need to add when you actually set up how this API runs in production, which is outside what's been built so far.

**Review notes**: the fix wave was verified by a second, independent review pass specifically checking that each fix actually closed the gap (not just "looked like" a fix) and that nothing outside the three intended files was touched. All three confirmed correctly fixed, with tests that would genuinely fail if the fix were ever removed. Final suite: 32/32 tests passing.

---
