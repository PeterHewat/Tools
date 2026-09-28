/**
 * Syntax colours for the converted views, one line at a time, in the same token kinds as the
 * JSON colouring (lib/highlight.ts) so every view shares one palette.
 *
 * They cover what the converters write, and read ordinary hand-written input sensibly, but
 * are colourers, not parsers: a construct they do not know stays uncoloured, never wrong.
 */
import type { Token, TokenKind } from "./highlight.js";

type Rule = [RegExp, TokenKind | ((match: string, rest: string) => TokenKind)];

/** Runs sticky rules over a line; unmatched characters fall through as plain text. */
function lex(line: string, rules: readonly Rule[]): Token[] {
  const tokens: Token[] = [];
  const push = (kind: TokenKind, text: string) => {
    const last = tokens.at(-1);
    if (last && last.kind === kind && kind === "plain") last.text += text;
    else tokens.push({ kind, text });
  };
  let i = 0;
  outer: while (i < line.length) {
    for (const [re, kind] of rules) {
      re.lastIndex = i;
      const m = re.exec(line);
      if (m && m[0]) {
        push(typeof kind === "function" ? kind(m[0], line.slice(i + m[0].length)) : kind, m[0]);
        i += m[0].length;
        continue outer;
      }
    }
    push("plain", line[i]);
    i++;
  }
  return tokens;
}

// ---------- YAML ----------

const YAML_KEY = /(?:"(?:[^"\\]|\\.)*"|'[^']*'|[^\s:#"'\-{}[\],][^:#]*?)(?=:(?:\s|$))/y;
const YAML_SCALAR: Rule[] = [
  [/#.*/y, "comment"],
  [/"(?:[^"\\]|\\.)*"?|'[^']*'?/y, "string"],
  [/(?:true|false|null|~)(?=\s*(?:#|$))/iy, "literal"],
  [/[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?(?=\s*(?:#|$))/y, "number"],
  [/[{}[\],]/y, "punct"],
  [/[^#\s][^#]*?(?=\s*(?:#|$))/y, "string"],
];

/** Indent and "- " markers, then a key and its ":", then a scalar or a comment. */
export function lexYaml(line: string): Token[] {
  const head = /^(\s*(?:-\s+)*)/.exec(line)![0];
  const tokens: Token[] = [];
  if (head) {
    for (const part of head.split(/(-)/)) {
      if (part) tokens.push({ kind: part === "-" ? "punct" : "plain", text: part });
    }
  }
  let rest = line.slice(head.length);
  YAML_KEY.lastIndex = 0;
  const key = YAML_KEY.exec(rest);
  if (key) {
    tokens.push({ kind: "key", text: key[0] }, { kind: "punct", text: ":" });
    rest = rest.slice(key[0].length + 1);
  }
  return tokens.concat(lex(rest, [[/\s+/y, "plain"], ...YAML_SCALAR]));
}

// ---------- CSV ----------

/** Column colours, cycled: each column keeps one colour, so a row reads across at a glance. */
const COLUMN_KINDS: readonly TokenKind[] = ["key", "string", "number", "literal"];

/** The CSV view's lines: a table's `# name` heading when it shows several, else CSV. */
export function lexCsvSheet(line: string): Token[] {
  return line.startsWith("# ") ? [{ kind: "comment", text: line }] : lexCsv(line);
}

/** Fields coloured by column, commas muted; quoted fields keep their quotes. */
export function lexCsv(line: string): Token[] {
  const tokens: Token[] = [];
  let column = 0;
  let i = 0;
  while (i <= line.length) {
    let end: number;
    if (line[i] === '"') {
      end = i + 1;
      for (;;) {
        const q = line.indexOf('"', end);
        if (q < 0) {
          end = line.length;
          break;
        }
        if (line[q + 1] === '"') end = q + 2;
        else {
          end = q + 1;
          break;
        }
      }
      const comma = line.indexOf(",", end);
      end = comma < 0 ? line.length : comma;
    } else {
      const comma = line.indexOf(",", i);
      end = comma < 0 ? line.length : comma;
    }
    if (end > i) {
      tokens.push({ kind: COLUMN_KINDS[column % COLUMN_KINDS.length], text: line.slice(i, end) });
    }
    if (end >= line.length) break;
    tokens.push({ kind: "punct", text: "," });
    column++;
    i = end + 1;
  }
  return tokens;
}

// ---------- TypeScript ----------

const TS_KEYWORDS = /(?:export|interface|type|extends|readonly)\b/y;
/** A name followed by `:` or `?:` is a property; any other name is a type. */
const propertyOr = (other: TokenKind) => (_: string, rest: string) =>
  /^\??:/.test(rest) ? "key" : other;

export function lexTypeScript(line: string): Token[] {
  return lex(line, [
    [/\s+/y, "plain"],
    [/\/\/.*/y, "comment"],
    [TS_KEYWORDS, "literal"],
    [/"(?:[^"\\]|\\.)*"?/y, propertyOr("string")],
    [/[A-Za-z_$][\w$]*/y, propertyOr("type")],
    [/[{}()[\];:|?=<>,.&]/y, "punct"],
  ]);
}
