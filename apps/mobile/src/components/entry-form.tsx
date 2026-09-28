import { useState } from "react";
import { View } from "react-native";
import { Button } from "./button";
import { Input } from "./input";
import { ThemedText } from "./themed-text";
import { spacing } from "@/theme";
import type { VaultEntryContent } from "@/context/vaultEntry";

export function EntryForm({
  initialValue,
  submitLabel,
  onSubmit,
}: {
  initialValue?: VaultEntryContent;
  submitLabel: string;
  onSubmit: (content: VaultEntryContent) => Promise<void>;
}) {
  const [title, setTitle] = useState(initialValue?.title ?? "");
  const [username, setUsername] = useState(initialValue?.username ?? "");
  const [password, setPassword] = useState(initialValue?.password ?? "");
  const [url, setUrl] = useState(initialValue?.url ?? "");
  const [notes, setNotes] = useState(initialValue?.notes ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    setError(null);
    if (!title.trim() || !password) {
      setError("Title and password are required.");
      return;
    }
    setLoading(true);
    try {
      await onSubmit({
        title: title.trim(),
        username: username.trim() || undefined,
        password,
        url: url.trim() || undefined,
        notes: notes.trim() || undefined,
      });
    } catch {
      setError("Couldn't save. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={{ gap: spacing.md }}>
      <Input testID="input-title" label="Title" value={title} onChangeText={setTitle} />
      <Input testID="input-username" label="Username" value={username} onChangeText={setUsername} autoCapitalize="none" />
      <Input testID="input-password" label="Password" value={password} onChangeText={setPassword} password />
      <Input testID="input-url" label="URL" value={url} onChangeText={setUrl} autoCapitalize="none" />
      <Input testID="input-notes" label="Notes" value={notes} onChangeText={setNotes} multiline />
      {error ? (
        <ThemedText variant="subhead" style={{ color: "#E5484D" }}>
          {error}
        </ThemedText>
      ) : null}
      <Button title={submitLabel} onPress={handleSubmit} loading={loading} />
    </View>
  );
}
