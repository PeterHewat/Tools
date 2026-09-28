/**
 * A JSON parser that keeps positions and the source text of every value.
 *
 * `JSON.parse` returns plain values, which loses what this tool needs: where each value sits
 * (for the cursor path, the CSV view's line numbers and the error), and the exact text of numbers and
 * strings (so formatting never rounds a 64-bit ID or rewrites `1.0` as `1`).
 *
 * It is lenient on purpose. Comments, trailing commas, single quotes, unquoted keys, `NaN`,
 * hex numbers and Python's `True` / `None` all parse, and each one is recorded as an {@link Edit}
 * that would make the text strict JSON. No edits means the text was strict JSON already; some
 * edits means it is "almost JSON", and applying them repairs it in place.
 *
 * The parser is a loop over an explicit stack rather than recursion, so nesting as deep as
 * `JSON.parse` accepts cannot overflow the call stack.
 */

interface Span {
  /** Offset of the first character. */
  start: number;
  /** Offset just past the last character. */
  end: number;
}

export interface ObjectNode extends Span {
  kind: "object";
  members: Member[];
}

export interface ArrayNode extends Span {
  kind: "array";
  items: JsonNode[];
}

export interface ScalarNode extends Span {
  kind: "string" | "number" | "boolean" | "null";
  /** Strict JSON text for the value: the source itself unless an edit rewrites it. */
  raw: string;
}

export type JsonNode = ObjectNode | ArrayNode | ScalarNode;

export interface Member {
  /** The key, decoded. */
  key: string;
  /** Strict JSON text for the key, quotes included. */
  keyRaw: string;
  keyStart: number;
  value: JsonNode;
}

export type RepairKind =
  | "comment"
  | "trailing comma"
  | "single quotes"
  | "unquoted key"
  | "string escape"
  | "number"
  | "NaN or Infinity"
  | "literal"
  | "whitespace";

/** Replace `start`..`end` with `text` to move one step closer to strict JSON. */
export interface Edit extends Span {
  text: string;
  kind: RepairKind;
}

export interface Duplicate {
  key: string;
  /** Where the repeated key starts. */
  offset: number;
}

export type ParseResult =
  | {
      ok: true;
      root: JsonNode;
      /** Empty for strict JSON. */
      edits: Edit[];
      duplicates: Duplicate[];
      /** Every value, containers included. */
      values: number;
      /** Levels of nesting: 0 for a bare scalar. */
      depth: number;
    }
  | { ok: false; message: string; offset: number };

class Stop {
  constructor(
    readonly message: string,
    readonly offset: number
  ) {}
}

type Frame =
  { node: ObjectNode; key: Omit<Member, "value"> | null; keys: Set<string> } | { node: ArrayNode };

const STRICT_NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;
const LOOSE_NUMBER =
  /[+-]?(?:0[xX][0-9a-fA-F]+|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?|Infinity|NaN)/y;
const IDENTIFIER = /[A-Za-z_$][\w$]*/y;
const SIMPLE_ESCAPES: Record<string, string> = {
  '"': '"',
  "\\": "\\",
  "/": "/",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
};
/** Escapes JSON5 and JavaScript accept but JSON does not. */
const LOOSE_ESCAPES: Record<string, string> = { "'": "'", v: "\v", "0": "\0" };

