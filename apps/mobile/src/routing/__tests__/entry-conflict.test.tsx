import { render, screen, fireEvent, waitFor } from "@testing-library/react-native";
import { useVault } from "@/context/VaultContext";

jest.mock("@/context/VaultContext");
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ id: "1" }),
  useRouter: () => ({ back: jest.fn() }),
}));

function getConflictScreen() {
  return require("../../../app/(app)/entry/[id]/conflict").default;
}

beforeEach(() => {
  jest.clearAllMocks();
});

// Regression test for the missing-submit-button class of bug: two full entry
// cards (title/username/password/url/notes each) plus two buttons can easily
// exceed a small screen's height, especially with a long notes field.
test("is wrapped in the keyboard-safe scroll container", async () => {
  (useVault as jest.Mock).mockReturnValue({
    getConflict: () => ({ mine: { title: "A", password: "1" }, theirs: { title: "B", password: "2" } }),
    resolveConflict: jest.fn(),
  });
  const ConflictScreen = getConflictScreen();

  await render(<ConflictScreen />);

  expect(screen.getByTestId("keyboard-safe-scroll")).toBeTruthy();
});

test("shows both versions side by side when there is a conflict", async () => {
  (useVault as jest.Mock).mockReturnValue({
    getConflict: () => ({
      mine: { title: "GitHub", password: "mine-pw" },
      theirs: { title: "GitHub Work", password: "theirs-pw" },
    }),
    resolveConflict: jest.fn(),
  });
  const ConflictScreen = getConflictScreen();

  await render(<ConflictScreen />);

  expect(screen.getByText("Title: GitHub")).toBeTruthy();
  expect(screen.getByText("Title: GitHub Work")).toBeTruthy();
});

test("shows 'No conflict to resolve.' when getConflict returns null", async () => {
  (useVault as jest.Mock).mockReturnValue({ getConflict: () => null, resolveConflict: jest.fn() });
  const ConflictScreen = getConflictScreen();

  await render(<ConflictScreen />);

  expect(screen.getByText("No conflict to resolve.")).toBeTruthy();
});

test("'Keep mine' calls resolveConflict with the entry id and 'mine'", async () => {
  const resolveConflict = jest.fn().mockResolvedValue(undefined);
  (useVault as jest.Mock).mockReturnValue({
    getConflict: () => ({ mine: { title: "A", password: "1" }, theirs: { title: "B", password: "2" } }),
    resolveConflict,
  });
  const ConflictScreen = getConflictScreen();

  await render(<ConflictScreen />);
  fireEvent.press(screen.getByText("Keep mine"));

  await waitFor(() => expect(resolveConflict).toHaveBeenCalledWith("1", "mine"));
});
