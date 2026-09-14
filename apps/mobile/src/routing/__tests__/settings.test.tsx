import { render, screen, fireEvent, waitFor } from "@testing-library/react-native";
import { useAuth } from "@/context/AuthContext";
import * as SecureStore from "expo-secure-store";
import { getBiometricEnabled, getAutoLockSeconds, setAutoLockSeconds } from "@/settings/preferences";

jest.mock("@/context/AuthContext");
jest.mock("expo-secure-store");
jest.mock("@/settings/preferences");
jest.mock("expo-router", () => ({
  Link: ({ children }: { children: React.ReactNode }) => children,
}));

function getSettingsScreen() {
  return require("../../../app/(app)/settings/index").default;
}

beforeEach(() => {
  jest.clearAllMocks();
  (useAuth as jest.Mock).mockReturnValue({ setBiometricPreference: jest.fn() });
  (SecureStore.canUseBiometricAuthentication as jest.Mock).mockReturnValue(true);
  (getBiometricEnabled as jest.Mock).mockResolvedValue(true);
  (getAutoLockSeconds as jest.Mock).mockResolvedValue(30);
});

test("shows the biometric toggle as enabled when available and on", async () => {
  const SettingsScreen = getSettingsScreen();

  await render(<SettingsScreen />);

  await waitFor(() => expect(screen.getByText("Enabled — tap to disable")).toBeTruthy());
});

test("shows 'Not available on this device.' when biometric hardware is unavailable", async () => {
  (SecureStore.canUseBiometricAuthentication as jest.Mock).mockReturnValue(false);
  const SettingsScreen = getSettingsScreen();

  await render(<SettingsScreen />);

  await waitFor(() => expect(screen.getByText("Not available on this device.")).toBeTruthy());
});

test("tapping a different auto-lock preset persists it", async () => {
  const SettingsScreen = getSettingsScreen();

  await render(<SettingsScreen />);
  await waitFor(() => expect(screen.getByText("1 minute")).toBeTruthy());
  fireEvent.press(screen.getByText("1 minute"));

  await waitFor(() => expect(setAutoLockSeconds).toHaveBeenCalledWith(60));
});

test("tapping the biometric toggle calls setBiometricPreference with the flipped value", async () => {
  const setBiometricPreference = jest.fn();
  (useAuth as jest.Mock).mockReturnValue({ setBiometricPreference });
  const SettingsScreen = getSettingsScreen();

  await render(<SettingsScreen />);
  await waitFor(() => expect(screen.getByText("Enabled — tap to disable")).toBeTruthy());
  fireEvent.press(screen.getByText("Enabled — tap to disable"));

  await waitFor(() => expect(setBiometricPreference).toHaveBeenCalledWith(false));
});
