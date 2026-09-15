import { csvRowToEntry, entryToCsvRow, escapeCsvCell, unescapeCsvCell, rowsToCsv, csvToRows } from "./csvFormat";

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

test("unescapeCsvCell strips exactly one leading apostrophe before =, +, -, or @", () => {
  expect(unescapeCsvCell("'=cmd")).toBe("=cmd");
  expect(unescapeCsvCell("'+1234")).toBe("+1234");
  expect(unescapeCsvCell("'-5")).toBe("-5");
  expect(unescapeCsvCell("'@mention")).toBe("@mention");
});

test("unescapeCsvCell leaves ordinary values (including a real leading apostrophe elsewhere) untouched", () => {
  expect(unescapeCsvCell("hunter2")).toBe("hunter2");
  expect(unescapeCsvCell("'tis a password")).toBe("'tis a password");
});

test("a password starting with a formula-trigger character survives a full export/import round trip", () => {
  const entry = { title: "Bank", password: "-hunter2" };
  const row = entryToCsvRow(entry);
  const escapedRow = { ...row, password: escapeCsvCell(row.password) };
  const recovered = csvRowToEntry(escapedRow);
  expect(recovered.password).toBe("-hunter2");
});

test("csvToRows correctly handles a record with an embedded newline in an extra (unmapped) column, matching a real Chrome export with a multi-line note", () => {
  const csv =
    'name,url,username,password,note\r\nGitHub,https://github.com,me,hunter2,"line one\nline two"\r\nGmail,https://gmail.com,me,secret,plain note';

  const result = csvToRows(csv);

  expect(result).toHaveLength(2);
  expect(result[0]).toEqual({ name: "GitHub", url: "https://github.com", username: "me", password: "hunter2" });
  expect(result[1]).toEqual({ name: "Gmail", url: "https://gmail.com", username: "me", password: "secret" });
});
