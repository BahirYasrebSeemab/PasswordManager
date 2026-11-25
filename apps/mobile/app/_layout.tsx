import "react-native-get-random-values";
import "../global.css";

import { Stack } from "expo-router";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider } from "@/context/AuthContext";
import { VaultProvider } from "@/context/VaultContext";

export default function RootLayout() {
  return (
    // Required for useSafeAreaInsets() (used by Spotlight, to keep screen
    // content clear of the notch/status bar) to work at all — it was a
    // listed dependency that nothing actually used yet.
    <SafeAreaProvider>
      <AuthProvider>
        <VaultProvider>
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="(auth)" />
            <Stack.Screen name="(app)" />
          </Stack>
        </VaultProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
