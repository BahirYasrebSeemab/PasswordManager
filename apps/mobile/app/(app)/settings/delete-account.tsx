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
