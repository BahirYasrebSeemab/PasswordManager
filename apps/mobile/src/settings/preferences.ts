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
