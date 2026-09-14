import { csvRowToEntry, entryToCsvRow, escapeCsvCell, rowsToCsv, csvToRows } from "./csvFormat";

test("csvRowToEntry maps name/url/username/password to a VaultEntryContent", () => {
  const entry = csvRowToEntry({ name: "GitHub", url: "https://github.com", username: "me", password: "hunter2" });
  expect(entry).toEqual({ title: "GitHub", username: "me", password: "hunter2", url: "https://github.com" });
});

test("csvRowToEntry falls back to url as the title when name is empty", () => {
  const entry = csvRowToEntry({ name: "", url: "https://github.com", username: "", password: "hunter2" });
  expect(entry.title).toBe("https://github.com");
  expect(entry.username).toBeUndefined();
});

test("entryToCsvRow maps a VaultEntryContent back to CSV row shape", () => {
  const row = entryToCsvRow({ title: "GitHub", username: "me", password: "hunter2", url: "https://github.com" });
  expect(row).toEqual({ name: "GitHub", url: "https://github.com", username: "me", password: "hunter2" });
});

test("entryToCsvRow uses empty strings for missing optional fields", () => {
  const row = entryToCsvRow({ title: "GitHub", password: "hunter2" });
  expect(row.url).toBe("");
  expect(row.username).toBe("");
});

test("escapeCsvCell prefixes values starting with =, +, -, or @ with an apostrophe", () => {
  expect(escapeCsvCell("=cmd")).toBe("'=cmd");
  expect(escapeCsvCell("+1234")).toBe("'+1234");
  expect(escapeCsvCell("-5")).toBe("'-5");
  expect(escapeCsvCell("@mention")).toBe("'@mention");
});

test("escapeCsvCell leaves ordinary values untouched", () => {
  expect(escapeCsvCell("hunter2")).toBe("hunter2");
});

test("rowsToCsv then csvToRows round-trips rows, including a comma and a quote in a field", () => {
  const rows = [
    { name: "GitHub", url: "https://github.com", username: "me", password: "hunter2" },
    { name: "Work, Inc.", url: "https://work.example", username: 'user"name', password: "p@ss" },
  ];

  const csv = rowsToCsv(rows);
  const parsed = csvToRows(csv);

  expect(parsed).toEqual(rows);
});

test("csvToRows parses a header-only CSV as an empty array", () => {
  expect(csvToRows("name,url,username,password")).toEqual([]);
});
