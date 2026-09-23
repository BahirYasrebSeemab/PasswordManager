import { useState } from "react";
import { TextInput } from "react-native";
import { Link } from "expo-router";
import { useAuth } from "@/context/AuthContext";
import { ApiError } from "@/api/auth";
import { Button } from "@/components/button";
import { KeyboardSafeForm } from "@/components/keyboard-safe-form";
import { ThemedText } from "@/components/themed-text";
import { colors, spacing } from "@/theme";

export default function LoginScreen() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    setError(null);
    setLoading(true);
    try {
      await login(email, password);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401) {
          setError("Invalid email or password.");
        } else if (err.status === 429) {
          setError("Too many attempts. Please wait a minute and try again.");
        } else if (err.status === 409) {
          setError("There was a conflict with your request. Please try again.");
        } else {
          setError("Something went wrong. Please try again.");
        }
      } else {
        setError("Couldn't reach the server. Check your connection and try again.");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardSafeForm contentStyle={{ justifyContent: "center" }}>
      <ThemedText variant="largeTitle">Unlock your vault</ThemedText>
      <TextInput
        placeholder="Email"
        placeholderTextColor={colors.secondaryLabel}
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
        style={{ color: colors.label, borderBottomWidth: 1, borderColor: colors.separator, paddingVertical: spacing.sm }}
      />
      <TextInput
        placeholder="Master password"
        placeholderTextColor={colors.secondaryLabel}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        style={{ color: colors.label, borderBottomWidth: 1, borderColor: colors.separator, paddingVertical: spacing.sm }}
      />
      {error && <ThemedText variant="subhead" style={{ color: "#E5484D" }}>{error}</ThemedText>}
      <Button title="Log in" onPress={handleSubmit} loading={loading} />
      <Link href="/(auth)/register" asChild>
        <ThemedText variant="subhead" style={{ textAlign: "center" }}>
          Need an account? Register
        </ThemedText>
      </Link>
    </KeyboardSafeForm>
  );
}
