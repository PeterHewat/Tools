import type { JsonNode } from "./ast.js";
import {
  exactCandidates,
  inferShape,
  toJsonSchema,
  toTypeScript,
  toYaml,
  type Converted,
  type ExactCandidate,
  type Shape,
} from "./convert.js";
import { lineOf, lineStarts } from "./lines.js";
import { jsPath, jsonPointer } from "./path.js";
import { csvSheet, tablesIn, type CsvSheet } from "./tables.js";

export type ExportKind = "yaml" | "csv" | "ts" | "schema";

export interface ExportOptions {
  exact: ReadonlySet<string>;
  pathStyle: "js" | "pointer";
}

export interface ExportResult {
  result: Converted;
  candidates: ExactCandidate[];
  sheet: CsvSheet | null;
  lineLabels: (number | null)[] | null;
}

function makeCsv(root: JsonNode, source: string, style: ExportOptions["pathStyle"]): ExportResult {
  const tables = tablesIn(root);
  const sheet = tables.length
    ? csvSheet(tables, (table) => {
        const path = table.path.length
          ? style === "pointer"
            ? jsonPointer(table.path)
            : jsPath(table.path)
          : "(root)";
        const count = table.node.items.length;
        return `${path} · ${count.toLocaleString()} row${count === 1 ? "" : "s"}`;
      })
    : null;
  const starts = source.includes("\n") ? lineStarts(source) : null;
  return {
    result: sheet
      ? { ok: true, text: sheet.text }
      : { ok: false, message: "No arrays here: CSV makes a table of a list." },
    candidates: [],
    sheet,
    lineLabels:
      sheet && starts
        ? sheet.sources.map((offset) => (offset < 0 ? null : lineOf(starts, offset)))
        : null,
  };
}

/** One document revision owns its conversions and one lazily inferred shape. */
export function createExports(root: JsonNode, source: string) {
  let shape: Shape | null = null;
  let candidates: ExactCandidate[] | null = null;
  const cached = new Map<ExportKind, { key: string; value: ExportResult }>();
  return {
    convert(kind: ExportKind, options: ExportOptions): ExportResult {
      const key =
        kind === "csv"
          ? options.pathStyle
          : kind === "yaml"
            ? ""
            : JSON.stringify([...options.exact].sort());
      const previous = cached.get(kind);
      if (previous?.key === key) return previous.value;
      let value: ExportResult;
      try {
        if (kind === "csv") value = makeCsv(root, source, options.pathStyle);
        else {
          let text: string;
          if (kind === "yaml") text = toYaml(root);
          else {
            shape ??= inferShape(root);
            candidates ??= exactCandidates(shape);
            text = kind === "ts" ? toTypeScript(shape, options) : toJsonSchema(shape, options);
          }
          value = {
            result: { ok: true, text },
            candidates: kind === "yaml" ? [] : candidates!,
            sheet: null,
            lineLabels: null,
          };
        }
      } catch (err) {
        value = {
          result: {
            ok: false,
            message: err instanceof RangeError ? "Too deeply nested to convert." : String(err),
          },
          candidates: [],
          sheet: null,
          lineLabels: null,
        };
      }
      cached.set(kind, { key, value });
      return value;
    },
  };
}
