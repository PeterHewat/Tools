/**
 * The CSV view: every array in the document as a table, one after another.
 *
 * The arrays are the ones reached through objects, in document order. An array inside an
 * array is not a table of its own: it is a cell of the outer one, written as JSON, as a
 * spreadsheet would hold it.
 */
import type { JsonNode } from "./ast.js";
import { csvRows } from "./convert.js";
import type { PathSegment } from "./path.js";

export interface Table {
  node: JsonNode & { kind: "array" };
  path: PathSegment[];
}

/** Past this many, the view would be no use: the rest are left out. */
export const MAX_TABLES = 100;

export function tablesIn(root: JsonNode): Table[] {
  const found: Table[] = [];
  const walk = (node: JsonNode, path: PathSegment[]): void => {
    if (found.length >= MAX_TABLES) return;
    if (node.kind === "array") {
      found.push({ node, path });
    } else if (node.kind === "object") {
      for (const m of node.members) walk(m.value, [...path, m.key]);
    }
  };
  walk(root, []);
  return found;
}

export interface CsvSheet {
  /** The tables, each under a `# heading` line when there are several, a blank line between. */
  text: string;
  /** For each line of the text, the document offset its row comes from; -1 for none. */
  sources: number[];
  /** Each table's lines of the text, its heading included. */
  sections: { table: Table; lastLine: number }[];
}

/**
 * The tables one after another. A lone table is plain CSV; several each start with a
 * `# heading` line (not CSV: it names the table), and Copy and Export take one of them.
 */
export function csvSheet(tables: readonly Table[], heading: (t: Table) => string): CsvSheet {
  const rows: string[] = [];
  const sources: number[] = [];
  const sections: CsvSheet["sections"] = [];
  const many = tables.length > 1;
  let line = 0;
  const add = (row: string, source: number) => {
    rows.push(row);
    sources.push(source);
    // A cell with line breaks makes one row several lines; only the first has a source.
    for (const _ of row.matchAll(/\r\n|\n|\r/g)) sources.push(-1);
    line = sources.length;
  };
  for (const table of tables) {
    if (many && rows.length) add("", -1);
    if (many) add(`# ${heading(table)}`, -1);
    csvRows(table.node).forEach((row, k) =>
      add(row, k === 0 ? table.node.start : table.node.items[k - 1].start)
    );
    sections.push({ table, lastLine: line - 1 });
  }
  return { text: rows.length ? rows.join("\r\n") + "\r\n" : "", sources, sections };
}