export function parse(text: string): ParseResult {
  let i = 0;
  let values = 0;
  let depth = 0;
  let root: JsonNode | undefined;
  let lastComma = -1;
  const edits: Edit[] = [];
  const duplicates: Duplicate[] = [];
  const stack: Frame[] = [];

  const describe = (at: number) => (at >= text.length ? "end of input" : `"${text[at]}"`);
  const fail = (what: string, at = i): never => {
    throw new Stop(`Expected ${what} but found ${describe(at)}`, at);
  };
  const edit = (start: number, end: number, replacement: string, kind: RepairKind) => {
    edits.push({ start, end, text: replacement, kind });
  };

  /**
   * Removes a comment tidily, so a Fix leaves no blank lines or stray spaces: one alone on its
   * line takes the line with it, one after code takes the spaces before it, and one before
   * code takes the spaces after it (keeping the line's indentation).
   */
  const comment = (start: number, end: number) => {
    const lineStart = text.lastIndexOf("\n", start - 1) + 1;
    const lineEnd = text.indexOf("\n", end);
    const before = text.slice(lineStart, start);
    const after = text.slice(end, lineEnd < 0 ? text.length : lineEnd);
    const lastEnd = edits.at(-1)?.end ?? 0;
    if (!/^[ \t]*$/.test(before)) {
      const spaces = /[ \t]*$/.exec(before)![0].length;
      edit(Math.max(start - spaces, lastEnd), end, "", "comment");
    } else if (/^[ \t\r]*$/.test(after) && lineEnd >= 0 && lastEnd <= lineStart) {
      edit(lineStart, lineEnd + 1, "", "comment");
    } else {
      edit(start, end + /^[ \t]*/.exec(after)![0].length, "", "comment");
    }
  };

  /** Whitespace and comments. Comments and non-JSON spaces become edits. */
  const space = () => {
    while (i < text.length) {
      const c = text[i];
      if (c === " " || c === "\n" || c === "\t" || c === "\r") {
        i++;
      } else if (c === "/" && text[i + 1] === "/") {
        const newline = text.indexOf("\n", i);
        const end = newline < 0 ? text.length : newline;
        comment(i, end);
        i = end;
      } else if (c === "/" && text[i + 1] === "*") {
        const close = text.indexOf("*/", i + 2);
        if (close < 0) throw new Stop("Unterminated comment", i);
        comment(i, close + 2);
        i = close + 2;
      } else if (c === "﻿" || c === " " || c === " " || c === " ") {
        edit(i, i + 1, c === "﻿" ? "" : " ", "whitespace");
        i++;
      } else {
        return;
      }
    }
  };

  /** A quoted string at `i`. Returns the decoded value and strict JSON text for it. */
  const string = (): { value: string; raw: string } => {
    const start = i;
    const quote = text[i];
    let value = "";
    let from = ++i;
    let loose = quote === "'";
    while (i < text.length) {
      const c = text[i];
      if (c === quote) {
        value += text.slice(from, i);
        i++;
        const raw = loose ? JSON.stringify(value) : text.slice(start, i);
        if (loose) edit(start, i, raw, quote === "'" ? "single quotes" : "string escape");
        return { value, raw };
      }
      if (c === "\\") {
        value += text.slice(from, i);
        const e = text[i + 1];
        if (e === undefined) break;
        if (e in SIMPLE_ESCAPES) {
          value += SIMPLE_ESCAPES[e];
          i += 2;
        } else if (e === "u") {
          const hex = text.slice(i + 2, i + 6);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
            throw new Stop("Invalid \\u escape: needs four hex digits", i);
          }
          value += String.fromCharCode(parseInt(hex, 16));
          i += 6;
        } else if (e === "x" && /^[0-9a-fA-F]{2}$/.test(text.slice(i + 2, i + 4))) {
          value += String.fromCharCode(parseInt(text.slice(i + 2, i + 4), 16));
          loose = true;
          i += 4;
        } else if (e === "\n" || e === "\r") {
          // A line continuation: the escaped line break is not part of the value.
          loose = true;
          i += e === "\r" && text[i + 2] === "\n" ? 3 : 2;
        } else if (e in LOOSE_ESCAPES && !(e === "0" && /\d/.test(text[i + 2] ?? ""))) {
          value += LOOSE_ESCAPES[e];
          loose = true;
          i += 2;
        } else {
          throw new Stop(`Invalid escape "\\${e}"`, i);
        }
        from = i;
        continue;
      }
      if (c === "\n" || c === "\r") throw new Stop("Unterminated string", i);
      if (c < " ") loose = true; // a raw tab or control character: escape it
      i++;
    }
    throw new Stop("Unterminated string", text.length);
  };

  const key = (frame: Extract<Frame, { keys: Set<string> }>) => {
    const start = i;
    const c = text[i];
    let decoded: { value: string; raw: string };
    if (c === '"' || c === "'") {
      decoded = string();
    } else {
      IDENTIFIER.lastIndex = i;
      const m = IDENTIFIER.exec(text);
      if (!m) fail("a double-quoted key");
      const raw = JSON.stringify(m![0]);
      edit(i, i + m![0].length, raw, "unquoted key");
      i += m![0].length;
      decoded = { value: m![0], raw };
    }
    if (frame.keys.has(decoded.value)) duplicates.push({ key: decoded.value, offset: start });
    frame.keys.add(decoded.value);
    space();
    if (text[i] !== ":") fail('":"');
    i++;
    frame.key = { key: decoded.value, keyRaw: decoded.raw, keyStart: start };
  };

  const number = (): ScalarNode => {
    const start = i;
    LOOSE_NUMBER.lastIndex = i;
    const m = LOOSE_NUMBER.exec(text);
    if (!m) fail("a value");
    const source = m![0];
    i += source.length;
    if (STRICT_NUMBER.test(source)) return { kind: "number", start, end: i, raw: source };
    if (/NaN|Infinity/.test(source)) {
      edit(start, i, "null", "NaN or Infinity");
      return { kind: "null", start, end: i, raw: "null" };
    }
    const raw = strictNumber(source);
    edit(start, i, raw, "number");
    return { kind: "number", start, end: i, raw };
  };

  const word = (): ScalarNode => {
    const start = i;
    IDENTIFIER.lastIndex = i;
    const m = IDENTIFIER.exec(text);
    const w = m?.[0] ?? "";
    const strict: Record<string, ScalarNode["kind"]> = {
      true: "boolean",
      false: "boolean",
      null: "null",
    };
    const loose: Record<string, [string, RepairKind]> = {
      True: ["true", "literal"],
      False: ["false", "literal"],
      None: ["null", "literal"],
      undefined: ["null", "literal"],
      NaN: ["null", "NaN or Infinity"],
      Infinity: ["null", "NaN or Infinity"],
    };
    if (w in strict) {
      i += w.length;
      return { kind: strict[w], start, end: i, raw: w };
    }
    if (w in loose) {
      const [raw, kind] = loose[w];
      i += w.length;
      edit(start, i, raw, kind);
      return { kind: raw === "null" ? "null" : "boolean", start, end: i, raw };
    }
    if (w) throw new Stop(`Unknown word "${w.slice(0, 20)}": strings need double quotes`, start);
    return fail("a value");
  };

  const attach = (node: JsonNode) => {
    values++;
    const top = stack.at(-1);
    if (!top) root = node;
    else if ("items" in top.node) top.node.items.push(node);
    else {
      const frame = top as Extract<Frame, { keys: Set<string> }>;
      frame.node.members.push({ ...frame.key!, value: node });
      frame.key = null;
    }
  };

  const close = () => {
    const frame = stack.pop()!;
    frame.node.end = ++i;
  };

  try {
    let expectValue = true;
    for (;;) {
      space();
      const top = stack.at(-1);
      const c = text[i];

      if (!expectValue) {
        if (!top) {
          if (i < text.length) fail("end of input");
          break;
        }
        const isObject = top.node.kind === "object";
        if (c === ",") {
          lastComma = i++;
          expectValue = true;
        } else if (c === (isObject ? "}" : "]")) {
          close();
        } else {
          fail(isObject ? '"," or "}"' : '"," or "]"');
        }
        continue;
      }

      // Expecting a value, or a key first when inside an object.
      if (top && "keys" in top && !top.key) {
        if (c === "}") {
          if (top.node.members.length) edit(lastComma, lastComma + 1, "", "trailing comma");
          close();
          expectValue = false;
        } else {
          key(top);
        }
        continue;
      }
      if (top && top.node.kind === "array" && c === "]") {
        if (top.node.items.length) edit(lastComma, lastComma + 1, "", "trailing comma");
        close();
        expectValue = false;
        continue;
      }

      if (c === "{" || c === "[") {
        const node: ObjectNode | ArrayNode =
          c === "{"
            ? { kind: "object", start: i, end: -1, members: [] }
            : { kind: "array", start: i, end: -1, items: [] };
        attach(node);
        stack.push(node.kind === "object" ? { node, key: null, keys: new Set() } : { node });
        depth = Math.max(depth, stack.length);
        i++;
        continue;
      }
      if (c === '"' || c === "'") {
        const start = i;
        const { raw } = string();
        attach({ kind: "string", start, end: i, raw });
      } else if (c === "-" || c === "+" || c === "." || (c >= "0" && c <= "9")) {
        attach(number());
      } else {
        attach(word());
      }
      expectValue = false;
    }
  } catch (e) {
    if (e instanceof Stop) return { ok: false, message: e.message, offset: e.offset };
    throw e;
  }

  edits.sort((a, b) => a.start - b.start);
  return { ok: true, root: root!, edits, duplicates, values, depth };
}

/** Rewrites a number JSON5 accepts (`+1`, `.5`, `5.`, `0x1F`, `007`) as strict JSON, exactly. */
export function strictNumber(source: string): string {
  const sign = source[0] === "-" ? "-" : "";
  const body = source.replace(/^[+-]/, "");
  if (/^0[xX]/.test(body)) return sign + BigInt(body).toString();
  const m = /^(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(body)!;
  const int = m[1].replace(/^0+(?=\d)/, "") || "0";
  const frac = m[2] ? `.${m[2]}` : "";
  const exp = m[3] !== undefined ? `e${m[3]}` : "";
  return sign + int + frac + exp;
}

/** Applies edits (sorted, not overlapping) to the text they were found in. */
export function applyEdits(text: string, edits: readonly Edit[]): string {
  let out = "";
  let at = 0;
  for (const e of edits) {
    out += text.slice(at, e.start) + e.text;
    at = e.end;
  }
  return out + text.slice(at);
}
