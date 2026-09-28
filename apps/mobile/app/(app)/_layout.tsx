import { Redirect, Stack } from "expo-router";
import { ActivityIndicator } from "react-native";
import { useAuth } from "@/context/AuthContext";
import { Spotlight } from "@/components/spotlight";

export default function AppLayout() {
  const { status } = useAuth();

  if (status === "loading") {
    return (
      <Spotlight contentStyle={{ justifyContent: "center" }}>
        <ActivityIndicator testID="loading-indicator" />
      </Spotlight>
    );
  }

  if (status === "locked") {
    return <Redirect href="/(auth)/login" />;
  }

  return <Stack screenOptions={{ headerShown: false }} />;
}
