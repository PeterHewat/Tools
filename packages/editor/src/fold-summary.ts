/**
 * What a folded stretch holds, shown in its placeholder: "3 keys" for a JSON object, "12 items"
 * for an array, "4 elements" for an XML element. Empty when there is nothing useful to say.
 */
import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";

const count = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;

/** Named children that are not punctuation or parse errors. */
function children(node: SyntaxNode, names?: ReadonlySet<string>): number {
  let n = 0;
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.type.isError) continue;
    if (names ? names.has(child.name) : /^\w/.test(child.name)) n++;
  }
  return n;
}

const PROPERTY = new Set(["Property"]);
const ELEMENT = new Set(["Element"]);

export function foldSummary(state: EditorState, range: { from: number; to: number }): string {
  // The fold sits inside its brackets (JSON) or between the tags (XML): the node holding it
  // is the smallest one that covers the whole range.
  let node: SyntaxNode | null = syntaxTree(state).resolveInner(range.from, 1);
  while (node && (node.from > range.from || node.to < range.to)) node = node.parent;
  for (; node; node = node.parent) {
    if (node.name === "Object") return count(children(node, PROPERTY), "key");
    if (node.name === "Array") return count(children(node), "item");
    if (node.name === "Element") {
      const n = children(node, ELEMENT);
      return n ? count(n, "element") : "";
    }
  }
  return "";
}
