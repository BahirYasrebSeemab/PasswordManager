# Mobile Account & Unlock Settings + Import/Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix a real session-persistence bug for devices without biometric enrolled, add a settings screen (biometric toggle, configurable auto-lock timeout), account deletion (backend + mobile), and CSV import/export of vault entries.

**Architecture:** A new `preferences.ts` stores plain (non-sensitive) user prefs in SecureStore without `requireAuthentication`. `session.ts` gains `shouldPersistSession()` gating whether a session is persisted at all, closing the bug where `requireAuthentication: true` silently fails on devices without biometric. A new backend `DELETE /auth/me` endpoint mirrors `/auth/login`'s verification. Import/export is a small CSV module plus two screens, going through the existing `VaultContext.createEntry` for imports so nothing bypasses client-side encryption.

**Tech Stack:** Expo SDK ~57, FastAPI, SQLAlchemy 2.0, pytest, Jest + jest-expo + `@testing-library/react-native@14`.

**Spec:** `docs/superpowers/specs/2026-09-14-mobile-settings-import-export-design.md`

## Global Constraints

- `@testing-library/react-native@14`'s `render()` is async — every call must be `await`ed.
- Package installs are never done by the implementer. New packages needed: `expo-sharing`, `expo-file-system`, `expo-document-picker` (none installed yet — Tasks 7 and 8 note the exact `bun add` commands). `expo-local-authentication` is already installed but this plan does not need it (biometric availability is checked via `SecureStore.canUseBiometricAuthentication()`, a synchronous function returning `boolean`, not a Promise).
- Run mobile tests with `bun x jest`, never bare `bun test`. Run backend tests with `pytest` from `apps/api`.
- Git commits are now allowed (the user has explicitly authorized this). Every task's commit step uses a real `git add` + `git commit`. Commit messages: short, one line, **no** `Co-Authored-By` or any Claude attribution.
- `SecureStore.canUseBiometricAuthentication()` is synchronous (`(): boolean`) — do not `await` it, though doing so is harmless in JS (awaiting a non-Promise resolves immediately). Write it without `await` for clarity everywhere it's used in this plan.
- The backend's `DELETE /auth/me` never receives the plaintext master password — only a freshly re-derived `auth_key`, verified the exact same way `/auth/login` already does (`app.security.verify_password`), preserving the zero-knowledge boundary.

---

### Task 1: Backend `DELETE /auth/me` endpoint

**Files:**
- Modify: `apps/api/app/auth/schemas.py`
- Modify: `apps/api/app/auth/router.py`
- Test: `apps/api/tests/test_auth_router.py`

