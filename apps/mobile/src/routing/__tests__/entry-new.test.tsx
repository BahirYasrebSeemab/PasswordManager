import { render, screen, fireEvent, waitFor, act } from "@testing-library/react-native";
import { useVault } from "@/context/VaultContext";

jest.mock("@/context/VaultContext");
jest.mock("expo-router", () => ({
  useRouter: () => ({ back: jest.fn() }),
}));

function getNewEntryScreen() {
  return require("../../../app/(app)/entry/new").default;
}

beforeEach(() => {
  jest.clearAllMocks();
});

// Regression test for the missing-submit-button bug: five fields plus the
// Save button can easily exceed the screen height even before the keyboard
// opens, so this screen must be scrollable.
test("is wrapped in the keyboard-safe scroll container", async () => {
  (useVault as jest.Mock).mockReturnValue({ createEntry: jest.fn() });
  const NewEntryScreen = getNewEntryScreen();

  await render(<NewEntryScreen />);

  expect(screen.getByTestId("keyboard-safe-scroll")).toBeTruthy();
});

test("saving a valid entry calls createEntry with the entered fields", async () => {
  const createEntry = jest.fn().mockResolvedValue(undefined);
  (useVault as jest.Mock).mockReturnValue({ createEntry });
  const NewEntryScreen = getNewEntryScreen();

  await render(<NewEntryScreen />);
  await act(async () => {
    fireEvent.changeText(screen.getByTestId("input-title"), "GitHub");
    fireEvent.changeText(screen.getByTestId("input-password"), "hunter2");
  });
  fireEvent.press(screen.getByText("Save"));

  await waitFor(() =>
    expect(createEntry).toHaveBeenCalledWith(expect.objectContaining({ title: "GitHub", password: "hunter2" }))
  );
});
