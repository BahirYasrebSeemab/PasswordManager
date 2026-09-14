import { FlatList, Pressable, View } from "react-native";
import { Link, useRouter } from "expo-router";
import { useAuth } from "@/context/AuthContext";
import { useVault } from "@/context/VaultContext";
import { Button } from "@/components/button";
import { ThemedText } from "@/components/themed-text";
import { colors, spacing } from "@/theme";

const STATUS_LABEL: Record<string, string> = {
  synced: "",
  pending: "Syncing…",
  conflict: "Conflict — tap to resolve",
};

export default function VaultListScreen() {
  const { logout } = useAuth();
  const { entries, isSyncing, refresh } = useVault();
  const router = useRouter();

  return (
    <View style={{ flex: 1, backgroundColor: colors.systemBackground, padding: spacing.lg, gap: spacing.md }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <ThemedText variant="largeTitle">Vault</ThemedText>
        <View style={{ flexDirection: "row", gap: spacing.sm }}>
          <Link href="/settings" asChild>
            <Button title="Settings" variant="secondary" size="sm" />
          </Link>
          <Button title="Log out" variant="secondary" size="sm" onPress={logout} />
        </View>
      </View>
      <FlatList
        data={entries}
        keyExtractor={(item) => item.id}
        refreshing={isSyncing}
        onRefresh={refresh}
        ListEmptyComponent={<ThemedText variant="subhead">No entries yet.</ThemedText>}
        renderItem={({ item }) => (
          <Pressable
            testID={`entry-${item.id}`}
            onPress={() =>
              item.syncStatus === "conflict"
                ? router.push(`/entry/${item.id}/conflict`)
                : router.push(`/entry/${item.id}`)
            }
            style={{ paddingVertical: spacing.sm, borderBottomWidth: 1, borderColor: colors.separator }}
          >
            <ThemedText variant="headline">{item.content.title}</ThemedText>
            {item.content.username ? <ThemedText variant="subhead">{item.content.username}</ThemedText> : null}
            {STATUS_LABEL[item.syncStatus] ? (
              <ThemedText variant="caption">{STATUS_LABEL[item.syncStatus]}</ThemedText>
            ) : null}
          </Pressable>
        )}
      />
      <Link href="/entry/new" asChild>
        <Button title="Add entry" />
      </Link>
    </View>
  );
}