**Interfaces:**
- Produces: `DELETE /auth/me` (204 on success, 401 on wrong `auth_key` or missing/invalid token) — consumed by Task 5 (`api/auth.ts`'s `deleteAccount`).

- [ ] **Step 1: Write the failing tests — add to `apps/api/tests/test_auth_router.py`**

Add these imports to the top of the file, alongside the existing `import base64` / `import os`:

```python
from sqlalchemy import select

from app.auth.models import User
from app.vault.models import VaultEntry
```

Add these tests at the end of the file:

```python
def test_delete_account_removes_the_user_and_their_vault_entries(client, db_session):
    auth_key = _random_auth_key()
    register_response = client.post("/auth/register", json={"email": "gina@pytest.local", "auth_key": auth_key})
    token = register_response.json()["access_token"]
    client.post("/vault", json={"ciphertext": "irrelevant-ciphertext"}, headers={"Authorization": f"Bearer {token}"})
    user_id = client.get("/auth/me", headers={"Authorization": f"Bearer {token}"}).json()["id"]

    response = client.delete("/auth/me", json={"auth_key": auth_key}, headers={"Authorization": f"Bearer {token}"})

    assert response.status_code == 204
    assert db_session.get(User, user_id) is None
    assert db_session.scalars(select(VaultEntry).where(VaultEntry.user_id == user_id)).first() is None


def test_delete_account_fails_with_the_wrong_auth_key(client, db_session):
    auth_key = _random_auth_key()
    register_response = client.post("/auth/register", json={"email": "henry@pytest.local", "auth_key": auth_key})
    token = register_response.json()["access_token"]
    user_id = client.get("/auth/me", headers={"Authorization": f"Bearer {token}"}).json()["id"]

    response = client.delete(
        "/auth/me", json={"auth_key": _random_auth_key()}, headers={"Authorization": f"Bearer {token}"}
    )

    assert response.status_code == 401
    assert db_session.get(User, user_id) is not None


def test_delete_account_requires_a_valid_token(client):
    response = client.delete("/auth/me", json={"auth_key": _random_auth_key()})

    assert response.status_code == 401


def test_delete_account_is_rate_limited_after_five_attempts_per_minute(client):
    auth_key = _random_auth_key()
    register_response = client.post("/auth/register", json={"email": "ivan@pytest.local", "auth_key": auth_key})
    token = register_response.json()["access_token"]

    for _ in range(5):
        client.delete(
            "/auth/me", json={"auth_key": _random_auth_key()}, headers={"Authorization": f"Bearer {token}"}
        )

    response = client.delete(
        "/auth/me", json={"auth_key": _random_auth_key()}, headers={"Authorization": f"Bearer {token}"}
    )

    assert response.status_code == 429
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/api && pytest tests/test_auth_router.py -v -k delete_account`
Expected: FAIL — `404 Not Found` (no `DELETE /auth/me` route exists yet)

- [ ] **Step 3: Add `AccountDeleteRequest` to `apps/api/app/auth/schemas.py`**

Replace the `auth_key` validator logic with a shared function so it isn't duplicated, then add the new schema. The file becomes:

```python
import base64

from pydantic import BaseModel, field_validator

AUTH_KEY_BYTE_LENGTH = 32


def _decode_auth_key(value: str) -> str:
    try:
        decoded = base64.b64decode(value, validate=True)
    except ValueError as exc:
        raise ValueError("auth_key must be valid base64") from exc
    if len(decoded) != AUTH_KEY_BYTE_LENGTH:
        raise ValueError(f"auth_key must decode to exactly {AUTH_KEY_BYTE_LENGTH} bytes")
    return value


class AuthCredentials(BaseModel):
    email: str
    auth_key: str

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        normalized = value.strip().lower()
        if "@" not in normalized or " " in normalized or not (3 <= len(normalized) <= 255):
            raise ValueError("email must be a valid email address")
        # The email is used as the salt for deriving both the login credential
        # and the vault-encryption key (see project spec). "Lowercase" is not
        # identical across client languages for non-ASCII characters (e.g.
        # Turkish dotted/dotless I, German ß, combining characters) — if a
        # future client normalized the same non-ASCII email differently than
        # it was normalized at account-creation time, it would derive a
        # different, unrecoverable vault-encryption key. Restricting emails to
        # ASCII makes "lowercase" unambiguous across every client language.
        # Non-ASCII email support is a deliberate, accepted out-of-scope
        # trade-off for now (see project SDD ledger), not a bug to design around.
        if not normalized.isascii():
            raise ValueError("email must contain only ASCII characters")
        return normalized

    @field_validator("auth_key")
    @classmethod
    def validate_auth_key(cls, value: str) -> str:
        return _decode_auth_key(value)


class RegisterRequest(AuthCredentials):
    pass


class LoginRequest(AuthCredentials):
    pass


class AccountDeleteRequest(BaseModel):
    auth_key: str

    @field_validator("auth_key")
    @classmethod
    def validate_auth_key(cls, value: str) -> str:
        return _decode_auth_key(value)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    email: str
```

- [ ] **Step 4: Add the endpoint to `apps/api/app/auth/router.py`**

Add `AccountDeleteRequest` to the existing schemas import (it currently reads `from app.auth.schemas import LoginRequest, RegisterRequest, TokenResponse, UserResponse` — add `AccountDeleteRequest` to that list, alphabetically first), and add `from app.vault.models import VaultEntry` to the imports. Then add this endpoint after `read_current_user`:

```python
@router.delete("/me", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("5/minute")
def delete_account(
    request: Request,
    payload: AccountDeleteRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    if not verify_password(payload.auth_key, current_user.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Incorrect password")
    db.query(VaultEntry).filter(VaultEntry.user_id == current_user.id).delete()
    db.delete(current_user)
    db.commit()
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd apps/api && pytest tests/test_auth_router.py -v -k delete_account`
Expected: PASS (4 passed)

- [ ] **Step 6: Run the full backend suite to confirm nothing else broke**

Run: `cd apps/api && pytest`
Expected: all tests pass

- [ ] **Step 7: Commit**

```bash
git add apps/api/app/auth/schemas.py apps/api/app/auth/router.py apps/api/tests/test_auth_router.py
git commit -m "add DELETE /auth/me for account deletion"
```

---

### Task 2: `preferences.ts`

**Files:**
- Create: `apps/mobile/src/settings/preferences.ts`
- Test: `apps/mobile/src/settings/preferences.test.ts`

**Interfaces:**
- Produces: `getBiometricEnabled(): Promise<boolean>` (default `true`), `setBiometricEnabled(enabled: boolean): Promise<void>`, `getAutoLockSeconds(): Promise<number>` (default `30`), `setAutoLockSeconds(seconds: number): Promise<void>` — consumed by Task 3 (`session.ts`, `AuthContext.tsx`) and Task 4 (settings screen).

- [ ] **Step 1: Write `src/settings/preferences.ts`**

```ts
import * as SecureStore from "expo-secure-store";

const KEYS = {
  biometricEnabled: "pref_biometric_enabled",
  autoLockSeconds: "pref_auto_lock_seconds",
} as const;

const DEFAULT_AUTO_LOCK_SECONDS = 30;

// Plain preferences — deliberately NOT using requireAuthentication. These
// aren't secrets (a biometric on/off flag and a lock timeout), and gating
// them behind biometric auth would be circular on a device where biometric
// is unavailable or has just been turned off.
export async function getBiometricEnabled(): Promise<boolean> {
  const value = await SecureStore.getItemAsync(KEYS.biometricEnabled);
  return value === null ? true : value === "true";
}

export async function setBiometricEnabled(enabled: boolean): Promise<void> {
  await SecureStore.setItemAsync(KEYS.biometricEnabled, enabled ? "true" : "false");
}

export async function getAutoLockSeconds(): Promise<number> {
  const value = await SecureStore.getItemAsync(KEYS.autoLockSeconds);
  return value === null ? DEFAULT_AUTO_LOCK_SECONDS : Number(value);
}

export async function setAutoLockSeconds(seconds: number): Promise<void> {
  await SecureStore.setItemAsync(KEYS.autoLockSeconds, String(seconds));
}
```

- [ ] **Step 2: Write the failing test `src/settings/preferences.test.ts`**

```ts
import * as SecureStore from "expo-secure-store";
import { getBiometricEnabled, setBiometricEnabled, getAutoLockSeconds, setAutoLockSeconds } from "./preferences";

jest.mock("expo-secure-store");

const mockedStore = new Map<string, string>();

beforeEach(() => {
  jest.clearAllMocks();
  mockedStore.clear();
  (SecureStore.setItemAsync as jest.Mock).mockImplementation(async (key: string, value: string) => {
    mockedStore.set(key, value);
  });
  (SecureStore.getItemAsync as jest.Mock).mockImplementation(async (key: string) => {
    return mockedStore.get(key) ?? null;
  });
});

test("getBiometricEnabled defaults to true when nothing has been set", async () => {
  expect(await getBiometricEnabled()).toBe(true);
});

test("setBiometricEnabled then getBiometricEnabled round-trips false", async () => {
  await setBiometricEnabled(false);
  expect(await getBiometricEnabled()).toBe(false);
});

test("setBiometricEnabled then getBiometricEnabled round-trips true after being set false", async () => {
  await setBiometricEnabled(false);
  await setBiometricEnabled(true);
  expect(await getBiometricEnabled()).toBe(true);
});

test("getAutoLockSeconds defaults to 30 when nothing has been set", async () => {
  expect(await getAutoLockSeconds()).toBe(30);
});

test("setAutoLockSeconds then getAutoLockSeconds round-trips the value", async () => {
  await setAutoLockSeconds(300);
  expect(await getAutoLockSeconds()).toBe(300);
});

test("preferences are stored WITHOUT requireAuthentication", async () => {
  await setBiometricEnabled(false);
  await setAutoLockSeconds(60);

  const calls = (SecureStore.setItemAsync as jest.Mock).mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  for (const call of calls) {
    const options = call[2];
    expect(options?.requireAuthentication).toBeUndefined();
  }
});
```

- [ ] **Step 3: Run the tests**

Run: `bun x jest src/settings/preferences.test.ts`
Expected: PASS (6 passed)

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/settings/preferences.ts apps/mobile/src/settings/preferences.test.ts
git commit -m "add biometric/auto-lock preference storage"
```

---

### Task 3: Fix session persistence + `AuthContext` gating

**Files:**
- Modify: `apps/mobile/src/context/session.ts`
- Modify: `apps/mobile/src/context/session.test.ts`
- Modify: `apps/mobile/src/context/AuthContext.tsx`
- Modify: `apps/mobile/src/context/AuthContext.test.tsx`

**Interfaces:**
- Consumes: `getBiometricEnabled` (Task 2).
- Produces: `session.ts`'s `shouldPersistSession(): Promise<boolean>`; `AuthContext`'s `setBiometricPreference(enabled: boolean): Promise<void>` (added to `AuthContextValue`) — consumed by Task 4 (settings screen). `authKey` is tracked as new internal state in `AuthProvider` but is **not** added to the exposed `AuthContextValue` interface — nothing outside `AuthProvider` needs it (the delete-account screen in Task 5 re-derives its own `authKey` from a freshly-entered password).

- [ ] **Step 1: Write the failing test — add to `src/context/session.test.ts`**

Add this test at the end of the file:

```ts
test("shouldPersistSession is exported and callable", async () => {
  const { shouldPersistSession } = await import("./session");
  expect(typeof shouldPersistSession).toBe("function");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun x jest src/context/session.test.ts`
Expected: FAIL — `shouldPersistSession` is not exported yet

- [ ] **Step 3: Add `shouldPersistSession` to `src/context/session.ts`**

Add this import at the top:

```ts
import { getBiometricEnabled } from "@/settings/preferences";
```

Add this function (anywhere after the imports, before `saveSession`):

```ts
// requireAuthentication: true (used below) specifically requires biometric
// enrollment — SecureStore.canUseBiometricAuthentication() returns false
// whenever it isn't set up, and saveSession/loadSession would otherwise
// fail outright on such a device. Callers must check this first and skip
// persisting entirely when it's false, rather than calling saveSession with
// requireAuthentication on a device that can't satisfy it.
export async function shouldPersistSession(): Promise<boolean> {
  const hasBiometric = SecureStore.canUseBiometricAuthentication();
  const userWantsIt = await getBiometricEnabled();
  return hasBiometric && userWantsIt;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun x jest src/context/session.test.ts`
Expected: PASS (6 passed)

- [ ] **Step 5: Replace `src/context/AuthContext.tsx` in full**

```tsx
import { createContext, useContext, useEffect, useState, useCallback, useRef, ReactNode } from "react";
import { AppState, AppStateStatus } from "react-native";
import { deriveKeys } from "@/crypto/deriveKeys";
import { register as apiRegister, login as apiLogin, getMe, ApiError } from "@/api/auth";
import { saveSession, loadSession, updateAccessToken, clearSession, shouldPersistSession } from "./session";
import { getAutoLockSeconds, setBiometricEnabled as setBiometricEnabledPref } from "@/settings/preferences";

type Status = "loading" | "locked" | "unlocked";

interface User {
  id: number;
  email: string;
}

interface AuthContextValue {
  status: Status;
  user: User | null;
  vaultKey: Uint8Array | null;
  accessToken: string | null;
  register: (email: string, masterPassword: string) => Promise<void>;
  login: (email: string, masterPassword: string) => Promise<void>;
  unlockWithStoredSession: () => Promise<void>;
  logout: () => Promise<void>;
  setBiometricPreference: (enabled: boolean) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [user, setUser] = useState<User | null>(null);
  const [vaultKey, setVaultKey] = useState<Uint8Array | null>(null);
  const [authKey, setAuthKey] = useState<Uint8Array | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const backgroundedAtRef = useRef<number | null>(null);

  const unlockWithStoredSession = useCallback(async () => {
    // The ENTIRE body — including loadSession() itself — is covered by this
    // outer try/catch. loadSession() reads from SecureStore with
    // requireAuthentication: true, which is what actually triggers the OS
    // biometric prompt (Face ID / fingerprint); a cancelled or failed prompt
    // rejects the promise, and without this outer catch that rejection would
    // leave `status` stuck at "loading" forever instead of routing to
    // "locked".
    try {
      const stored = await loadSession();
      if (!stored) {
        setStatus("locked");
        return;
      }

      setVaultKey(stored.vaultKey);
      setAuthKey(stored.authKey);

      try {
        // Optimistic path: try the cached access_token first. /auth/me has
        // no rate limit, while /auth/login is limited to 5/minute on the
        // backend, so refreshing unconditionally on every app open would
        // burn through that budget. Only fall back to a full login (which
        // mints a fresh access_token from the stored auth_key) when the
        // cached token is actually rejected with 401.
        const me = await getMe(stored.accessToken);
        setUser(me);
        setAccessToken(stored.accessToken);
        setStatus("unlocked");
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          const { access_token } = await apiLogin(stored.email, stored.authKey);
          await updateAccessToken(access_token);
          const me = await getMe(access_token);
          setUser(me);
          setAccessToken(access_token);
          setStatus("unlocked");
        } else {
          // Any other failure (non-401 ApiError, network error, or the
          // fallback login/getMe itself failing) is not retried further —
          // fall through to the outer catch, which routes to "locked".
          throw err;
        }
      }
    } catch {
      setVaultKey(null);
      setAuthKey(null);
      setUser(null);
      setAccessToken(null);
      setStatus("locked");
    }
  }, []);

  useEffect(() => {
    unlockWithStoredSession();
  }, [unlockWithStoredSession]);

  useEffect(() => {
    async function handleAppStateChange(nextState: AppStateStatus) {
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
        // reliable regardless of how long the OS suspended the app. The
        // threshold is now a stored preference rather than a constant, read
        // fresh on every check so a settings change takes effect immediately.
        const autoLockSeconds = await getAutoLockSeconds();
        if (elapsed >= autoLockSeconds * 1000) {
          setVaultKey(null);
          setAuthKey(null);
          setUser(null);
          setAccessToken(null);
          setStatus("locked");
        }
      }
    }

    const subscription = AppState.addEventListener("change", handleAppStateChange);
    return () => subscription.remove();
  }, []);

  const register = useCallback(async (email: string, masterPassword: string) => {
    // Yield to the JS event loop before the synchronous, multi-second
    // 600k-iteration PBKDF2 derivation below so React gets a chance to paint
    // the loading spinner (set via setLoading(true) in the calling screen)
    // before the thread blocks.
    await new Promise(requestAnimationFrame);
    const { vaultKey: newVaultKey, authKey: newAuthKey } = deriveKeys(email, masterPassword);
    const { access_token } = await apiRegister(email, newAuthKey);
    if (await shouldPersistSession()) {
      await saveSession({ vaultKey: newVaultKey, authKey: newAuthKey, accessToken: access_token, email });
    }
    const me = await getMe(access_token);
    setVaultKey(newVaultKey);
    setAuthKey(newAuthKey);
    setUser(me);
    setAccessToken(access_token);
    setStatus("unlocked");
  }, []);

  const login = useCallback(async (email: string, masterPassword: string) => {
    // See register() above — same reasoning for yielding before deriveKeys().
    await new Promise(requestAnimationFrame);
    const { vaultKey: newVaultKey, authKey: newAuthKey } = deriveKeys(email, masterPassword);
    const { access_token } = await apiLogin(email, newAuthKey);
    if (await shouldPersistSession()) {
      await saveSession({ vaultKey: newVaultKey, authKey: newAuthKey, accessToken: access_token, email });
    }
    const me = await getMe(access_token);
    setVaultKey(newVaultKey);
    setAuthKey(newAuthKey);
    setUser(me);
    setAccessToken(access_token);
    setStatus("unlocked");
  }, []);

  const logout = useCallback(async () => {
    await clearSession();
    setVaultKey(null);
    setAuthKey(null);
    setUser(null);
    setAccessToken(null);
    setStatus("locked");
  }, []);

  // Lets the settings screen flip the biometric preference without asking
  // for the master password again: reuses whatever keys are already in
  // memory from the current unlocked session. Turning it off wipes anything
  // already persisted so there's nothing orphaned in SecureStore.
  const setBiometricPreference = useCallback(
    async (enabled: boolean) => {
      await setBiometricEnabledPref(enabled);
      if (enabled && vaultKey && authKey && accessToken && user) {
        await saveSession({ vaultKey, authKey, accessToken, email: user.email });
      } else if (!enabled) {
        await clearSession();
      }
    },
    [vaultKey, authKey, accessToken, user]
  );

  return (
    <AuthContext.Provider
      value={{
        status,
        user,
        vaultKey,
        accessToken,
        register,
        login,
        unlockWithStoredSession,
        logout,
        setBiometricPreference,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
```

- [ ] **Step 6: Update `src/context/AuthContext.test.tsx`**

Add this mock near the top, alongside the existing `jest.mock` calls (before any import that transitively uses it):

```ts
jest.mock("@/settings/preferences", () => ({
  getBiometricEnabled: jest.fn(),
  setBiometricEnabled: jest.fn().mockResolvedValue(undefined),
  getAutoLockSeconds: jest.fn().mockResolvedValue(30),
  setAutoLockSeconds: jest.fn().mockResolvedValue(undefined),
}));
```

Find the existing `beforeEach(() => { jest.clearAllMocks(); });` and change it to also arm `shouldPersistSession`'s default (so every existing test — which expects `saveSession` to be called — keeps passing unchanged):

```ts
beforeEach(() => {
  jest.clearAllMocks();
  (session.shouldPersistSession as jest.Mock).mockResolvedValue(true);
});
```

Add these three tests at the end of the file:

```ts
test("register() does not persist a session when shouldPersistSession() resolves false", async () => {
  (session.loadSession as jest.Mock).mockResolvedValue(null);
  (session.shouldPersistSession as jest.Mock).mockResolvedValue(false);
  (authApi.register as jest.Mock).mockResolvedValue({ access_token: "tok", token_type: "bearer" });
  (authApi.getMe as jest.Mock).mockResolvedValue({ id: 1, email: "test@example.com" });

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

  expect(session.saveSession).not.toHaveBeenCalled();
  expect(screen.getByTestId("status").props.children).toBe("unlocked");
});

test("setBiometricPreference(true) persists a session using the in-memory keys", async () => {
  (session.loadSession as jest.Mock).mockResolvedValue(null);
  (session.shouldPersistSession as jest.Mock).mockResolvedValue(false);
  (authApi.register as jest.Mock).mockResolvedValue({ access_token: "tok", token_type: "bearer" });
  (authApi.getMe as jest.Mock).mockResolvedValue({ id: 1, email: "test@example.com" });

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
  expect(session.saveSession).not.toHaveBeenCalled();

  await act(async () => {
    await auth!.setBiometricPreference(true);
  });

  expect(session.saveSession).toHaveBeenCalledWith(
    expect.objectContaining({ accessToken: "tok", email: "test@example.com" })
  );
});

test("setBiometricPreference(false) clears any persisted session", async () => {
  (session.loadSession as jest.Mock).mockResolvedValue(null);
  (authApi.register as jest.Mock).mockResolvedValue({ access_token: "tok", token_type: "bearer" });
  (authApi.getMe as jest.Mock).mockResolvedValue({ id: 1, email: "test@example.com" });

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

  await act(async () => {
    await auth!.setBiometricPreference(false);
  });

  expect(session.clearSession).toHaveBeenCalled();
});
```

- [ ] **Step 7: Run the tests**

Run: `bun x jest src/context/AuthContext.test.tsx`
Expected: PASS (all tests, including the 3 new ones — 14 total)

- [ ] **Step 8: Run the full suite to confirm nothing else broke**

Run: `bun x jest`
Expected: all suites pass

- [ ] **Step 9: Commit**

```bash
git add apps/mobile/src/context/session.ts apps/mobile/src/context/session.test.ts apps/mobile/src/context/AuthContext.tsx apps/mobile/src/context/AuthContext.test.tsx
git commit -m "fix session persistence on devices without biometric, add auto-lock preference"
```

---

### Task 4: Settings screen + vault-list entry point

**Files:**
- Create: `apps/mobile/app/(app)/settings/index.tsx`
- Test: `apps/mobile/src/routing/__tests__/settings.test.tsx`
- Modify: `apps/mobile/app/(app)/index.tsx`

**Interfaces:**
- Consumes: `useAuth().setBiometricPreference` (Task 3), `getBiometricEnabled`/`getAutoLockSeconds`/`setAutoLockSeconds` (Task 2), `SecureStore.canUseBiometricAuthentication()`.
- Produces: links to `/settings/export`, `/settings/import`, `/settings/delete-account` (built in Tasks 5/7/8 — these routes don't exist yet at the end of this task, which is expected; `Link` doesn't validate target existence).

- [ ] **Step 1: Write `app/(app)/settings/index.tsx`**

```tsx
import { useEffect, useState } from "react";
import { View } from "react-native";
import { Link } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { useAuth } from "@/context/AuthContext";
import { getBiometricEnabled, getAutoLockSeconds, setAutoLockSeconds } from "@/settings/preferences";
import { Button } from "@/components/button";
import { ThemedText } from "@/components/themed-text";
import { colors, spacing } from "@/theme";

const AUTO_LOCK_PRESETS = [
  { label: "Immediately", seconds: 0 },
  { label: "30 seconds", seconds: 30 },
  { label: "1 minute", seconds: 60 },
  { label: "5 minutes", seconds: 300 },
];

export default function SettingsScreen() {
  const { setBiometricPreference } = useAuth();
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometricEnabled, setBiometricEnabledState] = useState(true);
  const [autoLockSeconds, setAutoLockSecondsState] = useState(30);

  useEffect(() => {
    setBiometricAvailable(SecureStore.canUseBiometricAuthentication());
    (async () => {
      setBiometricEnabledState(await getBiometricEnabled());
      setAutoLockSecondsState(await getAutoLockSeconds());
    })();
  }, []);

  async function handleBiometricToggle() {
    const next = !biometricEnabled;
    setBiometricEnabledState(next);
    await setBiometricPreference(next);
  }

  async function handleAutoLockChange(seconds: number) {
    setAutoLockSecondsState(seconds);
    await setAutoLockSeconds(seconds);
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.systemBackground, padding: spacing.lg, gap: spacing.lg }}>
      <ThemedText variant="largeTitle">Settings</ThemedText>

      <View style={{ gap: spacing.sm }}>
        <ThemedText variant="headline">Unlock with biometrics</ThemedText>
        {biometricAvailable ? (
          <Button
            title={biometricEnabled ? "Enabled — tap to disable" : "Disabled — tap to enable"}
            variant="secondary"
            onPress={handleBiometricToggle}
          />
        ) : (
          <ThemedText variant="subhead">Not available on this device.</ThemedText>
        )}
      </View>

      <View style={{ gap: spacing.sm }}>
        <ThemedText variant="headline">Auto-lock after</ThemedText>
        {AUTO_LOCK_PRESETS.map((preset) => (
          <Button
            key={preset.seconds}
            title={autoLockSeconds === preset.seconds ? `${preset.label} ✓` : preset.label}
            variant="secondary"
            onPress={() => handleAutoLockChange(preset.seconds)}
          />
        ))}
      </View>

      <View style={{ gap: spacing.sm }}>
        <ThemedText variant="headline">Vault data</ThemedText>
        <Link href="/settings/export" asChild>
          <Button title="Export vault" variant="secondary" />
        </Link>
        <Link href="/settings/import" asChild>
          <Button title="Import vault" variant="secondary" />
        </Link>
      </View>

      <Link href="/settings/delete-account" asChild>
        <Button title="Delete account" variant="secondary" />
      </Link>
    </View>
  );
}
```

- [ ] **Step 2: Write the failing test `src/routing/__tests__/settings.test.tsx`**

```tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react-native";
import { useAuth } from "@/context/AuthContext";
import * as SecureStore from "expo-secure-store";
import { getBiometricEnabled, getAutoLockSeconds, setAutoLockSeconds } from "@/settings/preferences";

jest.mock("@/context/AuthContext");
jest.mock("expo-secure-store");
jest.mock("@/settings/preferences");
jest.mock("expo-router", () => ({
  Link: ({ children }: { children: React.ReactNode }) => children,
}));

function getSettingsScreen() {
  return require("../../../app/(app)/settings/index").default;
}

beforeEach(() => {
  jest.clearAllMocks();
  (useAuth as jest.Mock).mockReturnValue({ setBiometricPreference: jest.fn() });
  (SecureStore.canUseBiometricAuthentication as jest.Mock).mockReturnValue(true);
  (getBiometricEnabled as jest.Mock).mockResolvedValue(true);
  (getAutoLockSeconds as jest.Mock).mockResolvedValue(30);
});

test("shows the biometric toggle as enabled when available and on", async () => {
  const SettingsScreen = getSettingsScreen();

  await render(<SettingsScreen />);

  await waitFor(() => expect(screen.getByText("Enabled — tap to disable")).toBeTruthy());
});

test("shows 'Not available on this device.' when biometric hardware is unavailable", async () => {
  (SecureStore.canUseBiometricAuthentication as jest.Mock).mockReturnValue(false);
  const SettingsScreen = getSettingsScreen();

  await render(<SettingsScreen />);

  await waitFor(() => expect(screen.getByText("Not available on this device.")).toBeTruthy());
});

test("tapping a different auto-lock preset persists it", async () => {
  const SettingsScreen = getSettingsScreen();

  await render(<SettingsScreen />);
  await waitFor(() => expect(screen.getByText("1 minute")).toBeTruthy());
  fireEvent.press(screen.getByText("1 minute"));

  await waitFor(() => expect(setAutoLockSeconds).toHaveBeenCalledWith(60));
});

test("tapping the biometric toggle calls setBiometricPreference with the flipped value", async () => {
  const setBiometricPreference = jest.fn();
  (useAuth as jest.Mock).mockReturnValue({ setBiometricPreference });
  const SettingsScreen = getSettingsScreen();

  await render(<SettingsScreen />);
  await waitFor(() => expect(screen.getByText("Enabled — tap to disable")).toBeTruthy());
  fireEvent.press(screen.getByText("Enabled — tap to disable"));

  await waitFor(() => expect(setBiometricPreference).toHaveBeenCalledWith(false));
});
```

- [ ] **Step 3: Run the tests**

Run: `bun x jest src/routing/__tests__/settings.test.tsx`
Expected: PASS (4 passed)

- [ ] **Step 4: Add the entry point — modify `app/(app)/index.tsx`**

Replace the header `View` block with one that includes a Settings link:

```tsx
<View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
  <ThemedText variant="largeTitle">Vault</ThemedText>
  <View style={{ flexDirection: "row", gap: spacing.sm }}>
    <Link href="/settings" asChild>
      <Button title="Settings" variant="secondary" size="sm" />
    </Link>
    <Button title="Log out" variant="secondary" size="sm" onPress={logout} />
  </View>
</View>
```

`Link` is already imported in this file (used below for "Add entry").

- [ ] **Step 5: Run the full suite**

Run: `bun x jest`
Expected: all suites pass

- [ ] **Step 6: Commit**

```bash
git add "apps/mobile/app/(app)/settings/index.tsx" apps/mobile/src/routing/__tests__/settings.test.tsx "apps/mobile/app/(app)/index.tsx"
git commit -m "add settings screen: biometric toggle, auto-lock timeout"
```

---

### Task 5: Account deletion (mobile)

**Files:**
- Modify: `apps/mobile/src/api/auth.ts`
- Create: `apps/mobile/src/api/auth.test.ts` additions (existing file — add tests, don't replace)
- Create: `apps/mobile/app/(app)/settings/delete-account.tsx`
- Test: `apps/mobile/src/routing/__tests__/delete-account.test.tsx`

**Interfaces:**
- Consumes: `DELETE /auth/me` (Task 1), `useAuth()`'s `user`/`accessToken`/`logout` (existing + Task 3), `deriveKeys` (Plan 1, unchanged).
- Produces: `deleteAccount(accessToken: string, authKey: Uint8Array): Promise<void>` in `api/auth.ts`.

- [ ] **Step 1: Write the failing test — add to `src/api/auth.test.ts`**

Add this test at the end of the existing file (it already has the `mockFetchOnce` helper and `AUTH_KEY` constant from the existing `register`/`login`/`getMe` tests):

```ts
test("deleteAccount DELETEs /auth/me with the bearer token and base64 auth_key, resolving to undefined on 204", async () => {
  mockFetchOnce(204, undefined);

  await expect(deleteAccount("some-token", AUTH_KEY)).resolves.toBeUndefined();
  const [url, options] = (global.fetch as jest.Mock).mock.calls[0];
  expect(url).toContain("/auth/me");
  expect(options.method).toBe("DELETE");
  expect(options.headers.Authorization).toBe("Bearer some-token");
  const body = JSON.parse(options.body as string);
  expect(typeof body.auth_key).toBe("string");
  expect(body.auth_key.length).toBe(44); // 32 bytes base64-encoded
});

test("deleteAccount throws ApiError with status 401 on the wrong password", async () => {
  mockFetchOnce(401, { detail: "Incorrect password" });

  await expect(deleteAccount("some-token", AUTH_KEY)).rejects.toMatchObject({ status: 401 });
});
```

Update the import line at the top of the file to include `deleteAccount`:

```ts
import { register, login, getMe, deleteAccount, ApiError } from "./auth";
```

(`mockFetchOnce`'s existing signature accepts `(status: number, body: unknown)`, matching how `client.test.ts` mocks 204 — `body === undefined` makes `json()` throw, and `apiRequest`'s 204 handling never calls `.json()`, so this works exactly like the existing 204 tests for `deleteVaultEntry`.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun x jest src/api/auth.test.ts`
Expected: FAIL — `deleteAccount` is not exported yet

- [ ] **Step 3: Add `deleteAccount` to `src/api/auth.ts`**

```ts
export function deleteAccount(accessToken: string, authKey: Uint8Array): Promise<void> {
  return apiRequest<void>("/auth/me", {
    method: "DELETE",
    accessToken,
    body: { auth_key: bytesToBase64(authKey) },
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun x jest src/api/auth.test.ts`
Expected: PASS (all tests, including the 2 new ones)

- [ ] **Step 5: Write `app/(app)/settings/delete-account.tsx`**

```tsx
import { useState } from "react";
import { Alert, TextInput, View } from "react-native";
import * as SQLite from "expo-sqlite";
import { useAuth } from "@/context/AuthContext";
import { deriveKeys } from "@/crypto/deriveKeys";
import { deleteAccount, ApiError } from "@/api/auth";
import { Button } from "@/components/button";
import { ThemedText } from "@/components/themed-text";
import { colors, spacing } from "@/theme";

export default function DeleteAccountScreen() {
  const { user, accessToken, logout } = useAuth();
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function confirmDelete() {
    Alert.alert(
      "Delete your account?",
      "This permanently deletes your account and every entry in your vault. This can't be undone.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: handleDelete },
      ]
    );
  }

  async function handleDelete() {
    if (!user || !accessToken) return;
    setError(null);
    setLoading(true);
    try {
      const { authKey } = deriveKeys(user.email, password);
      await deleteAccount(accessToken, authKey);
      // Deleting the local per-user cache is done here, after the server
      // confirms deletion, so a wrong-password attempt never touches local
      // data. logout() clears the rest (SecureStore session, in-memory
      // state) and routes back to the login screen via the existing
      // status==="locked" redirect in app/(app)/_layout.tsx.
      await SQLite.deleteDatabaseAsync(`vault-${user.id}.db`);
      await logout();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError("Incorrect password.");
      } else {
        setError("Couldn't delete your account. Check your connection and try again.");
      }
      setLoading(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.systemBackground, padding: spacing.lg, gap: spacing.md }}>
      <ThemedText variant="largeTitle">Delete account</ThemedText>
      <ThemedText variant="subhead">
        Enter your master password to permanently delete your account and every entry in your vault.
      </ThemedText>
      <TextInput
        testID="input-password"
        placeholder="Master password"
        placeholderTextColor={colors.secondaryLabel}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        style={{ color: colors.label, borderBottomWidth: 1, borderColor: colors.separator, paddingVertical: spacing.sm }}
      />
      {error ? (
        <ThemedText variant="subhead" style={{ color: "#E5484D" }}>
          {error}
        </ThemedText>
      ) : null}
      <Button title="Delete my account" variant="secondary" loading={loading} onPress={confirmDelete} />
    </View>
  );
}
```

- [ ] **Step 6: Write the failing test `src/routing/__tests__/delete-account.test.tsx`**

```tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react-native";
import { Alert } from "react-native";
import * as SQLite from "expo-sqlite";
import { useAuth } from "@/context/AuthContext";
import { deleteAccount, ApiError } from "@/api/auth";

jest.mock("@/context/AuthContext");
// Partial mock, not a bare jest.mock("@/api/auth") — a bare auto-mock would
// also replace ApiError with a no-op mock constructor, breaking both
// `new ApiError(...)` below and the `err instanceof ApiError` check inside
// delete-account.tsx itself. Same pitfall already documented in
// AuthContext.test.tsx; keep the real ApiError class, only mock the call.
jest.mock("@/api/auth", () => ({
  ...jest.requireActual("@/api/auth"),
  deleteAccount: jest.fn(),
}));
jest.mock("expo-sqlite");

function getDeleteAccountScreen() {
  return require("../../../app/(app)/settings/delete-account").default;
}

const USER = { id: 1, email: "test@example.com" };

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Alert, "alert").mockImplementation((_title, _message, buttons) => {
    const destructive = buttons?.find((b) => b.style === "destructive");
    destructive?.onPress?.();
  });
});

afterEach(() => {
  (Alert.alert as jest.Mock).mockRestore();
});

test("correct password deletes the account, wipes the local db, and logs out", async () => {
  const logout = jest.fn().mockResolvedValue(undefined);
  (useAuth as jest.Mock).mockReturnValue({ user: USER, accessToken: "tok", logout });
  (deleteAccount as jest.Mock).mockResolvedValue(undefined);
  (SQLite.deleteDatabaseAsync as jest.Mock).mockResolvedValue(undefined);
  const DeleteAccountScreen = getDeleteAccountScreen();

  await render(<DeleteAccountScreen />);
  fireEvent.changeText(screen.getByTestId("input-password"), "correct horse battery staple");
  fireEvent.press(screen.getByText("Delete my account"));

  await waitFor(() => expect(deleteAccount).toHaveBeenCalledWith("tok", expect.any(Uint8Array)));
  expect(SQLite.deleteDatabaseAsync).toHaveBeenCalledWith("vault-1.db");
  expect(logout).toHaveBeenCalled();
});

test("wrong password shows an error and does not touch local data", async () => {
  const logout = jest.fn();
  (useAuth as jest.Mock).mockReturnValue({ user: USER, accessToken: "tok", logout });
  (deleteAccount as jest.Mock).mockRejectedValue(new ApiError(401, "Incorrect password"));
  const DeleteAccountScreen = getDeleteAccountScreen();

  await render(<DeleteAccountScreen />);
  fireEvent.changeText(screen.getByTestId("input-password"), "wrong password");
  fireEvent.press(screen.getByText("Delete my account"));

  await waitFor(() => expect(screen.getByText("Incorrect password.")).toBeTruthy());
  expect(SQLite.deleteDatabaseAsync).not.toHaveBeenCalled();
  expect(logout).not.toHaveBeenCalled();
});
```

- [ ] **Step 7: Run the tests**

Run: `bun x jest src/routing/__tests__/delete-account.test.tsx`
Expected: PASS (2 passed)

- [ ] **Step 8: Run the full suite**

Run: `bun x jest`
Expected: all suites pass

- [ ] **Step 9: Commit**

```bash
git add apps/mobile/src/api/auth.ts apps/mobile/src/api/auth.test.ts "apps/mobile/app/(app)/settings/delete-account.tsx" apps/mobile/src/routing/__tests__/delete-account.test.tsx
git commit -m "add account deletion screen and API call"
```

---

### Task 6: `csvFormat.ts`

**Files:**
- Create: `apps/mobile/src/import-export/csvFormat.ts`
- Test: `apps/mobile/src/import-export/csvFormat.test.ts`

**Interfaces:**
- Consumes: `VaultEntryContent` (`@/context/vaultEntry`, Plan 2, unchanged).
- Produces: `CsvRow { name: string; url: string; username: string; password: string }`, `csvRowToEntry(row: CsvRow): VaultEntryContent`, `entryToCsvRow(content: VaultEntryContent): CsvRow`, `escapeCsvCell(value: string): string`, `rowsToCsv(rows: CsvRow[]): string`, `csvToRows(csv: string): CsvRow[]` — consumed by Task 7 (`exportVault.ts`) and Task 8 (`importVault.ts`).

- [ ] **Step 1: Write `src/import-export/csvFormat.ts`**

```ts
import type { VaultEntryContent } from "@/context/vaultEntry";

export interface CsvRow {
  name: string;
  url: string;
  username: string;
  password: string;
}

export function csvRowToEntry(row: CsvRow): VaultEntryContent {
  return {
    title: row.name || row.url,
    username: row.username || undefined,
    password: row.password,
    url: row.url || undefined,
  };
}

export function entryToCsvRow(content: VaultEntryContent): CsvRow {
  return {
    name: content.title,
    url: content.url ?? "",
    username: content.username ?? "",
    password: content.password,
  };
}

// A cell value starting with =, +, -, or @ can be interpreted as a formula
// if the exported CSV is later opened in Excel/Sheets ("CSV injection").
// Prefixing with a leading apostrophe is the standard defense — spreadsheet
// apps treat a leading apostrophe as "force text", not part of the value.
export function escapeCsvCell(value: string): string {
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}

const CSV_COLUMNS = ["name", "url", "username", "password"] as const;

function quoteCsvField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function rowsToCsv(rows: CsvRow[]): string {
  const header = CSV_COLUMNS.join(",");
  const lines = rows.map((row) => CSV_COLUMNS.map((col) => quoteCsvField(escapeCsvCell(row[col]))).join(","));
  return [header, ...lines].join("\r\n");
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      fields.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
}

export function csvToRows(csv: string): CsvRow[] {
  const lines = csv.split(/\r\n|\n/).filter((line) => line.length > 0);
  if (lines.length === 0) return [];
  const [headerLine, ...dataLines] = lines;
  const headers = parseCsvLine(headerLine).map((h) => h.trim().toLowerCase());
  return dataLines.map((line) => {
    const values = parseCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((header, i) => {
      row[header] = values[i] ?? "";
    });
    return {
      name: row.name ?? "",
      url: row.url ?? "",
      username: row.username ?? "",
      password: row.password ?? "",
    };
  });
}
```

- [ ] **Step 2: Write the failing test `src/import-export/csvFormat.test.ts`**

```ts
import { csvRowToEntry, entryToCsvRow, escapeCsvCell, rowsToCsv, csvToRows } from "./csvFormat";

test("csvRowToEntry maps name/url/username/password to a VaultEntryContent", () => {
  const entry = csvRowToEntry({ name: "GitHub", url: "https://github.com", username: "me", password: "hunter2" });
  expect(entry).toEqual({ title: "GitHub", username: "me", password: "hunter2", url: "https://github.com" });
});

test("csvRowToEntry falls back to url as the title when name is empty", () => {
  const entry = csvRowToEntry({ name: "", url: "https://github.com", username: "", password: "hunter2" });
  expect(entry.title).toBe("https://github.com");
  expect(entry.username).toBeUndefined();
});

test("entryToCsvRow maps a VaultEntryContent back to CSV row shape", () => {
  const row = entryToCsvRow({ title: "GitHub", username: "me", password: "hunter2", url: "https://github.com" });
  expect(row).toEqual({ name: "GitHub", url: "https://github.com", username: "me", password: "hunter2" });
});

test("entryToCsvRow uses empty strings for missing optional fields", () => {
  const row = entryToCsvRow({ title: "GitHub", password: "hunter2" });
  expect(row.url).toBe("");
  expect(row.username).toBe("");
});

test("escapeCsvCell prefixes values starting with =, +, -, or @ with an apostrophe", () => {
  expect(escapeCsvCell("=cmd")).toBe("'=cmd");
  expect(escapeCsvCell("+1234")).toBe("'+1234");
  expect(escapeCsvCell("-5")).toBe("'-5");
  expect(escapeCsvCell("@mention")).toBe("'@mention");
});

test("escapeCsvCell leaves ordinary values untouched", () => {
  expect(escapeCsvCell("hunter2")).toBe("hunter2");
});

test("rowsToCsv then csvToRows round-trips rows, including a comma and a quote in a field", () => {
  const rows = [
    { name: "GitHub", url: "https://github.com", username: "me", password: "hunter2" },
    { name: "Work, Inc.", url: "https://work.example", username: 'user"name', password: "p@ss" },
  ];

  const csv = rowsToCsv(rows);
  const parsed = csvToRows(csv);

  expect(parsed).toEqual(rows);
});

test("csvToRows parses a header-only CSV as an empty array", () => {
  expect(csvToRows("name,url,username,password")).toEqual([]);
});
```

- [ ] **Step 3: Run the tests**

Run: `bun x jest src/import-export/csvFormat.test.ts`
Expected: PASS (8 passed)

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/import-export/csvFormat.ts apps/mobile/src/import-export/csvFormat.test.ts
git commit -m "add Chrome/Firefox-compatible CSV format module"
```

---

### Task 7: `exportVault.ts` + export screen

**Files:**
- Create: `apps/mobile/src/import-export/exportVault.ts`
- Test: `apps/mobile/src/import-export/exportVault.test.ts`
- Create: `apps/mobile/app/(app)/settings/export.tsx`
- Test: `apps/mobile/src/routing/__tests__/export.test.tsx`

**Interfaces:**
- Consumes: `entryToCsvRow`, `rowsToCsv` (Task 6), `useVault().entries` (Plan 2, unchanged).
- Produces: `exportVaultToCsv(entries: VaultEntryContent[]): Promise<void>`.

**Package note:** this task needs `expo-sharing` and `expo-file-system`, not yet installed. Tell the user to run, from `apps/mobile`:
```
bun x expo install expo-sharing expo-file-system
```
before starting this task.

- [ ] **Step 1: Write `src/import-export/exportVault.ts`**

```ts
import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";
import { entryToCsvRow, rowsToCsv } from "./csvFormat";
import type { VaultEntryContent } from "@/context/vaultEntry";

export async function exportVaultToCsv(entries: VaultEntryContent[]): Promise<void> {
  const rows = entries.map(entryToCsvRow);
  const csv = rowsToCsv(rows);
  const fileUri = `${FileSystem.cacheDirectory}vault-export.csv`;
  await FileSystem.writeAsStringAsync(fileUri, csv, { encoding: FileSystem.EncodingType.UTF8 });
  try {
    await Sharing.shareAsync(fileUri, { mimeType: "text/csv", UTI: "public.comma-separated-values-text" });
  } finally {
    // Delete the temp file right after the share sheet resolves — a
    // plaintext password export must not sit in the app's local storage
    // indefinitely. Runs even if shareAsync throws/is cancelled.
    await FileSystem.deleteAsync(fileUri, { idempotent: true });
  }
}
```

- [ ] **Step 2: Write the failing test `src/import-export/exportVault.test.ts`**

```ts
import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";
import { exportVaultToCsv } from "./exportVault";

jest.mock("expo-file-system", () => ({
  cacheDirectory: "file:///cache/",
  writeAsStringAsync: jest.fn(),
  deleteAsync: jest.fn(),
  EncodingType: { UTF8: "utf8" },
}));
jest.mock("expo-sharing", () => ({
  shareAsync: jest.fn(),
}));

beforeEach(() => {
  jest.clearAllMocks();
});

test("writes a CSV file to the cache directory and shares it", async () => {
  await exportVaultToCsv([{ title: "GitHub", password: "hunter2" }]);

  expect(FileSystem.writeAsStringAsync).toHaveBeenCalledWith(
    "file:///cache/vault-export.csv",
    expect.stringContaining("GitHub"),
    expect.anything()
  );
  expect(Sharing.shareAsync).toHaveBeenCalledWith("file:///cache/vault-export.csv", expect.anything());
});

test("deletes the temp file after sharing succeeds", async () => {
  await exportVaultToCsv([{ title: "GitHub", password: "hunter2" }]);

  expect(FileSystem.deleteAsync).toHaveBeenCalledWith("file:///cache/vault-export.csv", { idempotent: true });
});

test("deletes the temp file even when sharing fails", async () => {
  (Sharing.shareAsync as jest.Mock).mockRejectedValueOnce(new Error("share failed"));

  await expect(exportVaultToCsv([{ title: "GitHub", password: "hunter2" }])).rejects.toThrow("share failed");

  expect(FileSystem.deleteAsync).toHaveBeenCalledWith("file:///cache/vault-export.csv", { idempotent: true });
});
```

- [ ] **Step 3: Run the tests**

Run: `bun x jest src/import-export/exportVault.test.ts`
Expected: PASS (3 passed)

- [ ] **Step 4: Write `app/(app)/settings/export.tsx`**

```tsx
import { useState } from "react";
import { View } from "react-native";
import { useVault } from "@/context/VaultContext";
import { exportVaultToCsv } from "@/import-export/exportVault";
import { Button } from "@/components/button";
import { ThemedText } from "@/components/themed-text";
import { colors, spacing } from "@/theme";

export default function ExportScreen() {
  const { entries } = useVault();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleExport() {
    setError(null);
    setLoading(true);
    try {
      await exportVaultToCsv(entries.map((e) => e.content));
    } catch {
      setError("Couldn't export your vault. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.systemBackground, padding: spacing.lg, gap: spacing.md }}>
      <ThemedText variant="largeTitle">Export vault</ThemedText>
      <ThemedText variant="subhead">
        Saves a CSV file with every entry's title, URL, username, and password in plain text — share it
        somewhere safe.
      </ThemedText>
      {error ? (
        <ThemedText variant="subhead" style={{ color: "#E5484D" }}>
          {error}
        </ThemedText>
      ) : null}
      <Button title="Export" loading={loading} onPress={handleExport} />
    </View>
  );
}
```

- [ ] **Step 5: Write the failing test `src/routing/__tests__/export.test.tsx`**

```tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react-native";
import { useVault } from "@/context/VaultContext";
import { exportVaultToCsv } from "@/import-export/exportVault";

jest.mock("@/context/VaultContext");
jest.mock("@/import-export/exportVault");

function getExportScreen() {
  return require("../../../app/(app)/settings/export").default;
}

beforeEach(() => {
  jest.clearAllMocks();
  (useVault as jest.Mock).mockReturnValue({
    entries: [{ id: "1", content: { title: "GitHub", password: "hunter2" }, syncStatus: "synced" }],
  });
});

test("tapping Export calls exportVaultToCsv with the decrypted entry contents", async () => {
  (exportVaultToCsv as jest.Mock).mockResolvedValue(undefined);
  const ExportScreen = getExportScreen();

  await render(<ExportScreen />);
  fireEvent.press(screen.getByText("Export"));

  await waitFor(() => expect(exportVaultToCsv).toHaveBeenCalledWith([{ title: "GitHub", password: "hunter2" }]));
});

test("shows an error message when export fails", async () => {
  (exportVaultToCsv as jest.Mock).mockRejectedValue(new Error("fail"));
  const ExportScreen = getExportScreen();

  await render(<ExportScreen />);
  fireEvent.press(screen.getByText("Export"));

  await waitFor(() => expect(screen.getByText("Couldn't export your vault. Please try again.")).toBeTruthy());
});
```

- [ ] **Step 6: Run the tests**

Run: `bun x jest src/routing/__tests__/export.test.tsx`
Expected: PASS (2 passed)

- [ ] **Step 7: Run the full suite**

Run: `bun x jest`
Expected: all suites pass

- [ ] **Step 8: Commit**

```bash
git add apps/mobile/src/import-export/exportVault.ts apps/mobile/src/import-export/exportVault.test.ts "apps/mobile/app/(app)/settings/export.tsx" apps/mobile/src/routing/__tests__/export.test.tsx
git commit -m "add CSV export with temp-file cleanup"
```

---

### Task 8: `importVault.ts` + import screen

**Files:**
- Create: `apps/mobile/src/import-export/importVault.ts`
- Test: `apps/mobile/src/import-export/importVault.test.ts`
- Create: `apps/mobile/app/(app)/settings/import.tsx`
- Test: `apps/mobile/src/routing/__tests__/import.test.tsx`

**Interfaces:**
- Consumes: `csvToRows`, `csvRowToEntry` (Task 6), `useVault().createEntry` (Plan 2, unchanged).
- Produces: `parseImportCsv(csv: string): VaultEntryContent[]`, `importEntries(entries: VaultEntryContent[], createEntry: (content: VaultEntryContent) => Promise<void>): Promise<number>`.

**Package note:** this task needs `expo-document-picker`, not yet installed. Tell the user to run, from `apps/mobile`:
```
bun x expo install expo-document-picker
```
before starting this task. **Also note:** `expo-document-picker`'s `getDocumentAsync()` result shape (`{ canceled: boolean; assets: { uri: string; ... }[] | null }`) is written from current knowledge of the package's API — once it's installed, check `node_modules/expo-document-picker`'s type definitions (`DocumentPickerResult` in `build/DocumentPicker.types.d.ts` or similar) and adjust the screen code below if the actual shape differs.

- [ ] **Step 1: Write `src/import-export/importVault.ts`**

```ts
import { csvToRows, csvRowToEntry } from "./csvFormat";
import type { VaultEntryContent } from "@/context/vaultEntry";

export function parseImportCsv(csv: string): VaultEntryContent[] {
  return csvToRows(csv)
    .filter((row) => row.password.length > 0)
    .map(csvRowToEntry);
}

// No conflict/dedup detection by design (see spec) — importing over
// existing entries just creates duplicates the user can clean up manually.
// Goes through the normal createEntry path so every imported entry is
// properly client-side encrypted and queued, exactly like a manually
// created one — never a bulk-insert bypass.
export async function importEntries(
  entries: VaultEntryContent[],
  createEntry: (content: VaultEntryContent) => Promise<void>
): Promise<number> {
  for (const entry of entries) {
    await createEntry(entry);
  }
  return entries.length;
}
```

- [ ] **Step 2: Write the failing test `src/import-export/importVault.test.ts`**

```ts
import { parseImportCsv, importEntries } from "./importVault";

test("parseImportCsv parses valid rows into VaultEntryContent", () => {
  const csv = "name,url,username,password\r\nGitHub,https://github.com,me,hunter2";
  expect(parseImportCsv(csv)).toEqual([
    { title: "GitHub", url: "https://github.com", username: "me", password: "hunter2" },
  ]);
});

test("parseImportCsv skips rows with an empty password", () => {
  const csv =
    "name,url,username,password\r\nGitHub,https://github.com,me,\r\nGmail,https://gmail.com,me,secret";
  const result = parseImportCsv(csv);
  expect(result).toHaveLength(1);
  expect(result[0].title).toBe("Gmail");
});

test("importEntries calls createEntry once per entry, in order, and returns the count", async () => {
  const createEntry = jest.fn().mockResolvedValue(undefined);
  const entries = [
    { title: "GitHub", password: "hunter2" },
    { title: "Gmail", password: "secret" },
  ];

  const count = await importEntries(entries, createEntry);

  expect(createEntry).toHaveBeenCalledTimes(2);
  expect(createEntry).toHaveBeenNthCalledWith(1, entries[0]);
  expect(createEntry).toHaveBeenNthCalledWith(2, entries[1]);
  expect(count).toBe(2);
});
```

- [ ] **Step 3: Run the tests**

Run: `bun x jest src/import-export/importVault.test.ts`
Expected: PASS (3 passed)

- [ ] **Step 4: Write `app/(app)/settings/import.tsx`**

```tsx
import { useState } from "react";
import { View } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system";
import { useVault } from "@/context/VaultContext";
import { parseImportCsv, importEntries } from "@/import-export/importVault";
import { Button } from "@/components/button";
import { ThemedText } from "@/components/themed-text";
import { colors, spacing } from "@/theme";

export default function ImportScreen() {
  const { createEntry } = useVault();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importedCount, setImportedCount] = useState<number | null>(null);

  async function handleImport() {
    setError(null);
    setImportedCount(null);
    const result = await DocumentPicker.getDocumentAsync({ type: "text/csv" });
    if (result.canceled) return;
    setLoading(true);
    try {
      const csv = await FileSystem.readAsStringAsync(result.assets[0].uri);
      const entries = parseImportCsv(csv);
      const count = await importEntries(entries, createEntry);
      setImportedCount(count);
    } catch {
      setError("Couldn't import that file. Make sure it's a CSV exported from Chrome or Firefox.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.systemBackground, padding: spacing.lg, gap: spacing.md }}>
      <ThemedText variant="largeTitle">Import vault</ThemedText>
      <ThemedText variant="subhead">
        Pick a CSV file exported from Chrome or Firefox. Imported entries aren't checked against your
        existing vault, so re-importing the same file will create duplicates.
      </ThemedText>
      {importedCount !== null ? <ThemedText variant="subhead">{importedCount} imported.</ThemedText> : null}
      {error ? (
        <ThemedText variant="subhead" style={{ color: "#E5484D" }}>
          {error}
        </ThemedText>
      ) : null}
      <Button title="Choose file" loading={loading} onPress={handleImport} />
    </View>
  );
}
```

- [ ] **Step 5: Write the failing test `src/routing/__tests__/import.test.tsx`**

```tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react-native";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system";
import { useVault } from "@/context/VaultContext";
import { parseImportCsv, importEntries } from "@/import-export/importVault";

jest.mock("expo-document-picker");
jest.mock("expo-file-system");
jest.mock("@/context/VaultContext");
jest.mock("@/import-export/importVault");

function getImportScreen() {
  return require("../../../app/(app)/settings/import").default;
}

beforeEach(() => {
  jest.clearAllMocks();
  (useVault as jest.Mock).mockReturnValue({ createEntry: jest.fn() });
});

test("shows the imported count after a successful import", async () => {
  (DocumentPicker.getDocumentAsync as jest.Mock).mockResolvedValue({
    canceled: false,
    assets: [{ uri: "file:///picked.csv" }],
  });
  (FileSystem.readAsStringAsync as jest.Mock).mockResolvedValue(
    "name,url,username,password\r\nGitHub,,me,hunter2"
  );
  (parseImportCsv as jest.Mock).mockReturnValue([{ title: "GitHub", password: "hunter2" }]);
  (importEntries as jest.Mock).mockResolvedValue(1);
  const ImportScreen = getImportScreen();

  await render(<ImportScreen />);
  fireEvent.press(screen.getByText("Choose file"));

  await waitFor(() => expect(screen.getByText("1 imported.")).toBeTruthy());
});

test("does nothing when the user cancels the file picker", async () => {
  (DocumentPicker.getDocumentAsync as jest.Mock).mockResolvedValue({ canceled: true, assets: null });
  const ImportScreen = getImportScreen();

  await render(<ImportScreen />);
  fireEvent.press(screen.getByText("Choose file"));

  await waitFor(() => expect(DocumentPicker.getDocumentAsync).toHaveBeenCalled());
  expect(screen.queryByText(/imported\./)).toBeNull();
});

test("shows an error message when import fails", async () => {
  (DocumentPicker.getDocumentAsync as jest.Mock).mockResolvedValue({
    canceled: false,
    assets: [{ uri: "file:///picked.csv" }],
  });
  (FileSystem.readAsStringAsync as jest.Mock).mockRejectedValue(new Error("read failed"));
  const ImportScreen = getImportScreen();

  await render(<ImportScreen />);
  fireEvent.press(screen.getByText("Choose file"));

  await waitFor(() =>
    expect(
      screen.getByText("Couldn't import that file. Make sure it's a CSV exported from Chrome or Firefox.")
    ).toBeTruthy()
  );
});
```

- [ ] **Step 6: Run the tests**

Run: `bun x jest src/routing/__tests__/import.test.tsx`
Expected: PASS (3 passed)

- [ ] **Step 7: Run the full suite and typecheck**

Run: `bun x tsc --noEmit && bun x jest`
Expected: no type errors, all suites pass

- [ ] **Step 8: Commit**

```bash
git add apps/mobile/src/import-export/importVault.ts apps/mobile/src/import-export/importVault.test.ts "apps/mobile/app/(app)/settings/import.tsx" apps/mobile/src/routing/__tests__/import.test.tsx
git commit -m "add CSV import"
```
