import { parse, REPAIRS, type Edit, type ParseResult } from "./ast.js";
import { createExports } from "./exports.js";
import { positionAt, type TextPosition } from "./lines.js";

export interface Analysis {
  doc: Extract<ParseResult, { ok: true }> | null;
  fault: { message: string; position: TextPosition; edits: Edit[] | null } | null;
  exports: ReturnType<typeof createExports> | null;
}

/** Parse each text revision once; settings and view changes reuse the same analysis. */
export function createAnalysis() {
  let previous: { text: string; value: Analysis } | null = null;
  return {
    read(text: string): Analysis {
      if (previous?.text === text) return previous.value;
      const parsed = text.trim() ? parse(text) : null;
      const doc = parsed?.ok && !parsed.edits.length ? parsed : null;
      let fault: Analysis["fault"] = null;
      if (parsed && !doc) {
        const [message, offset, edits] = parsed.ok
          ? [REPAIRS[parsed.edits[0]!.kind].message, parsed.edits[0]!.start, parsed.edits]
          : [parsed.message, parsed.offset, null];
        fault = { message, position: positionAt(text, offset), edits };
      }
      const value = { doc, fault, exports: doc ? createExports(doc.root, text) : null };
      previous = { text, value };
      return value;
    },
  };
}
