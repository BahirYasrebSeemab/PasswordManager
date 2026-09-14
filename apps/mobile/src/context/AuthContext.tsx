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
