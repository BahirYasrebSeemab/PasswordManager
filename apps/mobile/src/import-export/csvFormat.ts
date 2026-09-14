import type { VaultEntryContent } from "@/context/vaultEntry";

export interface CsvRow {
  name: string;
  url: string;
  username: string;
  password: string;
}

export function csvRowToEntry(row: CsvRow): VaultEntryContent {
  return {
    title: row.name || row.url,
    username: row.username || undefined,
    password: row.password,
    url: row.url || undefined,
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
  const lines = csv.split(/\r\n|\n/).filter((line) => line.length > 0);
  if (lines.length === 0) return [];
  const [headerLine, ...dataLines] = lines;
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
