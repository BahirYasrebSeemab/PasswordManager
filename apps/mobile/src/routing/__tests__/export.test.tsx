import { render, screen, fireEvent, waitFor } from "@testing-library/react-native";
import { useVault } from "@/context/VaultContext";
import { exportVaultToCsv } from "@/import-export/exportVault";

// See delete-account.test.tsx for why: every screen now renders through
// Spotlight (gradient + safe-area-inset logic), so the first render's
// deferred require() pays a one-time cold-transform cost that can exceed
// Jest's default 5000ms budget on its own.
jest.setTimeout(15000);

jest.mock("@/context/VaultContext");
jest.mock("@/import-export/exportVault");

function getExportScreen() {
  return require("../../../app/(app)/settings/export").default;
}

beforeEach(() => {
  jest.clearAllMocks();
  (useVault as jest.Mock).mockReturnValue({
    entries: [{ id: "1", content: { title: "GitHub", password: "hunter2" }, syncStatus: "synced" }],
  });
});

test("tapping Export calls exportVaultToCsv with the decrypted entry contents", async () => {
  (exportVaultToCsv as jest.Mock).mockResolvedValue(undefined);
  const ExportScreen = getExportScreen();

  await render(<ExportScreen />);
  fireEvent.press(screen.getByText("Export"));

  await waitFor(() => expect(exportVaultToCsv).toHaveBeenCalledWith([{ title: "GitHub", password: "hunter2" }]));
});

test("shows an error message when export fails", async () => {
  (exportVaultToCsv as jest.Mock).mockRejectedValue(new Error("fail"));
  const ExportScreen = getExportScreen();

  await render(<ExportScreen />);
  fireEvent.press(screen.getByText("Export"));

  await waitFor(() => expect(screen.getByText("Couldn't export your vault. Please try again.")).toBeTruthy());
});
