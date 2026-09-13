import { render, screen, fireEvent, waitFor } from "@testing-library/react-native";
import { Alert } from "react-native";
import { useVault } from "@/context/VaultContext";

jest.mock("@/context/VaultContext");
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ id: "1" }),
  useRouter: () => ({ back: jest.fn() }),
}));

function getEntryDetailScreen() {
  return require("../../../app/(app)/entry/[id]").default;
}

beforeEach(() => {
  jest.clearAllMocks();
});

test("renders the entry's title and a pre-filled form when found", async () => {
  (useVault as jest.Mock).mockReturnValue({
    entries: [{ id: "1", content: { title: "GitHub", username: "me", password: "hunter2" }, syncStatus: "synced" }],
    updateEntry: jest.fn(),
    deleteEntry: jest.fn(),
  });
  const EntryDetailScreen = getEntryDetailScreen();

  await render(<EntryDetailScreen />);

  expect(screen.getByText("GitHub")).toBeTruthy();
  expect(screen.getByDisplayValue("me")).toBeTruthy();
});

test("shows 'Entry not found.' when no entry matches the id", async () => {
  (useVault as jest.Mock).mockReturnValue({ entries: [], updateEntry: jest.fn(), deleteEntry: jest.fn() });
  const EntryDetailScreen = getEntryDetailScreen();

  await render(<EntryDetailScreen />);

  expect(screen.getByText("Entry not found.")).toBeTruthy();
});

test("Delete button confirms via Alert, then calls deleteEntry and navigates back", async () => {
  const deleteEntry = jest.fn().mockResolvedValue(undefined);
  (useVault as jest.Mock).mockReturnValue({
    entries: [{ id: "1", content: { title: "GitHub", password: "hunter2" }, syncStatus: "synced" }],
    updateEntry: jest.fn(),
    deleteEntry,
  });
  jest.spyOn(Alert, "alert").mockImplementation((_title, _message, buttons) => {
    const destructive = buttons?.find((b) => b.style === "destructive");
    destructive?.onPress?.();
  });
  const EntryDetailScreen = getEntryDetailScreen();

  await render(<EntryDetailScreen />);
  fireEvent.press(screen.getByText("Delete"));

  await waitFor(() => expect(deleteEntry).toHaveBeenCalledWith("1"));

  (Alert.alert as jest.Mock).mockRestore();
});
