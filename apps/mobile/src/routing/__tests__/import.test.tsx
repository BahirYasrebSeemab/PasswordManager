import { render, screen, fireEvent, waitFor } from "@testing-library/react-native";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import { useVault } from "@/context/VaultContext";
import { parseImportCsv, importEntries } from "@/import-export/importVault";

// See delete-account.test.tsx for why: every screen now renders through
// Spotlight (gradient + safe-area-inset logic), so the first render's
// deferred require() pays a one-time cold-transform cost that can exceed
// Jest's default 5000ms budget on its own.
jest.setTimeout(15000);

jest.mock("expo-document-picker");
jest.mock("expo-file-system");
jest.mock("@/context/VaultContext");
jest.mock("@/import-export/importVault");

function getImportScreen() {
  return require("../../../app/(app)/settings/import").default;
}

beforeEach(() => {
  jest.clearAllMocks();
  (useVault as jest.Mock).mockReturnValue({ createEntry: jest.fn() });
});

test("shows the imported count after a successful import", async () => {
  (DocumentPicker.getDocumentAsync as jest.Mock).mockResolvedValue({
    canceled: false,
    assets: [{ uri: "file:///picked.csv" }],
  });
  (FileSystem.readAsStringAsync as jest.Mock).mockResolvedValue(
    "name,url,username,password\r\nGitHub,,me,hunter2"
  );
  (parseImportCsv as jest.Mock).mockReturnValue([{ title: "GitHub", password: "hunter2" }]);
  (importEntries as jest.Mock).mockResolvedValue(1);
  const ImportScreen = getImportScreen();

  await render(<ImportScreen />);
  fireEvent.press(screen.getByText("Choose file"));

  await waitFor(() => expect(screen.getByText("1 imported.")).toBeTruthy());
});

test("does nothing when the user cancels the file picker", async () => {
  (DocumentPicker.getDocumentAsync as jest.Mock).mockResolvedValue({ canceled: true, assets: null });
  const ImportScreen = getImportScreen();

  await render(<ImportScreen />);
  fireEvent.press(screen.getByText("Choose file"));

  await waitFor(() => expect(DocumentPicker.getDocumentAsync).toHaveBeenCalled());
  expect(screen.queryByText(/imported\./)).toBeNull();
});

test("shows an error message when import fails", async () => {
  (DocumentPicker.getDocumentAsync as jest.Mock).mockResolvedValue({
    canceled: false,
    assets: [{ uri: "file:///picked.csv" }],
  });
  (FileSystem.readAsStringAsync as jest.Mock).mockRejectedValue(new Error("read failed"));
  const ImportScreen = getImportScreen();

  await render(<ImportScreen />);
  fireEvent.press(screen.getByText("Choose file"));

  await waitFor(() =>
    expect(
      screen.getByText("Couldn't import that file. Make sure it's a CSV exported from Chrome or Firefox.")
    ).toBeTruthy()
  );
});
