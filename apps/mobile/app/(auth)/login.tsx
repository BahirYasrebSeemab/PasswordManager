import { useState } from "react";
import { Link } from "expo-router";
import { useAuth } from "@/context/AuthContext";
import { ApiError } from "@/api/auth";
import { Button } from "@/components/button";
import { Input } from "@/components/input";
import { KeyboardSafeForm } from "@/components/keyboard-safe-form";
import { ThemedText } from "@/components/themed-text";

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
      <Input
        testID="input-email"
        label="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
      />
      <Input testID="input-password" label="Master password" value={password} onChangeText={setPassword} password />
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
