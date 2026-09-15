import { parseImportCsv, importEntries } from "./importVault";

test("parseImportCsv parses valid rows into VaultEntryContent", () => {
  const csv = "name,url,username,password\r\nGitHub,https://github.com,me,hunter2";
  expect(parseImportCsv(csv)).toEqual([
    { title: "GitHub", url: "https://github.com", username: "me", password: "hunter2" },
  ]);
});

test("parseImportCsv skips rows with an empty password", () => {
  const csv =
    "name,url,username,password\r\nGitHub,https://github.com,me,\r\nGmail,https://gmail.com,me,secret";
  const result = parseImportCsv(csv);
  expect(result).toHaveLength(1);
  expect(result[0].title).toBe("Gmail");
});

test("importEntries calls createEntry once per entry, in order, and returns the count", async () => {
  const createEntry = jest.fn().mockResolvedValue(undefined);
  const entries = [
    { title: "GitHub", password: "hunter2" },
    { title: "Gmail", password: "secret" },
  ];

  const count = await importEntries(entries, createEntry);

  expect(createEntry).toHaveBeenCalledTimes(2);
  expect(createEntry).toHaveBeenNthCalledWith(1, entries[0]);
  expect(createEntry).toHaveBeenNthCalledWith(2, entries[1]);
  expect(count).toBe(2);
});
