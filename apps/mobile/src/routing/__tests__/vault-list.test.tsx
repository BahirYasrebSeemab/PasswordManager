import { render, screen } from "@testing-library/react-native";
import { useAuth } from "@/context/AuthContext";
import { useVault } from "@/context/VaultContext";

jest.mock("@/context/AuthContext");
jest.mock("@/context/VaultContext");
jest.mock("expo-router", () => ({
  Link: ({ children }: { children: React.ReactNode }) => children,
  useRouter: () => ({ push: jest.fn() }),
}));

function getVaultListScreen() {
  return require("../../../app/(app)/index").default;
}

beforeEach(() => {
  jest.clearAllMocks();
  (useAuth as jest.Mock).mockReturnValue({ logout: jest.fn() });
});

test("renders each entry's title and username", async () => {
  (useVault as jest.Mock).mockReturnValue({
    entries: [
      { id: "1", content: { title: "GitHub", username: "me@example.com", password: "x" }, syncStatus: "synced" },
    ],
    isSyncing: false,
    refresh: jest.fn(),
  });
  const VaultListScreen = getVaultListScreen();

  await render(<VaultListScreen />);

  expect(screen.getByText("GitHub")).toBeTruthy();
  expect(screen.getByText("me@example.com")).toBeTruthy();
});

test("shows the empty state when there are no entries", async () => {
  (useVault as jest.Mock).mockReturnValue({ entries: [], isSyncing: false, refresh: jest.fn() });
  const VaultListScreen = getVaultListScreen();

  await render(<VaultListScreen />);

  expect(screen.getByText("No entries yet.")).toBeTruthy();
});

test("shows a conflict label on a conflicted entry", async () => {
  (useVault as jest.Mock).mockReturnValue({
    entries: [{ id: "1", content: { title: "GitHub", password: "x" }, syncStatus: "conflict" }],
    isSyncing: false,
    refresh: jest.fn(),
  });
  const VaultListScreen = getVaultListScreen();

  await render(<VaultListScreen />);

  expect(screen.getByText("Conflict — tap to resolve")).toBeTruthy();
});
