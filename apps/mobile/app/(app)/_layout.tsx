import { Redirect, Stack } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { useAuth } from "@/context/AuthContext";
import { colors } from "@/theme";

export default function AppLayout() {
  const { status } = useAuth();

  if (status === "loading") {
    return (
      <View style={{ flex: 1, backgroundColor: colors.systemBackground, justifyContent: "center" }}>
        <ActivityIndicator testID="loading-indicator" />
      </View>
    );
  }

  if (status === "locked") {
    return <Redirect href="/(auth)/login" />;
  }

  return <Stack screenOptions={{ headerShown: false }} />;
}
