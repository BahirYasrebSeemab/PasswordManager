import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { exportVaultToCsv } from "./exportVault";

jest.mock("expo-file-system/legacy", () => ({
  cacheDirectory: "file:///cache/",
  writeAsStringAsync: jest.fn(),
  deleteAsync: jest.fn(),
  EncodingType: { UTF8: "utf8" },
}));
jest.mock("expo-sharing", () => ({
  shareAsync: jest.fn(),
}));

beforeEach(() => {
  jest.clearAllMocks();
});

test("writes a CSV file to the cache directory and shares it", async () => {
  await exportVaultToCsv([{ title: "GitHub", password: "hunter2" }]);

  expect(FileSystem.writeAsStringAsync).toHaveBeenCalledWith(
    "file:///cache/vault-export.csv",
    expect.stringContaining("GitHub"),
    expect.anything()
  );
  expect(Sharing.shareAsync).toHaveBeenCalledWith("file:///cache/vault-export.csv", expect.anything());
});

test("deletes the temp file after sharing succeeds", async () => {
  await exportVaultToCsv([{ title: "GitHub", password: "hunter2" }]);

  expect(FileSystem.deleteAsync).toHaveBeenCalledWith("file:///cache/vault-export.csv", { idempotent: true });
});

test("deletes the temp file even when sharing fails", async () => {
  (Sharing.shareAsync as jest.Mock).mockRejectedValueOnce(new Error("share failed"));

  await expect(exportVaultToCsv([{ title: "GitHub", password: "hunter2" }])).rejects.toThrow("share failed");

  expect(FileSystem.deleteAsync).toHaveBeenCalledWith("file:///cache/vault-export.csv", { idempotent: true });
});
