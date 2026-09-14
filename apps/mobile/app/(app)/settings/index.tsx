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
