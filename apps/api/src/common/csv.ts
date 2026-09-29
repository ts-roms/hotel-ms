/** RFC 4180 field; also defuses spreadsheet formula injection (=, +, -, @ at the start). */
export function csvField(value: string | number | null): string {
  if (value === null) return '';
  let text = String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** A CSV document: a header row and data rows, CRLF line ends (RFC 4180). */
export function toCsv(header: string[], rows: (string | number | null)[][]): string {
  return [header, ...rows].map((r) => r.map((v) => csvField(v)).join(',')).join('\r\n') + '\r\n';
}

/**
 * Parses RFC 4180 CSV (ADR-0030): quoted fields with embedded commas, quotes ("") and line
 * breaks; CRLF or LF; a leading UTF-8 byte-order mark (Excel) is ignored. Returns rows of
 * fields; blank lines are dropped. Throws on an unterminated quote.
 */
export function parseCsv(text: string): string[][] {
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let i = 0;
  const endRow = () => {
    row.push(field);
    if (row.length > 1 || row[0] !== '') rows.push(row);
    row = [];
    field = '';
  };
  while (i < input.length) {
    const c = input[i]!;
    if (quoted) {
      if (c === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
      } else {
        field += c;
      }
      i++;
      continue;
    }
    if (c === '"' && field === '') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      endRow();
      if (c === '\r' && input[i + 1] === '\n') i++;
    } else field += c;
    i++;
  }
  if (quoted) throw new Error('Unterminated quoted field');
  if (field !== '' || row.length > 0) endRow();
  return rows;
}
