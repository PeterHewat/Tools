/**
 * Syntax colours for one line of JSON at a time.
 *
 * JSON strings cannot span lines, so a line can be coloured without the rest of the document,
 * and the editor only ever colours the lines on screen. The one thing a line cannot know is
 * whether it starts inside a multi-line block comment (almost-JSON only); such a line shows
 * uncoloured until it is fixed.
 */

export type TokenKind = "key" | "string" | "number" | "literal" | "comment" | "punct" | "plain";

export interface Token {
  kind: TokenKind;
  text: string;
}

const TOKEN = new RegExp(
  [
    /(\s+)/, // 1 space
    /("(?:[^"\\]|\\.)*"?|'(?:[^'\\]|\\.)*'?)/, // 2 string, possibly unterminated
    /(\/\/.*|\/\*.*?(?:\*\/|$))/, // 3 comment
    /([+-]?(?:0[xX][0-9a-fA-F]+|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?))/, // 4 number
    /((?:true|false|null|True|False|None|NaN|-?Infinity|undefined)(?![\w$]))/, // 5 literal
    /([A-Za-z_$][\w$]*)/, // 6 bare word: an unquoted key, or a mistake
    /([{}[\],:])/, // 7 punctuation
    /(.)/, // 8 anything else
  ]
    .map((r) => r.source)
    .join("|"),
  "gy"
);

/** Sticky: tested at the end of a token, to tell a key from a value. */
const KEY_AFTER = /\s*:/y;

export function highlightLine(line: string): Token[] {
  const tokens: Token[] = [];
  const push = (kind: TokenKind, text: string) => {
    const last = tokens.at(-1);
    if (last && last.kind === kind && kind === "plain") last.text += text;
    else tokens.push({ kind, text });
  };
  TOKEN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN.exec(line))) {
    const text = m[0];
    // Looks ahead in place: slicing the rest of the line per token is quadratic on long lines.
    const isKey = () => ((KEY_AFTER.lastIndex = TOKEN.lastIndex), KEY_AFTER.test(line));
    if (m[2] !== undefined) push(isKey() ? "key" : "string", text);
    else if (m[3] !== undefined) push("comment", text);
    else if (m[4] !== undefined) push("number", text);
    else if (m[5] !== undefined) push(isKey() ? "key" : "literal", text);
    else if (m[6] !== undefined) push(isKey() ? "key" : "plain", text);
    else if (m[7] !== undefined) push("punct", text);
    else push("plain", text);
  }
  return tokens;
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

/**
 * The line as HTML, one `<span class="t-…">` per coloured token.
 *
 * Only tokens overlapping characters `from`..`to` are coloured: the text before them stays
 * plain, and the text after them is left out. A very long line (a minified document, an
 * embedded image) then costs only its visible stretch, with the plain prefix keeping that
 * stretch at its true position. Pass `tokens` to reuse a line's tokens between calls.
 */
export function highlightHtml(
  line: string,
  from = 0,
  to = Infinity,
  tokens: readonly Token[] = highlightLine(line)
): string {
  let html = "";
  let at = 0;
  let started = false;
  for (const t of tokens) {
    const end = at + t.text.length;
    if (end > from || (!started && end === line.length)) {
      if (!started) {
        html = escapeHtml(line.slice(0, at));
        started = true;
      }
      if (at >= to) break;
      html +=
        t.kind === "plain"
          ? escapeHtml(t.text)
          : `<span class="t-${t.kind}">${escapeHtml(t.text)}</span>`;
    }
    at = end;
  }
  return html;
}
