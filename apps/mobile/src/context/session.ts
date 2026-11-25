import * as SecureStore from "expo-secure-store";
import { bytesToBase64, base64ToBytes } from "@/crypto/base64";
import { getBiometricEnabled } from "@/settings/preferences";

const SESSION_KEY = "session";

const SECURE_STORE_OPTIONS = { requireAuthentication: true } as const;

export interface StoredSession {
  vaultKey: Uint8Array;
  authKey: Uint8Array;
  accessToken: string;
  email: string;
}

// Stored as base64 strings inside one JSON blob — see the note on
// SESSION_KEY above SECURE_STORE_OPTIONS's only use, in saveSession/
// loadSession/clearSession below, for why this is a single key rather than
// one per field.
interface StoredSessionJson {
  vaultKey: string;
  authKey: string;
  accessToken: string;
  email: string;
}

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

// The whole session is stored under ONE SecureStore key, not one key per
// field. requireAuthentication: true makes each individual get/set/delete
// call its own OS-level biometric challenge — an earlier version stored
// vaultKey/authKey/accessToken/email as four separate keys, which meant
// unlocking the app required four separate fingerprint/Face ID prompts in a
// row (confirmed on-device: exactly 4 prompts, one per key, before the app
// opened). Bundling everything into one JSON blob means exactly one
// authenticated read to unlock and one authenticated write to persist.
export async function saveSession(session: StoredSession): Promise<void> {
  const json: StoredSessionJson = {
    vaultKey: bytesToBase64(session.vaultKey),
    authKey: bytesToBase64(session.authKey),
    accessToken: session.accessToken,
    email: session.email,
  };
  await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(json), SECURE_STORE_OPTIONS);
}

export async function loadSession(): Promise<StoredSession | null> {
  const raw = await SecureStore.getItemAsync(SESSION_KEY, SECURE_STORE_OPTIONS);
  if (!raw) {
    return null;
  }

  const json = JSON.parse(raw) as StoredSessionJson;
  return {
    vaultKey: base64ToBytes(json.vaultKey),
    authKey: base64ToBytes(json.authKey),
    accessToken: json.accessToken,
    email: json.email,
  };
}

export async function clearSession(): Promise<void> {
  await SecureStore.deleteItemAsync(SESSION_KEY, SECURE_STORE_OPTIONS);
}
