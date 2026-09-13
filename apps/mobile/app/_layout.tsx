import "react-native-get-random-values";
import "../global.css";

import { Stack } from "expo-router";
import { AuthProvider } from "@/context/AuthContext";
import { VaultProvider } from "@/context/VaultContext";

export default function RootLayout() {
  return (
    <AuthProvider>
      <VaultProvider>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(auth)" />
          <Stack.Screen name="(app)" />
        </Stack>
      </VaultProvider>
    </AuthProvider>
  );
}
