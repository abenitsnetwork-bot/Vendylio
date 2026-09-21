// Minimal RFC4180-ish CSV parsing/serialization — isomorphic (no Node-only
// APIs), used by the client (reads the picked file's text) and the product
// bulk-import route (the authoritative parse). No dependency added: the
// project already hand-rolls CSV serialization for report exports
// (lib/server/reports/csv.ts) — this mirrors that convention for the read
// side, which needs actual quote/escape handling, not just emission.

/**
 * Parses CSV text into rows of raw string cells. Handles quoted fields,
 * `""` as an escaped quote inside a quoted field, commas/newlines embedded
 * in quoted fields, and both `\r\n` and `\n` line endings. Blank lines are
 * dropped. No header handling or type coercion — see `csvRowsToObjects`.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const len = text.length;

  function pushField() {
    row.push(field);
    field = '';
  }
  function pushRow() {
    pushField();
    rows.push(row);
    row = [];
  }

  while (i < len) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ',') {
      pushField();
      i += 1;
      continue;
    }
    if (ch === '\r') {
      i += 1;
      continue;
    }
    if (ch === '\n') {
      pushRow();
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }
  if (field.length > 0 || row.length > 0) pushRow();

  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

/**
 * First row = headers (trimmed, used as-is — callers normalize/alias them).
 * Each subsequent row becomes `{ [header]: cell }`; a short row fills
 * missing trailing cells with `''`, an over-long row ignores the extras.
 */
export function csvRowsToObjects(rows: string[][]): Record<string, string>[] {
  const [header, ...dataRows] = rows;
  if (!header) return [];
  const headers = header.map((h) => h.trim());
  return dataRows.map((row) =>
    Object.fromEntries(headers.map((h, i) => [h, (row[i] ?? '').trim()])),
  );
}

function escapeCsvCell(v: string): string {
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** Builds CSV text from a header row + data rows — used for the downloadable import template. */
export function buildCsv(headers: string[], rows: string[][]): string {
  const lines = [headers, ...rows].map((r) => r.map(escapeCsvCell).join(','));
  return lines.join('\r\n');
}
