import * as SecureStore from "expo-secure-store";
import { bytesToBase64, base64ToBytes } from "@/crypto/base64";

const KEYS = {
  vaultKey: "vault_key",
  authKey: "auth_key",
  accessToken: "access_token",
  email: "email",
} as const;

const SECURE_STORE_OPTIONS = { requireAuthentication: true } as const;

export interface StoredSession {
  vaultKey: Uint8Array;
  authKey: Uint8Array;
  accessToken: string;
  email: string;
}

export async function saveSession(session: StoredSession): Promise<void> {
  await SecureStore.setItemAsync(KEYS.vaultKey, bytesToBase64(session.vaultKey), SECURE_STORE_OPTIONS);
  await SecureStore.setItemAsync(KEYS.authKey, bytesToBase64(session.authKey), SECURE_STORE_OPTIONS);
  await SecureStore.setItemAsync(KEYS.accessToken, session.accessToken, SECURE_STORE_OPTIONS);
  await SecureStore.setItemAsync(KEYS.email, session.email, SECURE_STORE_OPTIONS);
}

export async function loadSession(): Promise<StoredSession | null> {
  // Sequential, not Promise.all: each of these reads is backed by
  // requireAuthentication: true, so on platforms where that triggers a
  // biometric (Face ID / fingerprint) prompt, firing all 4 concurrently
  // risks overlapping prompts. Read one at a time instead, same as
  // saveSession() already does.
  const vaultKeyB64 = await SecureStore.getItemAsync(KEYS.vaultKey, SECURE_STORE_OPTIONS);
  const authKeyB64 = await SecureStore.getItemAsync(KEYS.authKey, SECURE_STORE_OPTIONS);
  const accessToken = await SecureStore.getItemAsync(KEYS.accessToken, SECURE_STORE_OPTIONS);
  const email = await SecureStore.getItemAsync(KEYS.email, SECURE_STORE_OPTIONS);

  if (!vaultKeyB64 || !authKeyB64 || !accessToken || !email) {
    return null;
  }

  return {
    vaultKey: base64ToBytes(vaultKeyB64),
    authKey: base64ToBytes(authKeyB64),
    accessToken,
    email,
  };
}

export async function updateAccessToken(accessToken: string): Promise<void> {
  await SecureStore.setItemAsync(KEYS.accessToken, accessToken, SECURE_STORE_OPTIONS);
}

export async function clearSession(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(KEYS.vaultKey, SECURE_STORE_OPTIONS),
    SecureStore.deleteItemAsync(KEYS.authKey, SECURE_STORE_OPTIONS),
    SecureStore.deleteItemAsync(KEYS.accessToken, SECURE_STORE_OPTIONS),
    SecureStore.deleteItemAsync(KEYS.email, SECURE_STORE_OPTIONS),
  ]);
}
