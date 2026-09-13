import { useState } from "react";
import { View, TextInput } from "react-native";
import { Button } from "./button";
import { ThemedText } from "./themed-text";
import { colors, spacing } from "@/theme";
import type { VaultEntryContent } from "@/context/vaultEntry";

const FIELD_STYLE = {
  color: colors.label,
  borderBottomWidth: 1,
  borderColor: colors.separator,
  paddingVertical: spacing.sm,
};

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
      <TextInput
        testID="input-title"
        placeholder="Title"
        placeholderTextColor={colors.secondaryLabel}
        value={title}
        onChangeText={setTitle}
        style={FIELD_STYLE}
      />
      <TextInput
        testID="input-username"
        placeholder="Username"
        placeholderTextColor={colors.secondaryLabel}
        value={username}
        onChangeText={setUsername}
        autoCapitalize="none"
        style={FIELD_STYLE}
      />
      <TextInput
        testID="input-password"
        placeholder="Password"
        placeholderTextColor={colors.secondaryLabel}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        style={FIELD_STYLE}
      />
      <TextInput
        testID="input-url"
        placeholder="URL"
        placeholderTextColor={colors.secondaryLabel}
        value={url}
        onChangeText={setUrl}
        autoCapitalize="none"
        style={FIELD_STYLE}
      />
      <TextInput
        testID="input-notes"
        placeholder="Notes"
        placeholderTextColor={colors.secondaryLabel}
        value={notes}
        onChangeText={setNotes}
        multiline
        style={FIELD_STYLE}
      />
      {error ? (
        <ThemedText variant="subhead" style={{ color: "#E5484D" }}>
          {error}
        </ThemedText>
      ) : null}
      <Button title={submitLabel} onPress={handleSubmit} loading={loading} />
    </View>
  );
}
