import type { VaultEntryContent } from "@/context/vaultEntry";

export interface CsvRow {
  name: string;
  url: string;
  username: string;
  password: string;
}

export function csvRowToEntry(row: CsvRow): VaultEntryContent {
  const name = unescapeCsvCell(row.name);
  const url = unescapeCsvCell(row.url);
  const username = unescapeCsvCell(row.username);
  const password = unescapeCsvCell(row.password);
  return {
    title: name || url,
    username: username || undefined,
    password,
    url: url || undefined,
  };
}

export function entryToCsvRow(content: VaultEntryContent): CsvRow {
  return {
    name: content.title,
    url: content.url ?? "",
    username: content.username ?? "",
    password: content.password,
  };
}

// A cell value starting with =, +, -, or @ can be interpreted as a formula
// if the exported CSV is later opened in Excel/Sheets ("CSV injection").
// Prefixing with a leading apostrophe is the standard defense — spreadsheet
// apps treat a leading apostrophe as "force text", not part of the value.
export function escapeCsvCell(value: string): string {
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}

// Reverses escapeCsvCell's leading-apostrophe defense on import. Only strips
// the apostrophe when it's immediately followed by one of the four
// formula-trigger characters — an ordinary value that happens to start with
// an apostrophe for some other reason (e.g. "'tis a password") is left
// untouched.
export function unescapeCsvCell(value: string): string {
  return /^'[=+\-@]/.test(value) ? value.slice(1) : value;
}

const CSV_COLUMNS = ["name", "url", "username", "password"] as const;

function quoteCsvField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function rowsToCsv(rows: CsvRow[]): string {
  const header = CSV_COLUMNS.join(",");
  const lines = rows.map((row) => CSV_COLUMNS.map((col) => quoteCsvField(escapeCsvCell(row[col]))).join(","));
  return [header, ...lines].join("\r\n");
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      fields.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
}

export function csvToRows(csv: string): CsvRow[] {
  // Records are split on physical lines only after confirming we're not
  // inside a quoted field — a real Chrome/Firefox CSV export can have a
  // quoted, multi-line `note` column, and splitting blindly on \n would
  // shatter that single logical record into several, misaligning fields.
  const physicalLines = csv.split(/\r\n|\n/);
  const records: string[] = [];
  let buffer = "";
  for (const line of physicalLines) {
    buffer = buffer.length > 0 ? `${buffer}\n${line}` : line;
    const quoteCount = (buffer.match(/"/g) ?? []).length;
    if (quoteCount % 2 === 0) {
      records.push(buffer);
      buffer = "";
    }
    // odd quote count: still inside a quoted multi-line field, keep accumulating
  }
  if (buffer.length > 0) records.push(buffer);

  const nonEmptyRecords = records.filter((record) => record.length > 0);
  if (nonEmptyRecords.length === 0) return [];
  const [headerLine, ...dataLines] = nonEmptyRecords;
  const headers = parseCsvLine(headerLine).map((h) => h.trim().toLowerCase());
  return dataLines.map((line) => {
    const values = parseCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((header, i) => {
      row[header] = values[i] ?? "";
    });
    return {
      name: row.name ?? "",
      url: row.url ?? "",
      username: row.username ?? "",
      password: row.password ?? "",
    };
  });
}
