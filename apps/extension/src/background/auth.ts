import { ApiError, login as apiLogin } from "../api/auth";
import { deriveKeys } from "../crypto/deriveKeys";
import type { Result } from "../messaging/types";
import { validateLoginInput } from "../safety/limits";
import { saveSession, type KeyValueStore } from "./session";

export interface AuthDeps {
  store: KeyValueStore;
  now: () => number;
  login: typeof apiLogin;
}

// The master password exists only inside this function: it is turned into keys,
// the keys go to storage.session, and the password is never stored or logged.
export async function performLogin(deps: AuthDeps, email: string, masterPassword: string): Promise<Result> {
  if (!validateLoginInput(email, masterPassword).ok) {
    return { ok: false, error: "invalid_input" };
  }
  const normalizedEmail = email.trim().toLowerCase();
  const { vaultKey, authKey } = deriveKeys(normalizedEmail, masterPassword);

  try {
    const token = await deps.login(normalizedEmail, authKey);
    await saveSession(deps.store, {
      email: normalizedEmail,
      vaultKey,
      authKey,
      accessToken: token.access_token,
      lastActivityAt: deps.now(),
    });
    return { ok: true };
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return { ok: false, error: "invalid_credentials" };
    if (error instanceof ApiError && error.status === 429) return { ok: false, error: "rate_limited" };
    return { ok: false, error: "network" };
  }
}
