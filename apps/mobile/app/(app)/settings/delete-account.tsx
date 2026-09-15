import { useState } from "react";
import { Alert, TextInput, View } from "react-native";
import { useAuth } from "@/context/AuthContext";
import { useVault } from "@/context/VaultContext";
import { deriveKeys } from "@/crypto/deriveKeys";
import { deleteAccount, ApiError } from "@/api/auth";
import { Button } from "@/components/button";
import { ThemedText } from "@/components/themed-text";
import { colors, spacing } from "@/theme";

export default function DeleteAccountScreen() {
  const { user, accessToken, logout } = useAuth();
  const { deleteLocalVault } = useVault();
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
      // Yield before the synchronous, multi-second PBKDF2 derivation so the
      // loading spinner actually paints first — same reasoning as
      // AuthContext's register()/login().
      await new Promise(requestAnimationFrame);
      const { authKey } = deriveKeys(user.email, password);
      await deleteAccount(accessToken, authKey);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError("Incorrect password.");
      } else if (err instanceof ApiError && err.status === 429) {
        setError("Too many attempts. Wait a minute and try again.");
      } else {
        setError("Couldn't delete your account. Check your connection and try again.");
      }
      setLoading(false);
      return;
    }

    // Server-side deletion has already succeeded at this point — the
    // account is gone regardless of what happens next. Local cleanup must
    // never strand the session: fall through to logout() even if it fails.
    try {
      await deleteLocalVault();
    } catch {
      // best-effort local cleanup — the server-side deletion already
      // succeeded, so don't block logout() on this
    }
    await logout();
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
