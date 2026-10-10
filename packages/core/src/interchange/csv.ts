/**
 * CSV building (spec §4.5.1) and parsing for the CSV importers (§4.5.2). The writer quotes
 * conservatively (RFC 4180) and the parser sniffs the delimiter, because a spreadsheet saved on
 * a German or Ukrainian desktop uses `;` and a pasted one uses tabs.
 */

export interface CsvTable {
  /** File name inside the export, e.g. `characters.csv`. */
  fileName: string;
  columns: string[];
  rows: Array<Array<string | number | null>>;
}

const NEEDS_QUOTES = /[",;\t\r\n]/;

export function csvValue(value: string | number | null): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return NEEDS_QUOTES.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** One CSV file: header row + rows, `\n` line endings, trailing newline. */
export function toCsv(columns: readonly string[], rows: ReadonlyArray<readonly unknown[]>): string {
  const lines = [columns.map((column) => csvValue(column)).join(",")];
  for (const row of rows) {
    lines.push(
      row
        .map((value) =>
          csvValue(
            value === null || value === undefined
              ? null
              : typeof value === "number" || typeof value === "string"
                ? value
                : JSON.stringify(value),
          ),
        )
        .join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}

export interface ParsedCsv {
  delimiter: string;
  header: string[];
  rows: string[][];
}

/** Detects `,` / `;` / tab from the first line outside quotes, then parses the whole document. */
export function parseCsv(text: string): ParsedCsv {
  const firstLine = text.slice(0, text.indexOf("\n") === -1 ? text.length : text.indexOf("\n"));
  const counts: Array<[string, number]> = [
    [",", (firstLine.match(/,/g) ?? []).length],
    [";", (firstLine.match(/;/g) ?? []).length],
    ["\t", (firstLine.match(/\t/g) ?? []).length],
  ];
  counts.sort((a, b) => b[1] - a[1]);
  const delimiter = counts[0] !== undefined && counts[0][1] > 0 ? counts[0][0] : ",";

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    // Ignore a trailing empty line rather than emitting a row of one empty field.
    if (row.length > 1 || (row[0] ?? "").trim().length > 0) rows.push(row);
    row = [];
  };
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] as string;
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === delimiter) {
      pushField();
    } else if (char === "\n") {
      pushField();
      pushRow();
    } else if (char === "\r") {
      // Swallow: a CRLF file must parse the same as LF.
    } else {
      field += char;
    }
  }
  if (field.length > 0 || row.length > 0) {
    pushField();
    pushRow();
  }
  const header = rows.shift() ?? [];
  return { delimiter, header, rows };
}

/** Lower-cased header lookup so `POV`, `pov` and `Pov ` all find the same column. */
export function columnIndex(header: readonly string[], names: readonly string[]): number {
  for (let index = 0; index < header.length; index += 1) {
    const value = (header[index] ?? "").trim().toLowerCase();
    if (names.includes(value)) return index;
  }
  return -1;
}

export function cell(row: readonly string[], index: number): string {
  if (index < 0) return "";
  return (row[index] ?? "").trim();
}
