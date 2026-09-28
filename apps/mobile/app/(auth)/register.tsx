import { useState } from "react";
import { Link } from "expo-router";
import { useAuth } from "@/context/AuthContext";
import { ApiError } from "@/api/auth";
import { Button } from "@/components/button";
import { Input } from "@/components/input";
import { KeyboardSafeForm } from "@/components/keyboard-safe-form";
import { ThemedText } from "@/components/themed-text";

export default function RegisterScreen() {
  const { register } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    setError(null);
    setLoading(true);
    try {
      await register(email, password);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401) {
          setError("Something went wrong verifying your details. Please try again.");
        } else if (err.status === 429) {
          setError("Too many attempts. Please wait a minute and try again.");
        } else if (err.status === 409) {
          setError("That email is already registered.");
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
      <ThemedText variant="largeTitle">Create your vault</ThemedText>
      <Input
        testID="input-email"
        label="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
      />
      <Input testID="input-password" label="Master password" value={password} onChangeText={setPassword} password />
      <ThemedText variant="caption">
        Your master password never leaves this device — losing it means losing access to your vault, with no
        recovery. Choose something you'll remember.
      </ThemedText>
      {error && <ThemedText variant="subhead" style={{ color: "#E5484D" }}>{error}</ThemedText>}
      <Button title="Register" onPress={handleSubmit} loading={loading} />
      <Link href="/(auth)/login" asChild>
        <ThemedText variant="subhead" style={{ textAlign: "center" }}>
          Already have an account? Log in
        </ThemedText>
      </Link>
    </KeyboardSafeForm>
  );
}
