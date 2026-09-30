/**
 * CSV into JSON: the other way from the CSV view.
 *
 * RFC 4180 as spreadsheets write it — fields in double quotes may hold the separator, line
 * breaks and doubled quotes — with the separator found rather than assumed (comma, semicolon,
 * tab or bar: a European spreadsheet writes semicolons). The first row names the columns; each
 * row after it becomes an object. Cells that read as JSON numbers, true, false or null become
 * those; everything else, empty cells included, stays a string, so nothing is lost.
 */

export type Separator = "," | ";" | "\t" | "|";
const SEPARATORS: readonly Separator[] = [",", ";", "\t", "|"];

/** A JSON number, as written; a leading zero ("007") is not one, and stays text. */
const NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

/** The separator of the first line: the candidate it holds most of, outside quotes. */
export function detectSeparator(text: string): Separator {
  const counts = new Map<Separator, number>(SEPARATORS.map((s) => [s, 0]));
  let quoted = false;
  for (const ch of text) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && (ch === "\n" || ch === "\r")) break;
    else if (!quoted && counts.has(ch as Separator)) {
      counts.set(ch as Separator, counts.get(ch as Separator)! + 1);
    }
  }
  let best: Separator = ",";
  for (const s of SEPARATORS) if (counts.get(s)! > counts.get(best)!) best = s;
  return best;
}

/** The rows of a CSV text, each a list of fields. A last empty line is not a row. */
export function parseCsv(text: string, sep: Separator = detectSeparator(text)): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let k = text.charCodeAt(0) === 0xfeff ? 1 : 0; // a byte-order mark is not part of the header
  const endRow = () => {
    row.push(field);
    rows.push(row);
    row = [];
    field = "";
  };
  for (; k < text.length; k++) {
    const ch = text[k];
    if (quoted) {
      if (ch !== '"') field += ch;
      else if (text[k + 1] === '"') {
        field += '"';
        k++;
      } else quoted = false;
    } else if (ch === '"' && field === "") quoted = true;
    else if (ch === sep) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[k + 1] === "\n") k++;
      endRow();
    } else field += ch;
  }
  if (field !== "" || row.length) endRow();
  return rows;
}

/** One cell as JSON: a number, true, false or null as written, else a string. */
function cellJson(cell: string): string {
  if (NUMBER.test(cell) || cell === "true" || cell === "false" || cell === "null") return cell;
  return JSON.stringify(cell);
}

/** Column names from the header: blanks named by position, repeats numbered. */
export function columnNames(header: readonly string[], width: number): string[] {
  const seen = new Map<string, number>();
  const names: string[] = [];
  for (let c = 0; c < width; c++) {
    const base = header[c]?.trim() || `column${c + 1}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    names.push(n === 1 ? base : `${base}_${n}`);
  }
  return names;
}

/**
 * The CSV as the text of a JSON array of objects, one per row, laid out with `indent`; null when
 * it is not a table: one line only, or a single column (then it is just lines of text, and the
 * separator was a guess).
 */
export function csvToJson(text: string, indent: number | "\t" = 2): string | null {
  const separator = detectSeparator(text);
  const rows = parseCsv(text, separator).filter((r) => r.length > 1 || r[0] !== "");
  if (rows.length < 2) return null;
  const width = Math.max(...rows.map((r) => r.length));
  if (width < 2) return null;
  const names = columnNames(rows[0], width);
  const pad = typeof indent === "number" ? " ".repeat(indent) : indent;
  const objects = rows.slice(1).map((r) => {
    const members = names.map((name, c) => `${JSON.stringify(name)}: ${cellJson(r[c] ?? "")}`);
    return `${pad}{ ${members.join(", ")} }`;
  });
  return `[\n${objects.join(",\n")}\n]`;
}

/** Text that looks like a CSV table rather than broken JSON, for offering the conversion. */
export function looksLikeCsv(text: string): boolean {
  const head = text.trimStart()[0];
  if (head === "{" || head === "[") return false;
  return csvToJson(text.slice(0, 20_000)) !== null;
}
